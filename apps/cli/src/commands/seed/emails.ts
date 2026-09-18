import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { Config, Effect, Redacted } from 'effect'
import type { SqlClient } from 'effect/unstable/sql'

import type { SeededInbox } from './inboxes'
import { ONE_PIXEL_PNG, SEED_REFERENCE, seedUuid, TINY_PDF } from './shared'

// Direct INSERTs keep the seed fast and deterministic — no SMTP round-trip or
// worker IMAP tick needed to materialize fixtures.

interface SeedAttachment {
	readonly filename: string
	readonly contentType: string
	readonly content: Buffer
	// An image the message draws in its own body — a logo in a signature — as
	// against a file somebody meant to send. The filters tell them apart, so the
	// seed has to hold one of each.
	readonly isInline?: boolean
}

interface SeedMessageArgs {
	readonly inbox: SeededInbox
	readonly threadRootMessageId: string
	readonly threadSubject: string
	readonly threadStatus?: 'open' | 'closed' | 'archived'
	readonly threadCompanyId?: string | null
	readonly threadContactId?: string | null
	readonly messageId: string
	readonly fromAddress: string
	readonly toAddresses: readonly string[]
	readonly ccAddresses?: readonly string[]
	readonly subject: string
	readonly textBody?: string
	readonly htmlBody?: string
	readonly inReplyTo?: string
	readonly references?: readonly string[]
	readonly attachments?: readonly SeedAttachment[]
	readonly receivedAt?: Date
	readonly inboundClassification?: 'normal' | 'spam' | 'blocked'
	readonly isDeliveryNotice?: boolean
	readonly status?: 'normal' | 'spam' | 'blocked' | 'bounced'
	readonly statusReason?: string
	readonly bounceType?: string
	readonly bounceSubType?: string
	readonly companyId?: string | null
	readonly contactId?: string | null
	readonly direction?: 'inbound' | 'outbound'
	readonly folder?: string
}

const slugMessageId = (id: string): string =>
	id.replace(/[<>@]/g, '').replace(/[^A-Za-z0-9._-]/g, '-')

export const seedDemoEmails = (
	sql: SqlClient.SqlClient,
	seededInboxes: ReadonlyArray<SeededInbox>,
) =>
	Effect.gen(function* () {
		const seedStorageEndpoint = yield* Config.string('STORAGE_ENDPOINT')
		const seedStorageRegion = yield* Config.string('STORAGE_REGION')
		const seedStorageAccessKeyId = yield* Config.string('STORAGE_ACCESS_KEY_ID')
		const seedStorageSecretAccessKey = yield* Config.redacted(
			'STORAGE_SECRET_ACCESS_KEY',
		)
		const seedStorageBucket = yield* Config.string('STORAGE_BUCKET')
		const seedS3 = new S3Client({
			endpoint: seedStorageEndpoint,
			region: seedStorageRegion,
			credentials: {
				accessKeyId: seedStorageAccessKeyId,
				secretAccessKey: Redacted.value(seedStorageSecretAccessKey),
			},
			forcePathStyle: true,
		})

		const insertSeedMessage = (args: SeedMessageArgs) =>
			Effect.gen(function* () {
				yield* sql`
					INSERT INTO email_thread_links ${sql.insert({
						id: seedUuid('email-thread', args.threadRootMessageId),
						organizationId: args.inbox.orgId,
						inboxId: args.inbox.id,
						externalThreadId: args.threadRootMessageId,
						subject: args.threadSubject,
						status: args.threadStatus ?? 'open',
						companyId: args.threadCompanyId ?? null,
						contactId: args.threadContactId ?? null,
					})}
					ON CONFLICT (organization_id, external_thread_id) DO NOTHING
				`

				const slug = slugMessageId(args.messageId)
				const rawRfc822Ref = `messages/${args.inbox.orgId}/${args.inbox.id}/seed/${slug}.eml`

				const attachmentsMeta: Array<{
					index: number
					filename: string
					contentType: string
					sizeBytes: number
					cid: string | null
					isInline: boolean
					storageKey: string
				}> = []
				if (args.attachments) {
					for (const [i, a] of args.attachments.entries()) {
						const storageKey = `messages/${args.inbox.orgId}/${args.inbox.id}/seed/${slug}/attachment-${i}.bin`
						yield* Effect.tryPromise({
							try: () =>
								seedS3.send(
									new PutObjectCommand({
										Bucket: seedStorageBucket,
										Key: storageKey,
										Body: a.content,
										ContentType: a.contentType,
									}),
								),
							catch: e =>
								new Error(
									`seed attachment upload failed for ${storageKey}: ${e instanceof Error ? e.message : String(e)}`,
								),
						})
						attachmentsMeta.push({
							index: i,
							filename: a.filename,
							contentType: a.contentType,
							sizeBytes: a.content.length,
							cid: a.isInline === true ? `seed-${slug}-${i}` : null,
							isInline: a.isInline === true,
							storageKey,
						})
					}
				}

				const dbMessageRow: Record<string, unknown> = {
					organizationId: args.inbox.orgId,
					inboxId: args.inbox.id,
					messageId: args.messageId,
					// Which conversation this message is in, said outright the way
					// the mail worker says it. Left out, the message belongs to no
					// thread any read can find.
					threadKey: args.threadRootMessageId,
					isDeliveryNotice: args.isDeliveryNotice ?? false,
					inReplyTo: args.inReplyTo ?? null,
					references: args.references ?? [],
					direction: args.direction ?? 'inbound',
					folder: args.folder ?? 'INBOX',
					rawRfc822Ref,
					subject: args.subject,
					receivedAt: args.receivedAt ?? SEED_REFERENCE,
					textBody: args.textBody ?? null,
					htmlBody: args.htmlBody ?? null,
					textPreview:
						args.textBody !== undefined ? args.textBody.slice(0, 200) : null,
					recipients: JSON.stringify({
						to: args.toAddresses,
						cc: args.ccAddresses ?? [],
						bcc: [],
					}),
					attachments: JSON.stringify(attachmentsMeta),
					companyId: args.companyId ?? null,
					contactId: args.contactId ?? null,
					status: args.status ?? 'normal',
					statusReason: args.statusReason ?? null,
					bounceType: args.bounceType ?? null,
					bounceSubType: args.bounceSubType ?? null,
					inboundClassification: args.inboundClassification ?? null,
				}
				const insertedRows = yield* sql<{ id: string }>`
					INSERT INTO email_messages ${sql.insert({
						id: seedUuid('email-message', String(dbMessageRow['messageId'])),
						...dbMessageRow,
					})}
					RETURNING id
				`
				const inserted = insertedRows[0]
				if (!inserted) return

				type Participant = {
					emailMessageId: string
					emailAddress: string
					role: string
				}
				const participants: Participant[] = [
					{
						emailMessageId: inserted.id,
						emailAddress: args.fromAddress.toLowerCase(),
						role: 'from',
					},
					...args.toAddresses.map(addr => ({
						emailMessageId: inserted.id,
						emailAddress: addr.toLowerCase(),
						role: 'to',
					})),
					...(args.ccAddresses ?? []).map(addr => ({
						emailMessageId: inserted.id,
						emailAddress: addr.toLowerCase(),
						role: 'cc',
					})),
				]
				yield* sql`
					INSERT INTO message_participants ${sql.insert(
						participants.map(pt => ({
							id: seedUuid(
								'message-participant',
								`${pt.emailMessageId}:${pt.role}:${pt.emailAddress}`,
							),
							...pt,
						})),
					)}
					ON CONFLICT DO NOTHING
				`
			})

		const tallerHuman = seededInboxes.find(i => i.email === 'admin@taller.cat')
		const tallerAgent = seededInboxes.find(i => i.email === 'agent@taller.cat')
		const tallerPrivate = seededInboxes.find(
			i => i.email === 'alice.private@taller.cat',
		)
		const restaurantHuman = seededInboxes.find(
			i => i.email === 'admin@restaurant.demo',
		)
		const restaurantAgent = seededInboxes.find(
			i => i.email === 'agent@restaurant.demo',
		)

		// Resolve the seeded company + contact (by slug / email within the org)
		// so at least one thread lands on the CRM timeline. Same lookup style as
		// the inbox seed; ids stay null if the CRM seed was skipped.
		const tallerOrgId = tallerHuman?.orgId
		let calPepCompanyId: string | null = null
		let unownedCompanyId: string | null = null
		let pepContactId: string | null = null
		if (tallerOrgId) {
			const companyRows = yield* sql<{ id: string }>`
				SELECT id FROM companies
				WHERE organization_id = ${tallerOrgId} AND slug = 'cal-pep-fonda'
				LIMIT 1
			`
			calPepCompanyId = companyRows[0]?.id ?? null
			const unownedRows = yield* sql<{ id: string }>`
				SELECT id FROM companies
				WHERE organization_id = ${tallerOrgId} AND slug = 'ferros-baix-llobregat'
				LIMIT 1
			`
			unownedCompanyId = unownedRows[0]?.id ?? null
			const contactRows = yield* sql<{ id: string }>`
				SELECT c.id FROM contacts c
				JOIN channels ch ON ch.subject_table = 'contacts' AND ch.subject_id = c.id
				WHERE c.organization_id = ${tallerOrgId}
				  AND ch.channel = 'email'
				  AND ch.address = 'pep@calpepfonda.cat'
				LIMIT 1
			`
			pepContactId = contactRows[0]?.id ?? null
		}

		if (tallerHuman) {
			const m1Id = '<m1-quote@calpepfonda.cat>'
			const m2Id = '<m2-quote-followup@calpepfonda.cat>'
			const m3Id = '<m3-kickoff@ferrosbl.com>'
			const m8Id = '<m8-vendor-quote@example.com>'
			const m9Id = `<m9-seed@taller.cat>`
			const m12Id = `<m12-seed@scam.example>`
			const m13Id = `<m13-seed@promo.example>`
			const m14Id = `<m14-seed@malware.example>`

			yield* insertSeedMessage({
				inbox: tallerHuman,
				threadRootMessageId: m1Id,
				threadSubject: 'Quote for the booking module',
				// Pep is a seeded CRM contact at Cal Pep Fonda — linking the thread
				// and its messages surfaces this email on the company/contact timeline.
				threadCompanyId: calPepCompanyId,
				threadContactId: pepContactId,
				messageId: m1Id,
				fromAddress: 'pep@calpepfonda.cat',
				toAddresses: ['admin@taller.cat'],
				subject: 'Quote for the booking module',
				textBody:
					'Hola Alice,\n\nM’agradaria saber el preu del mòdul de reserves.\n\nGràcies,\nPep',
				companyId: calPepCompanyId,
				contactId: pepContactId,
				receivedAt: new Date('2026-04-30T09:00:00Z'),
			})
			yield* insertSeedMessage({
				inbox: tallerHuman,
				threadRootMessageId: m1Id,
				threadSubject: 'Quote for the booking module',
				messageId: m2Id,
				fromAddress: 'pep@calpepfonda.cat',
				toAddresses: ['admin@taller.cat'],
				subject: 'Re: Quote for the booking module',
				textBody:
					'Una pregunta més: també suporta cancel·lacions automàtiques?\n\nPep',
				companyId: calPepCompanyId,
				contactId: pepContactId,
				inReplyTo: m1Id,
				references: [m1Id],
				receivedAt: new Date('2026-05-01T10:30:00Z'),
			})
			yield* insertSeedMessage({
				inbox: tallerHuman,
				threadRootMessageId: m3Id,
				threadSubject: 'Project kickoff materials',
				threadStatus: 'closed',
				messageId: m3Id,
				fromAddress: 'kickoff@ferrosbl.com',
				toAddresses: ['admin@taller.cat'],
				ccAddresses: ['marta@ferrosbl.com'],
				subject: 'Project kickoff materials',
				textBody:
					'Hi Alice,\n\nQuick recap of kickoff items:\n- Stakeholder list\n- Booking flow walkthrough\n\nAgenda link: https://taller.cat/kickoff',
				htmlBody:
					'<p>Hi Alice,</p>' +
					'<p>Quick recap of <strong>kickoff items</strong>:</p>' +
					'<ul><li>Stakeholder list</li><li>Booking flow walkthrough</li></ul>' +
					'<p><a href="https://taller.cat/kickoff">Agenda link</a></p>',
				receivedAt: new Date('2026-05-01T14:00:00Z'),
			})
			yield* insertSeedMessage({
				inbox: tallerHuman,
				threadRootMessageId: m8Id,
				threadSubject: 'Vendor quote — final',
				threadStatus: 'archived',
				messageId: m8Id,
				fromAddress: 'vendor@example.com',
				toAddresses: ['admin@taller.cat'],
				subject: 'Vendor quote — final',
				textBody: 'See attached.',
				attachments: [
					{
						filename: 'quote.pdf',
						contentType: 'application/pdf',
						content: TINY_PDF,
					},
					{
						filename: 'logo.png',
						contentType: 'image/png',
						content: ONE_PIXEL_PNG,
					},
				],
				receivedAt: new Date('2026-05-02T09:15:00Z'),
			})

			yield* insertSeedMessage({
				inbox: tallerHuman,
				threadRootMessageId: m1Id,
				threadSubject: 'Quote for the booking module',
				messageId: m9Id,
				fromAddress: 'admin@taller.cat',
				toAddresses: ['pep@calpepfonda.cat'],
				subject: 'Re: Quote for the booking module',
				textBody:
					'Hi Pep,\n\nAttached is the quote for the booking module. Let me know what you think.\n\nAlice',
				companyId: calPepCompanyId,
				contactId: pepContactId,
				// Outbound reply that bounced — exercises the deliverability badge
				// with a hard-bounce reason on the same CRM-linked thread.
				status: 'bounced',
				statusReason: 'Recipient address rejected: user unknown',
				bounceType: 'hard',
				bounceSubType: 'general',
				inReplyTo: m1Id,
				references: [m1Id],
				direction: 'outbound',
				folder: 'Sent',
				receivedAt: new Date('2026-05-02T11:00:00Z'),
			})

			yield* insertSeedMessage({
				inbox: tallerHuman,
				threadRootMessageId: m12Id,
				threadSubject: 'URGENT: wire transfer needed',
				messageId: m12Id,
				fromAddress: 'finance@scam.example',
				toAddresses: ['admin@taller.cat'],
				subject: 'URGENT: wire transfer needed',
				textBody:
					'Dear customer, please wire €5000 to the account below within 24 hours.',
				inboundClassification: 'spam',
				receivedAt: new Date('2026-05-03T08:00:00Z'),
			})

			// Spam-quarantined message: hidden from the default inbox view, listed
			// under the spam filter. status and classification both flag it.
			yield* insertSeedMessage({
				inbox: tallerHuman,
				threadRootMessageId: m13Id,
				threadSubject: 'You have won a prize!!!',
				messageId: m13Id,
				fromAddress: 'deals@promo.example',
				toAddresses: ['admin@taller.cat'],
				subject: 'You have won a prize!!!',
				textBody: 'Click here to claim your free voucher before it expires.',
				status: 'spam',
				statusReason: 'Spam score above threshold',
				inboundClassification: 'spam',
				receivedAt: new Date('2026-05-03T09:30:00Z'),
			})

			// Blocked message: a hard-blocked sender (e.g. malware). Drives the
			// blocked status badge and the blocked inbound-classification banner.
			yield* insertSeedMessage({
				inbox: tallerHuman,
				threadRootMessageId: m14Id,
				threadSubject: 'Invoice attached',
				messageId: m14Id,
				fromAddress: 'billing@malware.example',
				toAddresses: ['admin@taller.cat'],
				subject: 'Invoice attached',
				textBody: 'Please review the attached invoice and confirm payment.',
				status: 'blocked',
				statusReason: 'Sender on org blocklist',
				inboundClassification: 'blocked',
				receivedAt: new Date('2026-05-03T10:15:00Z'),
			})

			// A conversation where we answered last and the message arrived:
			// "waiting on them" has nothing to find without one, and every other
			// seeded thread ends with somebody writing to us.
			const m15Id = '<m15-our-answer@taller.cat>'
			yield* insertSeedMessage({
				inbox: tallerHuman,
				threadRootMessageId: m15Id,
				threadSubject: 'Availability for the October fit-out',
				threadCompanyId: unownedCompanyId,
				companyId: unownedCompanyId,
				messageId: m15Id,
				direction: 'outbound',
				fromAddress: 'admin@taller.cat',
				toAddresses: ['marta@ferrosbl.com'],
				subject: 'Availability for the October fit-out',
				textBody:
					'Hi Marta,\n\nWe can start the week of the 12th. Shall I hold it?\n\nAlice',
				receivedAt: new Date('2026-05-02T15:00:00Z'),
			})

			// A message whose only attachment is the logo in its signature, so
			// "has attachments" has something it must NOT match.
			const m16Id = '<m16-signature-logo@ferrosbl.com>'
			yield* insertSeedMessage({
				inbox: tallerHuman,
				threadRootMessageId: m16Id,
				threadSubject: 'Thanks for the visit',
				messageId: m16Id,
				fromAddress: 'marta@ferrosbl.com',
				toAddresses: ['admin@taller.cat'],
				subject: 'Thanks for the visit',
				textBody: 'Good to see the workshop yesterday.\n\nMarta',
				attachments: [
					{
						filename: 'signature-logo.png',
						contentType: 'image/png',
						content: Buffer.from(
							'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
							'base64',
						),
						isInline: true,
					},
				],
				receivedAt: new Date('2026-05-02T18:00:00Z'),
			})

			// A delivery failure notice, chained to the send it is about the way
			// some mail servers chain one. It must not read as the other side
			// writing back, which is the whole reason a notice is marked as one.
			const m19Id = '<m19-mailer-daemon@taller.cat>'
			yield* insertSeedMessage({
				inbox: tallerHuman,
				// The conversation the failed send belongs to, not the send itself:
				// a notice joins the exchange it is about, which is what makes it
				// the newest message there and worth passing over.
				threadRootMessageId: m1Id,
				threadSubject: 'Quote for the booking module',
				messageId: m19Id,
				fromAddress: 'mailer-daemon@calpepfonda.cat',
				toAddresses: ['admin@taller.cat'],
				subject: 'Undelivered Mail Returned to Sender',
				textBody:
					'This is the mail system at host calpepfonda.cat.\n\nYour message could not be delivered.',
				isDeliveryNotice: true,
				inReplyTo: m9Id,
				references: [m9Id],
				receivedAt: new Date('2026-05-02T11:05:00Z'),
			})

			// Something from this week. Every other seeded conversation is months
			// old, so without one "gone quiet for a fortnight" matches everything
			// and a filter that matches everything proves nothing.
			const m20Id = '<m20-this-week@calpepfonda.cat>'
			yield* insertSeedMessage({
				inbox: tallerHuman,
				threadRootMessageId: m20Id,
				threadSubject: 'Are you free on Thursday?',
				threadCompanyId: calPepCompanyId,
				companyId: calPepCompanyId,
				contactId: pepContactId,
				messageId: m20Id,
				fromAddress: 'pep@calpepfonda.cat',
				toAddresses: ['admin@taller.cat'],
				subject: 'Are you free on Thursday?',
				textBody: 'Podem quedar dijous al matí?\n\nPep',
				receivedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
			})

			// Mail in a mailbox Alice keeps to herself: one message inside the
			// conversation the team shares, and one conversation of its own.
			// Nothing else local exercises the rule that keeps them apart.
			if (tallerPrivate) {
				yield* insertSeedMessage({
					inbox: tallerPrivate,
					threadRootMessageId: m1Id,
					threadSubject: 'Quote for the booking module',
					messageId: '<m17-private-note@calpepfonda.cat>',
					fromAddress: 'pep@calpepfonda.cat',
					toAddresses: ['alice.private@taller.cat'],
					subject: 'Re: Quote for the booking module',
					textBody:
						'Entre nosaltres: puc estirar el pressupost fins a 12.000 €.\n\nPep',
					inReplyTo: m1Id,
					references: [m1Id],
					receivedAt: new Date('2026-05-04T08:00:00Z'),
				})
				const m18Id = '<m18-private-thread@gestoria.example>'
				yield* insertSeedMessage({
					inbox: tallerPrivate,
					threadRootMessageId: m18Id,
					threadSubject: 'Your tax return',
					messageId: m18Id,
					fromAddress: 'gestoria@gestoria.example',
					toAddresses: ['alice.private@taller.cat'],
					subject: 'Your tax return',
					textBody: 'Adjuntem l’esborrany de la declaració.',
					receivedAt: new Date('2026-05-04T09:00:00Z'),
				})
			}

			// An in-flight reply draft on Pep's quote thread, so /emails shows a
			// resumable draft. body_json is the EmailBlocks block tree (same shape
			// as inbox footers); thread_link_id ties it back to the M1 thread.
			const threadLinkRows = yield* sql<{ id: string }>`
				SELECT id FROM email_thread_links
				WHERE organization_id = ${tallerHuman.orgId}
				  AND external_thread_id = ${m1Id}
				LIMIT 1
			`
			const m1ThreadLinkId = threadLinkRows[0]?.id ?? null
			yield* sql`
				INSERT INTO email_drafts ${sql.insert({
					draftId: 'draft_seed-fixed',
					organizationId: tallerHuman.orgId,
					inboxId: tallerHuman.id,
					mode: 'reply',
					toAddresses: ['pep@calpepfonda.cat'],
					ccAddresses: [],
					bccAddresses: [],
					subject: 'Re: Quote for the booking module',
					inReplyTo: m1Id,
					threadLinkId: m1ThreadLinkId,
					clientId: null,
					bodyJson: JSON.stringify([
						{
							type: 'paragraph',
							spans: [
								{
									kind: 'text',
									value:
										'Hi Pep, thanks for the questions — drafting the cancellation details now.',
								},
							],
						},
					]),
				})}
			`

			yield* Effect.logInfo(
				'  taller human: M1+M2 (CRM-linked thread), M3 (closed), M8 (archived), M9 (bounced), M12 (spam-classified), M13 (spam), M14 (blocked), +1 reply draft',
			)
		}
		if (tallerAgent) {
			const m4Id = '<m4-photos@hostalpirineu.com>'
			yield* insertSeedMessage({
				inbox: tallerAgent,
				threadRootMessageId: m4Id,
				threadSubject: 'Visit photos attached',
				messageId: m4Id,
				fromAddress: 'photos@hostalpirineu.com',
				toAddresses: ['agent@taller.cat'],
				subject: 'Visit photos attached',
				textBody: "Hi, photos from yesterday's visit attached.",
				attachments: [
					{
						filename: 'photo.png',
						contentType: 'image/png',
						content: ONE_PIXEL_PNG,
					},
				],
				receivedAt: new Date('2026-05-02T16:30:00Z'),
			})
			yield* Effect.logInfo('  taller agent: M4 (single attachment)')
		}
		if (restaurantHuman) {
			const m5Id = '<m5-welcome@batuda.dev>'
			const m6Id = '<m6-welcome-followup@batuda.dev>'
			yield* insertSeedMessage({
				inbox: restaurantHuman,
				threadRootMessageId: m5Id,
				threadSubject: 'Welcome to Batuda',
				messageId: m5Id,
				fromAddress: 'noreply@batuda.dev',
				toAddresses: ['admin@restaurant.demo'],
				subject: 'Welcome to Batuda',
				textBody:
					'Welcome Bob! Reply when ready and we’ll set up your first inbox.',
				receivedAt: new Date('2026-05-01T09:00:00Z'),
			})
			yield* insertSeedMessage({
				inbox: restaurantHuman,
				threadRootMessageId: m5Id,
				threadSubject: 'Welcome to Batuda',
				messageId: m6Id,
				fromAddress: 'noreply@batuda.dev',
				toAddresses: ['admin@restaurant.demo'],
				subject: 'Re: Welcome to Batuda',
				textBody: 'Quick follow-up — let me know if anything is unclear.',
				inReplyTo: m5Id,
				references: [m5Id],
				receivedAt: new Date('2026-05-01T15:00:00Z'),
			})
			yield* Effect.logInfo('  restaurant human: M5+M6 (thread)')
		}
		if (restaurantAgent) {
			const m7Id = '<m7-ooo@example.com>'
			yield* insertSeedMessage({
				inbox: restaurantAgent,
				threadRootMessageId: m7Id,
				threadSubject: 'Out of office',
				messageId: m7Id,
				fromAddress: 'support@example.com',
				toAddresses: ['agent@restaurant.demo'],
				subject: 'Out of office',
				textBody: 'Out today, back Monday.',
				receivedAt: new Date('2026-05-02T07:00:00Z'),
			})
			yield* Effect.logInfo('  restaurant agent: M7 (single)')
		}

		// A conversation's activity time is when something last happened on it,
		// which for seeded mail is its newest message. Left to the database
		// default every conversation would carry the same instant, and the two
		// orders the list offers — by activity, by latest message — would be the
		// same order on this data, so neither could be seen to work.
		yield* sql`
			UPDATE email_thread_links tl
			SET updated_at = newest.at
			FROM (
				SELECT m.thread_key, m.organization_id, max(m.received_at) AS at
				FROM email_messages m
				GROUP BY m.thread_key, m.organization_id
			) newest
			WHERE newest.organization_id = tl.organization_id
			  AND newest.thread_key = tl.external_thread_id
			  AND newest.at IS NOT NULL
		`

		// Filing a conversation away is activity too, and it is what makes the
		// two orders the list offers differ: a conversation closed this morning
		// sits at the top by activity and near the bottom by its latest message,
		// which is months old. Without this every conversation's activity time
		// equals its last message and the two orders are one order.
		yield* sql`
			UPDATE email_thread_links
			SET updated_at = now() - interval '2 hours'
			WHERE status <> 'open'
		`

		yield* Effect.logInfo('Demo emails seeded — open /emails to see them.')
	})

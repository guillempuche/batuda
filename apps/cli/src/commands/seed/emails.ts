import { randomUUID } from 'node:crypto'

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { Config, Effect, Redacted } from 'effect'
import type { SqlClient } from 'effect/unstable/sql'

import type { SeededInbox } from './inboxes'
import { ONE_PIXEL_PNG, TINY_PDF } from './shared'

// Direct INSERTs because Mailpit doesn't speak IMAP, so the worker can't ingest fixtures.

interface SeedAttachment {
	readonly filename: string
	readonly contentType: string
	readonly content: Buffer
}

interface SeedMessageArgs {
	readonly inbox: SeededInbox
	readonly threadRootMessageId: string
	readonly threadSubject: string
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
	readonly inboundClassification?: 'normal' | 'spam'
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
						organizationId: args.inbox.orgId,
						inboxId: args.inbox.id,
						externalThreadId: args.threadRootMessageId,
						subject: args.threadSubject,
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
					for (let i = 0; i < args.attachments.length; i++) {
						const a = args.attachments[i]!
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
							cid: null,
							isInline: false,
							storageKey,
						})
					}
				}

				const dbMessageRow: Record<string, unknown> = {
					organizationId: args.inbox.orgId,
					inboxId: args.inbox.id,
					messageId: args.messageId,
					inReplyTo: args.inReplyTo ?? null,
					references: args.references ?? [],
					direction: args.direction ?? 'inbound',
					folder: args.folder ?? 'INBOX',
					rawRfc822Ref,
					subject: args.subject,
					receivedAt: args.receivedAt ?? new Date(),
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
					status: 'normal',
					inboundClassification: args.inboundClassification ?? null,
				}
				const insertedRows = yield* sql<{ id: string }>`
					INSERT INTO email_messages ${sql.insert(dbMessageRow)}
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
					INSERT INTO message_participants ${sql.insert(participants)}
					ON CONFLICT DO NOTHING
				`
			})

		const tallerHuman = seededInboxes.find(i => i.email === 'admin@taller.cat')
		const tallerAgent = seededInboxes.find(i => i.email === 'agent@taller.cat')
		const restaurantHuman = seededInboxes.find(
			i => i.email === 'admin@restaurant.demo',
		)
		const restaurantAgent = seededInboxes.find(
			i => i.email === 'agent@restaurant.demo',
		)

		if (tallerHuman) {
			const m1Id = '<m1-quote@calpepfonda.cat>'
			const m2Id = '<m2-quote-followup@calpepfonda.cat>'
			const m3Id = '<m3-kickoff@ferrosbl.com>'
			const m8Id = '<m8-vendor-quote@example.com>'
			const m9Id = `<m9-${randomUUID()}@taller.cat>`
			const m12Id = `<m12-${randomUUID()}@scam.example>`

			yield* insertSeedMessage({
				inbox: tallerHuman,
				threadRootMessageId: m1Id,
				threadSubject: 'Quote for the booking module',
				messageId: m1Id,
				fromAddress: 'pep@calpepfonda.cat',
				toAddresses: ['admin@taller.cat'],
				subject: 'Quote for the booking module',
				textBody:
					'Hola Alice,\n\nM’agradaria saber el preu del mòdul de reserves.\n\nGràcies,\nPep',
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
				inReplyTo: m1Id,
				references: [m1Id],
				receivedAt: new Date('2026-05-01T10:30:00Z'),
			})
			yield* insertSeedMessage({
				inbox: tallerHuman,
				threadRootMessageId: m3Id,
				threadSubject: 'Project kickoff materials',
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

			yield* Effect.logInfo(
				'  taller human: M1+M2 (thread), M3 (rich+Cc), M8 (2 attachments), M9 (outbound), M12 (spam)',
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

		yield* Effect.logInfo('Demo emails seeded — open /emails to see them.')
	})

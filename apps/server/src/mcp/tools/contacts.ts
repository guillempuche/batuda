import { DateTime, Effect, Schema } from 'effect'
import { Tool, Toolkit } from 'effect/unstable/ai'
import { SqlClient } from 'effect/unstable/sql'

import {
	ContactSummary,
	ContactWithChannels,
	CurrentOrg,
} from '@batuda/controllers'
import {
	Contact,
	ContactChannel,
	HandSetVerificationVerdict,
} from '@batuda/domain'

import {
	addChannel,
	channelsJsonFor,
	channelsOf,
	clearEmailSuppression,
	deleteChannel,
	deleteSubjectChannels,
	patchChannel,
	writeChannels,
} from '../../services/channels'
import { requireLiveCompany } from '../../services/company-liveness'
import { unlinkSubject } from '../../services/documents'
import { ownedSiteId } from '../../services/sites'
import { ToolMessage } from '../tool-message'
import { McpPageLimit, TruncatableResult, toTruncatable } from './_result'

const decodeContact = Schema.decodeUnknownEffect(Contact)
const decodeChannels = Schema.decodeUnknownEffect(Schema.Array(ContactChannel))

// One reachable channel. `kind` is open (email, phone, linkedin, x, website,
// bluesky, …); only the email channel carries a deliverability `verification`,
// and only ever a verdict that lowers how far the address is trusted — saying
// one is good is something a mailbox check finds out, not something a caller
// declares. The score behind a verdict is not accepted here at all.
const ChannelInput = Schema.Struct({
	kind: Schema.String,
	value: Schema.String,
	label: Schema.optional(Schema.String).annotate({
		description:
			'Which of several this is, in the words a person would use: "Girona shop", "sales office", "switchboard". Give it whenever somebody holds more than one of a kind — without it a second address is indistinguishable from the first.',
	}),
	verification: Schema.optional(HandSetVerificationVerdict).annotate({
		description:
			"How far this address is trusted, and only ever downwards: 'risky' or 'undeliverable' to record doubt, 'unknown' for a check that settled nothing, or null to take a verdict back off entirely. An address is only ever called deliverable by a check that reached the mailbox.",
	}),
	is_primary: Schema.optional(Schema.Boolean),
})

const ListContacts = Tool.make('list_contacts', {
	description:
		'List contacts for a company, each with its channels. Returns at most `limit` rows (default 100, max 500); `hasMore` says whether more matched than were returned — read it before saying how many there are.',
	parameters: Schema.Struct({
		company_id: Schema.String,
		limit: Schema.optional(McpPageLimit),
	}),
	success: TruncatableResult(ContactSummary),
})
	.annotate(Tool.Title, 'List Contacts')
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

const CreateContact = Tool.make('create_contact', {
	description:
		'Create a contact linked to a company. Role examples: CEO, CTO, Marketing Director, Sales Manager. Pass channels[] for every reachable address (kind: email | phone | linkedin | x | website | bluesky | …); the primary email channel is the address used for sending.',
	parameters: Schema.Struct({
		company_id: Schema.String,
		site_id: Schema.optional(Schema.String).annotate({
			description:
				'The branch this person works at, when the company has more than one and it is known which. Leave it out for someone who works for the company at large or moves between its branches — most people, and guessing here is worse than saying nothing.',
		}),
		name: Schema.String,
		role: Schema.optional(Schema.String),
		channels: Schema.optional(Schema.Array(ChannelInput)),
	}),
	success: ContactWithChannels,
	dependencies: [CurrentOrg],
})
	.annotate(Tool.Title, 'Create Contact')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

const UpdateContact = Tool.make('update_contact', {
	description:
		'Update one or more fields on an existing contact by UUID. Only include fields to change. channels[] only adds an address or refreshes one already on file — it never removes or replaces one, so correcting an address here leaves the old one behind and the person ends up holding both. Use manage_contact_channels to correct, remove, label or re-elect a single channel. Set clear_email_suppression=true to reset the email channel to "unknown" (use after a bounced/complained contact confirms their address is good again — this re-enables outbound mail to that address).',
	parameters: Schema.Struct({
		id: Schema.String,
		site_id: Schema.optional(Schema.NullOr(Schema.String)).annotate({
			description:
				'The branch this person works at, when the company has more than one and it is known which. Leave it out for someone who works for the company at large or moves between its branches — most people, and guessing here is worse than saying nothing. Pass null to clear a branch somebody no longer works at; leaving it out changes nothing.',
		}),
		name: Schema.optional(Schema.String),
		role: Schema.optional(Schema.String),
		channels: Schema.optional(Schema.Array(ChannelInput)),
		clear_email_suppression: Schema.optional(Schema.Boolean),
	}),
	success: ContactWithChannels,
	dependencies: [CurrentOrg],
})
	.annotate(Tool.Title, 'Update Contact')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.Idempotent, true)
	.annotate(Tool.OpenWorld, false)

const DeleteContact = Tool.make('delete_contact', {
	description:
		'Permanently delete a contact by UUID. Cascade-detaches the contact from interactions / proposals / threads via ON DELETE SET NULL — those rows survive with contact_id=NULL, so the history stays but stops naming anybody. Their channels go with them, including any record of an address having bounced, so re-creating the person starts that address clean. To fix a wrong address, use manage_contact_channels rather than deleting the person — this loses everything they are attached to.',
	parameters: Schema.Struct({
		id: Schema.String,
	}),
	success: Schema.Struct({
		status: Schema.Literal('deleted'),
	}),
	dependencies: [CurrentOrg],
})
	.annotate(Tool.Title, 'Delete Contact')
	.annotate(Tool.Destructive, true)
	.annotate(Tool.Idempotent, true)
	.annotate(Tool.OpenWorld, false)

// One tool for a person's ways of being reached, with a flat `action` for the
// same reason the company one has: a strict provider rejects the nested shape a
// union serialises to.
const ManageContactChannels = Tool.make('manage_contact_channels', {
	description:
		"The ways of reaching one person — their mailboxes, phones, social handles — one at a time. This is where a wrong address is put right: update_contact's channels[] only ever adds, so an address corrected there leaves the old one sitting beside it, and deleting the person to start over detaches every email, meeting and interaction ever logged against them. action: 'list' (all of them), 'add' (kind plus value, and a label whenever there is more than one of that kind), 'update' (by channel_id, only the fields to change), 'remove' (by channel_id). Renaming an address onto one this person already holds is refused rather than merged — remove the spare instead. `is_primary` marks the one to use when nothing says otherwise; the primary email is the address mail is sent to, and removing it hands that over to the oldest one left of the same kind. `verification` only ever lowers how far an address is trusted, and only on 'update' — pass null to take a verdict back off entirely, which says nobody has checked rather than that a check came back doubtful. A later check can raise it again. Leaving somebody with no email address at all means a later research run or an inbound reply will not recognise them and may create a second copy of the same person.",
	parameters: Schema.Struct({
		action: Schema.Literals(['list', 'add', 'update', 'remove']),
		contact_id: Schema.String,
		channel_id: Schema.optional(Schema.String),
		kind: Schema.optional(Schema.String),
		value: Schema.optional(Schema.String),
		// Nullable so a name given by mistake can be taken back off.
		label: Schema.optional(Schema.NullOr(Schema.String)),
		is_primary: Schema.optional(Schema.Boolean),
		verification: Schema.optional(Schema.NullOr(HandSetVerificationVerdict)),
	}),
	success: Schema.Struct({
		channels: Schema.Array(ContactChannel.json),
	}),
	dependencies: [CurrentOrg],
})
	.annotate(Tool.Title, 'Manage Contact Channels')
	// 'remove' throws an address away for good, and no other action here can be
	// undone by repeating it either. The company siblings say otherwise; this is
	// the honest value for a tool whose whole point is taking one off.
	.annotate(Tool.Destructive, true)
	.annotate(Tool.OpenWorld, false)

export const ContactTools = Toolkit.make(
	ListContacts,
	CreateContact,
	UpdateContact,
	DeleteContact,
	ManageContactChannels,
)

export const ContactHandlersLive = ContactTools.toLayer(
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient

		return {
			list_contacts: ({ company_id, limit: requestedLimit }) =>
				Effect.gen(function* () {
					const limit = requestedLimit ?? 100
					const rows = yield* sql`
						SELECT c.*, ${channelsJsonFor(sql, 'contacts')} AS channels
						FROM contacts c
						WHERE c.company_id = ${company_id}
						  AND c.deleted_at IS NULL
						ORDER BY c.name, c.id
						LIMIT ${limit + 1}
					`
					// Decode each contact's own columns; `channels` is already JSON
					// from json_agg, so keep it as-is.
					const contacts = yield* Effect.forEach(rows, row =>
						decodeContact(row).pipe(
							Effect.map(c => ({
								...c,
								channels: (row as { readonly channels: ReadonlyArray<unknown> })
									.channels,
							})),
						),
					)
					return toTruncatable(contacts, limit)
				}).pipe(Effect.orDie),

			create_contact: ({ company_id, site_id, channels, ...fields }) =>
				Effect.gen(function* () {
					const currentOrg = yield* CurrentOrg
					yield* requireLiveCompany(sql, currentOrg.id, company_id)
					const siteId = yield* ownedSiteId(
						sql,
						currentOrg.id,
						company_id,
						site_id,
					)
					const rows = yield* sql`INSERT INTO contacts ${sql.insert({
						organizationId: currentOrg.id,
						companyId: company_id,
						siteId: siteId ?? null,
						...fields,
					})} RETURNING *`
					const contact = rows[0] as { id: string }
					if (channels && channels.length > 0) {
						yield* writeChannels(
							sql,
							currentOrg.id,
							{ table: 'contacts' as const, id: contact.id },
							channels,
						)
					}
					const ch = yield* channelsOf(sql, {
						table: 'contacts' as const,
						id: contact.id,
					})
					const decoded = yield* decodeContact(rows[0])
					const decodedChannels = yield* decodeChannels(ch)
					return { ...decoded, channels: decodedChannels }
				}).pipe(
					Effect.catchTag('NotFound', () =>
						Effect.die(
							new ToolMessage(
								'That company is not here, or it was deleted — restore it before adding people to it.',
							),
						),
					),
					Effect.orDie,
				),

			update_contact: ({
				id,
				site_id,
				channels,
				clear_email_suppression,
				...fields
			}) =>
				Effect.gen(function* () {
					const currentOrg = yield* CurrentOrg
					// A branch counts as theirs only if it belongs to the company this
					// person works for, and only the stored row says which company that is.
					const owner = yield* sql`
						SELECT company_id AS "companyId" FROM contacts
						WHERE id = ${id} AND organization_id = ${currentOrg.id}
						LIMIT 1
					`
					const companyId = (
						owner[0] as { readonly companyId: string } | undefined
					)?.companyId
					const siteId =
						companyId === undefined
							? undefined
							: yield* ownedSiteId(sql, currentOrg.id, companyId, site_id)
					const rows = yield* sql`UPDATE contacts SET ${sql.update({
						...fields,
						// Only when named: leaving it out means "don't touch", which is
						// what a caller changing only a phone number expects.
						...(siteId === undefined ? {} : { siteId }),
						updatedAt: DateTime.toDateUtc(DateTime.nowUnsafe()),
					})} WHERE id = ${id} RETURNING *`
					if (clear_email_suppression)
						yield* clearEmailSuppression(sql, {
							table: 'contacts' as const,
							id,
						})
					if (channels && channels.length > 0) {
						yield* writeChannels(
							sql,
							currentOrg.id,
							{ table: 'contacts' as const, id: id },
							channels,
						)
					}
					const ch = yield* channelsOf(sql, {
						table: 'contacts' as const,
						id: id,
					})
					const decoded = yield* decodeContact(rows[0])
					const decodedChannels = yield* decodeChannels(ch)
					return { ...decoded, channels: decodedChannels }
				}).pipe(Effect.orDie),

			delete_contact: ({ id }) =>
				Effect.gen(function* () {
					const currentOrg = yield* CurrentOrg
					const subject = { table: 'contacts' as const, id }
					// How many of their addresses were being kept out of the send path.
					// Read first, because afterwards there is nothing left to count, and
					// worth recording: the block is organisation-wide by address, so it
					// goes with them.
					const suppressed = yield* sql<{ n: number }>`
						SELECT count(*)::int AS n FROM channels
						WHERE subject_table = 'contacts' AND subject_id = ${id}
							AND organization_id = ${currentOrg.id}
							AND status IN ('bounced', 'complained')
					`
					const removed = yield* sql`
						DELETE FROM contacts
						WHERE id = ${id} AND organization_id = ${currentOrg.id}
						RETURNING id
					`
					// Only once the person really went, and after them: no foreign key
					// clears either of these, so they would outlive the person and point
					// at nobody.
					if (removed.length > 0) {
						yield* unlinkSubject(sql, 'contacts', id)
						yield* deleteSubjectChannels(sql, currentOrg.id, subject)
					}
					yield* Effect.logInfo('Contact removed').pipe(
						Effect.annotateLogs({
							event: 'contact.removed',
							contactId: id,
							suppressedChannelsRemoved: suppressed[0]?.n ?? 0,
						}),
					)
					return { status: 'deleted' as const }
				}).pipe(Effect.orDie),

			manage_contact_channels: params =>
				Effect.gen(function* () {
					const currentOrg = yield* CurrentOrg
					const subject = { table: 'contacts' as const, id: params.contact_id }
					const channels = () =>
						channelsOf(sql, subject).pipe(Effect.flatMap(decodeChannels))

					// An id only proves the row exists, not whose it is, so without this
					// a channel could be hung off somebody else's person.
					const owned = yield* sql`
						SELECT id FROM contacts
						WHERE id = ${params.contact_id}
							AND organization_id = ${currentOrg.id}
						LIMIT 1
					`
					// Same words whether the person does not exist or belongs to another
					// organisation, so the answer never tells a caller which. Handing
					// back an empty list instead reads as "this person has no addresses",
					// which is a different and wrong thing to believe.
					if (owned.length === 0)
						return yield* Effect.die(
							new ToolMessage(`No contact ${params.contact_id}.`),
						)

					// A verdict on any other action would work or not depending on
					// whether the address was already on file, which is invisible from
					// the outside — better to say so than to half-apply it.
					if (params.verification !== undefined && params.action !== 'update')
						return yield* Effect.die(
							new ToolMessage(
								'verification is only set by action: "update", on a channel already on file.',
							),
						)

					// An action missing what it needs used to fall through to the list
					// below and come back as a success — indistinguishable from asking
					// for the list, and the caller reports the address as added.
					if (
						params.action === 'add' &&
						(params.kind === undefined || params.value === undefined)
					)
						return yield* Effect.die(
							new ToolMessage(
								'add needs both kind and value — kind for what sort of address it is, value for the address itself.',
							),
						)
					if (
						(params.action === 'update' || params.action === 'remove') &&
						params.channel_id === undefined
					)
						return yield* Effect.die(
							new ToolMessage(
								`${params.action} needs channel_id — the id of the one address to change, which action: "list" hands back.`,
							),
						)

					if (
						params.action === 'add' &&
						params.kind !== undefined &&
						params.value !== undefined
					) {
						yield* addChannel(sql, currentOrg.id, subject, {
							kind: params.kind,
							value: params.value,
							// On a new one there is nothing to take back, so a null name
							// and no name are the same thing.
							label: params.label ?? undefined,
							is_primary: params.is_primary,
						})
					}
					if (params.action === 'update' && params.channel_id !== undefined) {
						const patched = yield* patchChannel(
							sql,
							currentOrg.id,
							subject,
							params.channel_id,
							{
								kind: params.kind,
								value: params.value,
								label: params.label,
								is_primary: params.is_primary,
								verification: params.verification,
							},
						)
						// Saying nothing here would hand back a list that looks unchanged
						// because it is, and the caller could not tell a wrong id from a
						// write that did nothing.
						if (patched === undefined)
							return yield* Effect.die(
								new ToolMessage(
									`No channel ${params.channel_id} on this contact.`,
								),
							)
					}
					if (params.action === 'remove' && params.channel_id !== undefined) {
						const removed = yield* deleteChannel(
							sql,
							currentOrg.id,
							subject,
							params.channel_id,
						)
						if (!removed)
							return yield* Effect.die(
								new ToolMessage(
									`No channel ${params.channel_id} on this contact.`,
								),
							)
					}
					return { channels: yield* channels() }
				}).pipe(
					// An address that could never be one of its kind, or one already on
					// file, is worth saying in words the assistant can act on rather than
					// the fixed sentence a raw fault gets.
					Effect.catchTag('BadRequest', e =>
						Effect.die(new ToolMessage(e.message)),
					),
					Effect.orDie,
				),
		}
	}),
)

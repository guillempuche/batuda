import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/unstable/httpapi'

import { Contact, ContactChannel } from '@batuda/domain'

import { OrgMiddleware } from '../middleware/org'
import { SessionMiddleware } from '../middleware/session'
import { PaginatedList, pageQuery } from '../pagination'

// A reachable channel supplied in bulk (agent/import path). `kind` is open
// (email, phone, linkedin, x, website, bluesky, …); only the email channel
// carries a deliverability `verification`. Suppression status is
// system-managed and never accepted from a client.
const ChannelInput = Schema.Struct({
	kind: Schema.String,
	value: Schema.String,
	verification: Schema.optional(Schema.String),
	confidence: Schema.optional(Schema.Number),
	is_primary: Schema.optional(Schema.Boolean),
})

const CreateContactInput = Schema.Struct({
	companyId: Schema.String,
	name: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
	role: Schema.optional(Schema.String),
	buyingRole: Schema.optional(Schema.String),
	metadata: Schema.optional(Schema.Unknown),
	channels: Schema.optional(Schema.Array(ChannelInput)),
})

const UpdateContactInput = Schema.Struct({
	name: Schema.optional(Schema.String),
	role: Schema.optional(Schema.String),
	buyingRole: Schema.optional(Schema.String),
	metadata: Schema.optional(Schema.Unknown),
	channels: Schema.optional(Schema.Array(ChannelInput)),
})

// Granular channel edits (the human UI). Value/kind/primary only — never the
// system-derived verification or suppression status.
const AddChannelInput = Schema.Struct({
	kind: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
	value: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
	is_primary: Schema.optional(Schema.Boolean),
})

const PatchChannelInput = Schema.Struct({
	kind: Schema.optional(Schema.String),
	value: Schema.optional(Schema.String),
	is_primary: Schema.optional(Schema.Boolean),
})

// A contact plus its reachable channels. `channels` stays open (`Unknown`):
// the server names each key in the JSON it sends, and the send path reads
// those keys directly instead of decoding the array.
export const ContactSummary = Schema.Struct({
	...Contact.json.fields,
	channels: Schema.Array(Schema.Unknown),
})

// The list response also carries the research provenance trail (which runs and
// sources wrote the contact), left open for the presentation layer to render.
export const ContactListItem = Schema.Struct({
	...ContactSummary.fields,
	provenance: Schema.Array(Schema.Unknown),
})

// The create/update/reset responses return channels decoded from their own
// rows, so they carry the fully-typed channel shape.
export const ContactWithChannels = Schema.Struct({
	...Contact.json.fields,
	channels: Schema.Array(ContactChannel.json),
})

const SuppressionCleared = Schema.Struct({
	id: Schema.String,
	channels: Schema.Array(ContactChannel.json),
})

export const ContactsGroup = HttpApiGroup.make('contacts')
	.add(
		HttpApiEndpoint.get('list', '/contacts', {
			query: {
				companyId: Schema.optional(Schema.String),
				...pageQuery,
			},
			success: PaginatedList(ContactListItem),
		}),
	)
	.add(
		HttpApiEndpoint.post('create', '/contacts', {
			payload: CreateContactInput,
			success: ContactWithChannels,
		}),
	)
	.add(
		HttpApiEndpoint.patch('update', '/contacts/:id', {
			params: { id: Schema.String },
			payload: UpdateContactInput,
			success: ContactWithChannels,
		}),
	)
	.add(
		HttpApiEndpoint.delete('remove', '/contacts/:id', {
			params: { id: Schema.String },
			success: Schema.Void,
		}),
	)
	.add(
		HttpApiEndpoint.post('addChannel', '/contacts/:id/channels', {
			params: { id: Schema.String },
			payload: AddChannelInput,
			success: ContactChannel.json,
		}),
	)
	.add(
		HttpApiEndpoint.patch(
			'updateChannel',
			'/contacts/:id/channels/:channelId',
			{
				params: { id: Schema.String, channelId: Schema.String },
				payload: PatchChannelInput,
				success: ContactChannel.json,
			},
		),
	)
	.add(
		HttpApiEndpoint.delete(
			'deleteChannel',
			'/contacts/:id/channels/:channelId',
			{
				params: { id: Schema.String, channelId: Schema.String },
				success: Schema.Void,
			},
		),
	)
	.add(
		// Clears a bounced/complained suppression on the email channel so the
		// contact can receive mail again. Restricted to the suppression
		// reset — clients can't flip arbitrary status values via this route.
		HttpApiEndpoint.post(
			'clearSuppression',
			'/contacts/:id/email-suppression/clear',
			{
				params: { id: Schema.String },
				success: SuppressionCleared,
			},
		),
	)
	.middleware(SessionMiddleware)
	.middleware(OrgMiddleware)
	.prefix('/v1')

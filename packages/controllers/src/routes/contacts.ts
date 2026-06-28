import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/unstable/httpapi'

import { OrgMiddleware } from '../middleware/org'
import { SessionMiddleware } from '../middleware/session'

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
	isDecisionMaker: Schema.optional(Schema.Boolean),
	notes: Schema.optional(Schema.String),
	metadata: Schema.optional(Schema.Unknown),
	channels: Schema.optional(Schema.Array(ChannelInput)),
})

const UpdateContactInput = Schema.Struct({
	name: Schema.optional(Schema.String),
	role: Schema.optional(Schema.String),
	isDecisionMaker: Schema.optional(Schema.Boolean),
	notes: Schema.optional(Schema.String),
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

export const ContactsGroup = HttpApiGroup.make('contacts')
	.add(
		HttpApiEndpoint.get('list', '/contacts', {
			query: {
				companyId: Schema.optional(Schema.String),
			},
			success: Schema.Array(Schema.Unknown),
		}),
	)
	.add(
		HttpApiEndpoint.post('create', '/contacts', {
			payload: CreateContactInput,
			success: Schema.Unknown,
		}),
	)
	.add(
		HttpApiEndpoint.patch('update', '/contacts/:id', {
			params: { id: Schema.String },
			payload: UpdateContactInput,
			success: Schema.Unknown,
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
			success: Schema.Unknown,
		}),
	)
	.add(
		HttpApiEndpoint.patch(
			'updateChannel',
			'/contacts/:id/channels/:channelId',
			{
				params: { id: Schema.String, channelId: Schema.String },
				payload: PatchChannelInput,
				success: Schema.Unknown,
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
				success: Schema.Unknown,
			},
		),
	)
	.middleware(SessionMiddleware)
	.middleware(OrgMiddleware)
	.prefix('/v1')

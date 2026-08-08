import { Schema } from 'effect'
import {
	HttpApiEndpoint,
	HttpApiGroup,
	HttpApiSchema,
} from 'effect/unstable/httpapi'

import {
	Contact,
	ContactChannel,
	HandSetVerificationVerdict,
} from '@batuda/domain'

import { BadRequest, NotFound } from '../errors'
import { OrgMiddleware } from '../middleware/org'
import { SessionMiddleware } from '../middleware/session'
import { PaginatedList, pageQuery } from '../pagination'

// A reachable channel supplied in bulk (agent/import path). `kind` is open
// (email, phone, linkedin, x, website, bluesky, …); only the email channel
// carries a deliverability `verification`.
//
// A verdict here may only ever lower how far an address is trusted: saying one
// is good is a thing a mailbox probe finds out, and `deliverable` is the single
// word the send gate lets through, so a caller able to write it could clear its
// own way. The confidence score that goes with a verdict is not accepted at all
// — it belongs to whatever established the verdict. Suppression status is
// system-managed and never accepted from a client either.
const ChannelInput = Schema.Struct({
	kind: Schema.String,
	value: Schema.String,
	label: Schema.optional(Schema.String),
	verification: Schema.optional(HandSetVerificationVerdict),
	is_primary: Schema.optional(Schema.Boolean),
})

const CreateContactInput = Schema.Struct({
	companyId: Schema.String,
	// The branch this person works at, when the company has more than one.
	siteId: Schema.optional(Schema.String),
	name: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
	role: Schema.optional(Schema.String),
	buyingRole: Schema.optional(Schema.String),
	metadata: Schema.optional(Schema.Unknown),
	channels: Schema.optional(Schema.Array(ChannelInput)),
})

const UpdateContactInput = Schema.Struct({
	siteId: Schema.optional(Schema.NullOr(Schema.String)),
	name: Schema.optional(Schema.String),
	role: Schema.optional(Schema.String),
	buyingRole: Schema.optional(Schema.String),
	metadata: Schema.optional(Schema.Unknown),
	channels: Schema.optional(Schema.Array(ChannelInput)),
})

// Granular channel edits (the human UI). Never the suppression status, and
// never a verdict that says an address is good — see `ChannelInput` above.
const AddChannelInput = Schema.Struct({
	kind: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
	value: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
	// Which of several this is, in a person's own words: "Girona shop",
	// "switchboard". Without it a second mailbox is just another address.
	label: Schema.optional(Schema.String),
	is_primary: Schema.optional(Schema.Boolean),
})

const PatchChannelInput = Schema.Struct({
	kind: Schema.optional(Schema.String),
	// Held to the same minimum as adding one: most kinds have no shape to check
	// against, so without this a blank would be stored as an address.
	value: Schema.optional(
		Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
	),
	// Nullable so a name given by mistake can be taken back off; leaving it out
	// keeps whatever is there.
	label: Schema.optional(Schema.NullOr(Schema.String)),
	is_primary: Schema.optional(Schema.Boolean),
	verification: Schema.optional(HandSetVerificationVerdict),
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
			// An address that could never be one of its kind — a phone number in the
			// email field — is said so plainly rather than read as a server fault.
			error: BadRequest.pipe(HttpApiSchema.status(400)),
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
				// Every channel of every company, branch and person lives in one
				// table, so a channel id that is not this contact's is a wrong
				// address rather than a server fault — and must not be edited.
				error: Schema.Union([
					BadRequest.pipe(HttpApiSchema.status(400)),
					NotFound.pipe(HttpApiSchema.status(404)),
				]),
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
				error: NotFound.pipe(HttpApiSchema.status(404)),
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

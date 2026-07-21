import { Schema } from 'effect'
import {
	HttpApiEndpoint,
	HttpApiGroup,
	HttpApiSchema,
} from 'effect/unstable/httpapi'

import { LangCode } from '@batuda/domain'

import { BadRequest, Conflict, Forbidden } from '../errors'
import { OrgMiddleware } from '../middleware/org'
import { SessionMiddleware } from '../middleware/session'

// ── Input ──

export const AddMemberInput = Schema.Struct({
	email: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
	// An owner only exists by creating the organization, so someone added here
	// joins as a member or an admin.
	role: Schema.Literals(['member', 'admin']),
	// Chosen by whoever adds them: it decides which translation their welcome
	// email is written in and which language their first visit renders in.
	locale: LangCode,
})

// ── Views ──

export const AddedMemberView = Schema.Struct({
	id: Schema.String,
	userId: Schema.String,
	email: Schema.String,
	name: Schema.NullOr(Schema.String),
	role: Schema.String,
	locale: Schema.String,
	createdAt: Schema.String,
})

// People join by being added, not by accepting an invitation: nothing sent to
// their inbox can be used to sign in, so there is no pending state and nothing
// that expires. `OrgMiddleware` settles which organization the caller is
// acting in, and only owners and admins of it may add someone.
export const MembersGroup = HttpApiGroup.make('members')
	.add(
		HttpApiEndpoint.post('add', '/members', {
			payload: AddMemberInput,
			success: AddedMemberView,
			error: [
				Forbidden.pipe(HttpApiSchema.status(403)),
				Conflict.pipe(HttpApiSchema.status(409)),
				BadRequest.pipe(HttpApiSchema.status(400)),
			],
		}),
	)
	.middleware(SessionMiddleware)
	.middleware(OrgMiddleware)
	.prefix('/v1')

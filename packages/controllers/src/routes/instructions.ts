import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/unstable/httpapi'

import { OrgMiddleware } from '../middleware/org'
import { SessionMiddleware } from '../middleware/session'

// ── Inputs ──
//
// `scope` decides whether a write targets a personal template (the actor) or an
// org-owned one, which anyone in the organization may manage. Mutation
// responses carry a discriminated `{ outcome }` in the body (Schema.Unknown)
// rather than mapping every case to an HTTP status, so the UI and MCP read the
// same shape.

const Scope = Schema.Literals(['personal', 'org'])

const CreateTemplateInput = Schema.Struct({
	name: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
	body: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
	scope: Scope,
})

const UpdateTemplateInput = Schema.Struct({
	name: Schema.optional(
		Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
	),
	body: Schema.optional(
		Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
	),
})

const TransferInput = Schema.Struct({ target_user_id: Schema.String })

const Composition = Schema.Literals(['replace', 'extend'])

const CreateStackInput = Schema.Struct({
	agent: Schema.String,
	scope: Scope,
	name: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
	template_ids: Schema.Array(Schema.String),
	// Personal stacks only: 'extend' layers the templates on the live org
	// default; absent/'replace' uses the stack alone. Ignored for org stacks.
	composition: Schema.optional(Composition),
	is_default: Schema.optional(Schema.Boolean),
})

const UpdateStackInput = Schema.Struct({
	name: Schema.optional(
		Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
	),
	template_ids: Schema.optional(Schema.Array(Schema.String)),
	composition: Schema.optional(Composition),
})

// ── Route group ──

export const InstructionsGroup = HttpApiGroup.make('instructions')
	.add(
		HttpApiEndpoint.get('listTemplates', '/instructions/templates', {
			success: Schema.Unknown,
		}),
	)
	.add(
		HttpApiEndpoint.post('createTemplate', '/instructions/templates', {
			payload: CreateTemplateInput,
			success: Schema.Unknown,
		}),
	)
	.add(
		HttpApiEndpoint.get('getTemplate', '/instructions/templates/:id', {
			params: { id: Schema.String },
			success: Schema.Unknown,
		}),
	)
	.add(
		HttpApiEndpoint.patch('updateTemplate', '/instructions/templates/:id', {
			params: { id: Schema.String },
			payload: UpdateTemplateInput,
			success: Schema.Unknown,
		}),
	)
	.add(
		HttpApiEndpoint.delete('deleteTemplate', '/instructions/templates/:id', {
			params: { id: Schema.String },
			success: Schema.Unknown,
		}),
	)
	.add(
		HttpApiEndpoint.post(
			'transferTemplate',
			'/instructions/templates/:id/transfer',
			{
				params: { id: Schema.String },
				payload: TransferInput,
				success: Schema.Unknown,
			},
		),
	)
	.add(
		HttpApiEndpoint.get('listStacks', '/instructions/stacks', {
			query: { agent: Schema.optional(Schema.String) },
			success: Schema.Unknown,
		}),
	)
	.add(
		HttpApiEndpoint.post('createStack', '/instructions/stacks', {
			payload: CreateStackInput,
			success: Schema.Unknown,
		}),
	)
	.add(
		HttpApiEndpoint.get('getStack', '/instructions/stacks/:id', {
			params: { id: Schema.String },
			success: Schema.Unknown,
		}),
	)
	.add(
		HttpApiEndpoint.patch('updateStack', '/instructions/stacks/:id', {
			params: { id: Schema.String },
			payload: UpdateStackInput,
			success: Schema.Unknown,
		}),
	)
	.add(
		HttpApiEndpoint.delete('deleteStack', '/instructions/stacks/:id', {
			params: { id: Schema.String },
			success: Schema.Unknown,
		}),
	)
	.add(
		HttpApiEndpoint.put('setDefaultStack', '/instructions/stacks/:id/default', {
			params: { id: Schema.String },
			success: Schema.Unknown,
		}),
	)
	.add(
		HttpApiEndpoint.delete(
			'clearDefaultStack',
			'/instructions/agents/:agent/default',
			{
				params: { agent: Schema.String },
				query: { scope: Schema.optional(Scope) },
				success: Schema.Unknown,
			},
		),
	)
	.add(
		HttpApiEndpoint.get(
			'getResolution',
			'/instructions/agents/:agent/resolution',
			{ params: { agent: Schema.String }, success: Schema.Unknown },
		),
	)
	.middleware(SessionMiddleware)
	.middleware(OrgMiddleware)
	.prefix('/v1')

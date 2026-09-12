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
	// Org research stacks only: whether a run fills the attributes declared on
	// the stack. Off until an admin turns it on.
	research_fills_attributes: Schema.optional(Schema.Boolean),
})

const UpdateStackInput = Schema.Struct({
	name: Schema.optional(
		Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
	),
	template_ids: Schema.optional(Schema.Array(Schema.String)),
	composition: Schema.optional(Composition),
	research_fills_attributes: Schema.optional(Schema.Boolean),
})

// A fact the organisation records on every company a stack is used for. The
// rules — key shape, kinds, caps, the eight-per-stack limit — are checked in
// code, and a refusal comes back as an `{ outcome }` code like a stack write.
const CreateAttributeInput = Schema.Struct({
	stack_id: Schema.String,
	key: Schema.String,
	label: Schema.String,
	kind: Schema.String,
	enum_values: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
	unit: Schema.optional(Schema.NullOr(Schema.String)),
	description: Schema.optional(Schema.NullOr(Schema.String)),
})

// The key never changes once created; an explicit null clears the choice
// words, the unit or the description.
const UpdateAttributeInput = Schema.Struct({
	label: Schema.optional(Schema.String),
	kind: Schema.optional(Schema.String),
	enum_values: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
	unit: Schema.optional(Schema.NullOr(Schema.String)),
	description: Schema.optional(Schema.NullOr(Schema.String)),
	is_active: Schema.optional(Schema.Boolean),
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
	.add(
		HttpApiEndpoint.get('listAttributes', '/instructions/attributes', {
			query: {
				stackId: Schema.optional(Schema.String),
				agent: Schema.optional(Schema.String),
			},
			success: Schema.Unknown,
		}),
	)
	.add(
		HttpApiEndpoint.post('createAttribute', '/instructions/attributes', {
			payload: CreateAttributeInput,
			success: Schema.Unknown,
		}),
	)
	.add(
		HttpApiEndpoint.patch('updateAttribute', '/instructions/attributes/:id', {
			params: { id: Schema.String },
			payload: UpdateAttributeInput,
			success: Schema.Unknown,
		}),
	)
	.add(
		HttpApiEndpoint.delete('deleteAttribute', '/instructions/attributes/:id', {
			params: { id: Schema.String },
			success: Schema.Unknown,
		}),
	)
	.middleware(SessionMiddleware)
	.middleware(OrgMiddleware)
	.prefix('/v1')

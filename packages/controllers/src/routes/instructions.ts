import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/unstable/httpapi'

import { OrgMiddleware } from '../middleware/org'
import { SessionMiddleware } from '../middleware/session'

// ── Inputs ──
//
// `scope` decides whether a write targets a personal template (the actor) or an
// org-owned one (admin-gated in the handler). Mutation responses carry a
// discriminated `{ outcome }` in the body (Schema.Unknown) rather than mapping
// every case to an HTTP status, so the UI and MCP read the same shape.

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

const SetStackInput = Schema.Struct({
	template_ids: Schema.Array(Schema.String),
	// Personal stacks only: 'extend' layers the templates on the live org
	// default; absent/'replace' uses the stack alone. Ignored for org stacks.
	composition: Schema.optional(Schema.Literals(['replace', 'extend'])),
})

const ImportPresetInput = Schema.Struct({ scope: Scope })

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
		HttpApiEndpoint.post(
			'donateTemplate',
			'/instructions/templates/:id/donate',
			{ params: { id: Schema.String }, success: Schema.Unknown },
		),
	)
	.add(
		HttpApiEndpoint.get(
			'getDefaultStacks',
			'/instructions/agents/:agent/default-stack',
			{ params: { agent: Schema.String }, success: Schema.Unknown },
		),
	)
	.add(
		HttpApiEndpoint.put(
			'setUserStack',
			'/instructions/agents/:agent/default-stack',
			{
				params: { agent: Schema.String },
				payload: SetStackInput,
				success: Schema.Unknown,
			},
		),
	)
	.add(
		HttpApiEndpoint.delete(
			'clearUserStack',
			'/instructions/agents/:agent/default-stack',
			{ params: { agent: Schema.String }, success: Schema.Unknown },
		),
	)
	.add(
		HttpApiEndpoint.put(
			'setOrgStack',
			'/instructions/agents/:agent/org-default-stack',
			{
				params: { agent: Schema.String },
				payload: SetStackInput,
				success: Schema.Unknown,
			},
		),
	)
	.add(
		HttpApiEndpoint.get('listPresets', '/instructions/presets', {
			query: { agent: Schema.optional(Schema.String) },
			success: Schema.Unknown,
		}),
	)
	.add(
		HttpApiEndpoint.post(
			'importPreset',
			'/instructions/presets/:presetId/import',
			{
				params: { presetId: Schema.String },
				payload: ImportPresetInput,
				success: Schema.Unknown,
			},
		),
	)
	.add(
		HttpApiEndpoint.get('listDonations', '/instructions/donations', {
			query: { status: Schema.optional(Schema.String) },
			success: Schema.Unknown,
		}),
	)
	.add(
		HttpApiEndpoint.post(
			'acceptDonation',
			'/instructions/donations/:id/accept',
			{ params: { id: Schema.String }, success: Schema.Unknown },
		),
	)
	.add(
		HttpApiEndpoint.post(
			'rejectDonation',
			'/instructions/donations/:id/reject',
			{ params: { id: Schema.String }, success: Schema.Unknown },
		),
	)
	.middleware(SessionMiddleware)
	.middleware(OrgMiddleware)
	.prefix('/v1')

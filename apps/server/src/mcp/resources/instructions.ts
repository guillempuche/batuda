import { Effect, Schema } from 'effect'
import { McpSchema, McpServer } from 'effect/unstable/ai'

import { CurrentOrg, SessionContext } from '@batuda/controllers'
import {
	AgentSchema,
	agents,
	getDefaultStacks,
	listTemplates,
	resolveInstructions,
} from '@batuda/instructions'

const agentParam = McpSchema.param('agent', Schema.String)

// A read-only menu of instruction templates plus the active default stack for an
// agent, so a capable client can read the user's standing rules before composing
// (research findings, an email body) without a tool round-trip. Reads run inside
// the request's org scope, so templates and stacks are already RLS-scoped to this
// org plus the caller's own. The agent param is validated against the code set
// (research, email); an unknown agent returns the valid list rather than failing.
export const InstructionsResource =
	McpServer.resource`batuda://instructions/${agentParam}`({
		name: 'Agent Instructions',
		description:
			'Instruction templates readable in this org plus the active default stack for an agent (research, email). Read before composing so output follows the user’s standing rules. For research, override per run with start_research/research_sync `instructions`; for email, follow these when composing. The apply-instruction and save-instruction prompts use and capture them.',
		mimeType: 'application/json',
		audience: ['assistant'],
		completion: {
			agent: (input: string) =>
				Effect.succeed(agents.filter(a => a.startsWith(input))),
		},
		content: Effect.fn(function* (_uri, agentRaw) {
			const agent = Schema.is(AgentSchema)(agentRaw) ? agentRaw : null
			if (!agent) {
				return JSON.stringify(
					{ error: `unknown agent: ${agentRaw}`, agents: [...agents] },
					null,
					2,
				)
			}
			const org = yield* CurrentOrg
			const { userId } = yield* SessionContext
			const templates = yield* listTemplates().pipe(Effect.orDie)
			const stacks = yield* getDefaultStacks(org.id, userId, agent).pipe(
				Effect.orDie,
			)
			// The effective instructions for a run with no override — what actually
			// fires today, after the user-replaces-org precedence the resolver applies.
			const active = yield* resolveInstructions({
				organizationId: org.id,
				userId,
				agent,
			}).pipe(Effect.orDie)
			return JSON.stringify(
				{
					agent,
					templates: templates.map(t => ({
						id: t.id,
						name: t.name,
						scope: t.ownerUserId === null ? 'org' : 'personal',
						body: t.body,
					})),
					default_stacks: stacks,
					active: {
						source: active.source,
						names: active.templateNames,
						segments: active.segments,
					},
				},
				null,
				2,
			)
		}),
	})

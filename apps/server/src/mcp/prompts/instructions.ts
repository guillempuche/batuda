import { Effect, Schema } from 'effect'
import { McpServer } from 'effect/unstable/ai'

import {
	AgentSchema,
	agents,
	isUuidRef,
	listTemplates,
} from '@batuda/instructions'

// User-controlled entry points (slash commands) for the instruction-template
// feature — the protocol-standard home for human-invoked actions, distinct from
// the model-controlled tools and the application-controlled menu resource.
// `apply-instruction` resolves a named instruction and tells the AI to apply it
// to the next agent action; `save-instruction` walks the AI through capturing a
// standing preference with the existing management tools.

const scopeLabel = (ownerUserId: string | null): 'org' | 'personal' =>
	ownerUserId === null ? 'org' : 'personal'

// ── apply-instruction ────────────────────────────────────────────────────────

export const ApplyInstructionPrompt = McpServer.prompt({
	name: 'apply-instruction',
	description:
		'Apply a saved instruction (by name or id) to the next research run or email. Resolves the instruction and directs the AI to use it.',
	parameters: {
		agent: Schema.String,
		instruction: Schema.String,
	},
	completion: {
		agent: (input: string) =>
			Effect.succeed(agents.filter(a => a.startsWith(input))),
		instruction: (input: string) =>
			listTemplates().pipe(
				Effect.map(rows =>
					rows
						.map(t => t.name)
						.filter(name => name.toLowerCase().startsWith(input.toLowerCase())),
				),
				Effect.orElseSucceed(() => [] as Array<string>),
			),
	},
	content: ({ agent, instruction }) =>
		Effect.gen(function* () {
			if (!Schema.is(AgentSchema)(agent)) {
				return `Unknown agent "${agent}". Valid agents: ${agents.join(', ')}.`
			}
			const templates = yield* listTemplates().pipe(Effect.orDie)
			// A ref is an id when it's UUID-shaped, otherwise a human name. RLS has
			// already limited `templates` to the org's plus the caller's own, so a
			// name that matches nothing here is one the user genuinely can't apply.
			const matches = templates.filter(t =>
				isUuidRef(instruction) ? t.id === instruction : t.name === instruction,
			)
			if (matches.length === 0) {
				const available = templates.map(t => `"${t.name}"`).join(', ') || 'none'
				return `No instruction "${instruction}" is available for ${agent}. Readable instructions: ${available}. Ask the user which they meant, or create it with manage_instruction_template.`
			}
			if (matches.length > 1) {
				const candidates = matches
					.map(t => `${scopeLabel(t.ownerUserId)} (id ${t.id})`)
					.join('; ')
				return `"${instruction}" matches more than one instruction: ${candidates}. Ask the user which one, then apply it by its id.`
			}
			const tpl = matches[0]
			if (!tpl) return `No instruction "${instruction}" is available.`
			const how =
				agent === 'research'
					? `call start_research or research_sync with instructions: ["${tpl.name}"] (or the id ${tpl.id}) so the run records and applies it`
					: 'follow this instruction when you compose the email body'
			return `Apply the "${tpl.name}" instruction (${scopeLabel(tpl.ownerUserId)}) to your next ${agent} action.

Instruction:
${tpl.body}

To apply it, ${how}. If the user wants this on by default, use manage_instruction_default_stack.`
		}),
})

// ── save-instruction ─────────────────────────────────────────────────────────

export const SaveInstructionPrompt = McpServer.prompt({
	name: 'save-instruction',
	description:
		'Save a standing preference the user expressed as a reusable instruction template (personal or org), using the existing management tools.',
	parameters: {
		name: Schema.String,
		scope: Schema.Literals(['personal', 'org']),
	},
	completion: {
		scope: (input: string) =>
			Effect.succeed(
				(['personal', 'org'] as const).filter(s => s.startsWith(input)),
			),
	},
	content: ({ name, scope }) =>
		Effect.succeed(`The user wants to save a standing instruction named "${name}" (${scope} scope).

1. Capture the preference the user expressed in this conversation as the instruction body — concise and imperative (e.g. "Always open with the contact's first name").
2. Create it: call manage_instruction_template with action "create", name "${name}", scope "${scope}", and that body. (scope "org" is admin-only and is rejected for non-admins — save it as "personal" instead if that happens.)
3. Offer to apply it by default for an agent (research or email) with manage_instruction_default_stack action "set", or per call via the apply-instruction prompt.`),
})

// Cheap static regression net so future tools can't silently land without
// annotation hygiene. Imports every toolkit, walks its tools, and asserts
// the contract every MCP client relies on. New invariants belong here.

import { Context } from 'effect'
import { Tool } from 'effect/unstable/ai'
import { describe, expect, it } from 'vitest'

import { CalendarTools } from './calendar'
import { CompanyTools } from './companies'
import { ContactTools } from './contacts'
import { DocumentTools } from './documents'
import { EmailTools } from './email'
import { InstructionsMcpTools } from './instructions-mcp'
import { InteractionTools } from './interactions'
import { MemberTools } from './members'
import { PageTools } from './pages'
import { PipelineTools } from './pipeline'
import { ProductTools } from './products'
import { ProposalTools } from './proposals'
import { RecordingTools } from './recordings'
import { ResearchContactsTools } from './research-contacts'
import { ResearchLifecycleTools } from './research-lifecycle'
import { ResearchMcpTools } from './research-mcp'
import { ResearchRegistryTools } from './research-registry'
import { TaskTools } from './tasks'
import { TimelineTools } from './timeline'

const TOOLKITS = {
	CalendarTools,
	CompanyTools,
	ContactTools,
	DocumentTools,
	EmailTools,
	InstructionsMcpTools,
	InteractionTools,
	MemberTools,
	PageTools,
	PipelineTools,
	ProductTools,
	ProposalTools,
	RecordingTools,
	ResearchContactsTools,
	ResearchLifecycleTools,
	ResearchMcpTools,
	ResearchRegistryTools,
	TaskTools,
	TimelineTools,
}

// Action-parameterized tools fold multiple verbs (create / update / delete,
// or approve / skip) into one tool; the idempotent and destructive hints
// apply per-action, not to the tool as a whole, so they opt out of the
// naming-pattern invariants below.
const isActionParameterized = (toolName: string): boolean =>
	toolName.startsWith('manage_') || toolName.startsWith('resolve_')

// A floor, not an exact figure: adding one tool should not fail this file, but
// registering a whole toolkit in the server without listing it in TOOLKITS
// above should, since everything below only walks what is listed there.
const EXPECTED_TOOL_COUNT = 95

const READ_ONLY_NAME = /^(list_|get_|search_|find_|lookup_)/
const DESTRUCTIVE_NAME = /^(delete_|discard_|cancel_)/
const IDEMPOTENT_NAME =
	/^(update_|mark_|set_|reschedule_|reopen_|snooze_|complete_)/

// Tools whose result already carries a field shaped as a choice inside a
// choice — a number that may be absent. Named one by one so the rule can keep
// new ones out without pretending these are fine.
//
// `update_company` is here because a company's priority and its two map
// coordinates are shaped that way in the company record itself, which is
// decoded from every stored row and cannot be tightened without turning rows
// already holding an odd value into failures. It only became visible once the
// rule started looking through "or nothing" below; the company field-shape
// work is what removes it.
const KNOWN_NESTED_CHOICE = new Set(['log_interaction'])

// The published shape of a result, with "or nothing" peeled off. A read that
// answers with nothing publishes a choice between its shape and null, and
// reading the fields off that outer choice finds none — which would quietly
// stop the rules below from checking anything at all.
const resultShape = (
	schema: Tool.Any['successSchema'],
): { properties?: Record<string, unknown>; type?: unknown } => {
	const published = Tool.getJsonSchemaFromSchema(schema) as {
		anyOf?: ReadonlyArray<{ type?: unknown }>
		properties?: Record<string, unknown>
		type?: unknown
	}
	const branches = (published.anyOf ?? []).filter(
		branch => branch.type !== 'null',
	)
	return published.anyOf !== undefined && branches.length === 1
		? (branches[0] as { properties?: Record<string, unknown>; type?: unknown })
		: published
}

describe('MCP tool annotation coverage', () => {
	describe('given the set of tools every rule below walks', () => {
		it('should let no tool go unchecked', () => {
			// GIVEN the toolkits this file imports one by one, by hand
			// WHEN comparing them against the tools the server actually serves
			// THEN none is missing — a toolkit added to the server but not here is
			//      silently exempt from every rule in this file
			const walked = Object.values(TOOLKITS).flatMap(toolkit =>
				Object.keys(toolkit.tools),
			)
			expect(walked.length).toBe(new Set(walked).size)
			expect(walked.length).toBeGreaterThanOrEqual(EXPECTED_TOOL_COUNT)
		})

		it('should exempt only tools that still exist', () => {
			// GIVEN the named exemptions from the flat-result rule
			// WHEN checking each against the live tools
			// THEN every one still names a real tool — `it.skipIf` cannot fail, so
			//      an exemption left behind after a rename quietly stops applying
			//      to anything while looking like it still guards something
			const live = new Set(
				Object.values(TOOLKITS).flatMap(toolkit => Object.keys(toolkit.tools)),
			)
			const stale = [...KNOWN_NESTED_CHOICE].filter(name => !live.has(name))
			expect(stale, `${stale.join(', ')} no longer exists`).toEqual([])
		})
	})

	for (const [toolkitName, toolkit] of Object.entries(TOOLKITS)) {
		describe(`given ${toolkitName}`, () => {
			for (const [toolName, tool] of Object.entries(toolkit.tools)) {
				describe(`when introspecting ${toolName}`, () => {
					it('should declare Tool.Title', () => {
						// GIVEN a tool registered in the toolkit
						// WHEN reading Tool.Title from its annotations
						// THEN the value is a non-empty string (every MCP client
						//      surfaces this as the visible action label)
						// [tools/${toolkitName} — Tool.Title invariant]
						const title = Context.getOrUndefined(tool.annotations, Tool.Title)
						expect(title, `${toolName} missing Tool.Title`).toBeDefined()
						expect(
							typeof title === 'string' && title.length > 0,
							`${toolName} Tool.Title must be a non-empty string`,
						).toBe(true)
					})

					it('should expose an object-typed inputSchema', () => {
						// GIVEN a tool registered in the toolkit
						// WHEN generating its MCP inputSchema (the same call the
						//      server makes when answering tools/list)
						// THEN the JSON Schema root is type "object" — clients hide
						//      every tool in the list when one breaks this rule, and
						//      an empty Schema.Struct({}) produces a typeless root, so
						//      no-arg tools must leave parameters off entirely
						// [tools/${toolkitName} — inputSchema root-type invariant]
						const inputSchema = Tool.getJsonSchema(tool) as {
							type?: unknown
						}
						expect(
							inputSchema.type,
							`${toolName} inputSchema root must be type:"object"; drop empty Schema.Struct({}) (omit parameters instead)`,
						).toBe('object')
					})

					it('should not encode structured output as a bare array', () => {
						// GIVEN a tool's success schema — Effect copies the encoded
						//       value straight into the result's structuredContent
						// WHEN converting that schema to JSON Schema
						// THEN the root is not type:"array" — MCP requires
						//      structuredContent to be a JSON object, so a strict
						//      client rejects a bare-array result and hides the tool.
						//      List tools must wrap rows in an object (_result.ts
						//      ListResult → { items }).
						// [tools/${toolkitName} — structured-output object invariant]
						const outputSchema = resultShape(tool.successSchema)
						expect(
							outputSchema.type,
							`${toolName} success schema must not encode to a JSON array; wrap the list in an object (ListResult / { items })`,
						).not.toBe('array')
					})

					it('should say whether it returned everything it found', () => {
						// GIVEN a tool that lets the caller cap how many rows come
						//       back, so its answer may be only part of the truth
						// WHEN reading its success schema
						// THEN the schema says somewhere that rows were left behind —
						//      `hasMore` for a single list, or a `…Truncated` flag per
						//      list where one cap covers several. Without either, an
						//      assistant reports the part it got as the whole answer
						// [tools/${toolkitName} — truncation-signal invariant]
						const input = Tool.getJsonSchema(tool) as {
							properties?: Record<string, unknown>
						}
						if (input.properties?.['limit'] === undefined) return
						const output = resultShape(tool.successSchema)
						const signals = Object.keys(output.properties ?? {}).filter(
							field => field === 'hasMore' || field.endsWith('Truncated'),
						)
						expect(
							signals,
							`${toolName} takes a limit but never says whether more rows exist; return PageResult / TruncatableResult from _result.ts, or one \`…Truncated\` flag per list`,
						).not.toEqual([])
					})

					it.skipIf(KNOWN_NESTED_CHOICE.has(toolName))(
						'should describe every result field as one kind of thing',
						() => {
							// GIVEN a tool registered in the toolkit
							// WHEN reading the shape it publishes for its result
							// THEN no field offers a choice nested inside another
							//      choice — some model providers reject a tool that
							//      publishes one rather than read it, and the tool
							//      disappears for everyone on that provider
							// [tools/${toolkitName} — flat result-shape invariant]
							const output = resultShape(tool.successSchema)
							const nested = Object.entries(output.properties ?? {})
								.filter(([, shape]) =>
									((shape as { anyOf?: Array<unknown> }).anyOf ?? []).some(
										branch =>
											(branch as { anyOf?: unknown }).anyOf !== undefined,
									),
								)
								.map(([field]) => field)
							expect(
								nested,
								`${toolName} publishes ${nested.join(', ')} as a choice inside a choice`,
							).toEqual([])
						},
					)

					if (READ_ONLY_NAME.test(toolName)) {
						it('should declare Tool.Readonly = true', () => {
							// GIVEN a tool whose name matches a read-only convention
							//       (list_/get_/search_/find_/lookup_)
							// WHEN reading Tool.Readonly from its annotations
							// THEN the value is exactly true so MCP clients can call
							//      it without surfacing a write-confirmation prompt
							// [tools/${toolkitName} — read-only naming invariant]
							const readonly = Context.getOrUndefined(
								tool.annotations,
								Tool.Readonly,
							)
							expect(
								readonly,
								`${toolName} should annotate Tool.Readonly=true (query-named tools must declare it)`,
							).toBe(true)
						})
					}

					if (DESTRUCTIVE_NAME.test(toolName)) {
						it('should declare Tool.Destructive = true', () => {
							// GIVEN a tool whose name matches a destructive convention
							//       (delete_/discard_/cancel_)
							// WHEN reading Tool.Destructive from its annotations
							// THEN the value is exactly true so MCP clients can prompt
							//      the user before executing
							// [tools/${toolkitName} — destructive naming invariant]
							const destructive = Context.getOrUndefined(
								tool.annotations,
								Tool.Destructive,
							)
							expect(
								destructive,
								`${toolName} must annotate Tool.Destructive=true`,
							).toBe(true)
						})
					}

					if (
						IDEMPOTENT_NAME.test(toolName) &&
						!isActionParameterized(toolName)
					) {
						it('should declare Tool.Idempotent = true', () => {
							// GIVEN a tool whose name matches a safe-retry convention
							//       (update_/mark_/set_/reschedule_/reopen_/snooze_/complete_)
							//   AND the tool is not action-parameterized (manage_/resolve_)
							// WHEN reading Tool.Idempotent from its annotations
							// THEN the value is exactly true so MCP clients can retry
							//      on transient failure without duplicating side effects
							// [tools/${toolkitName} — idempotent naming invariant]
							const idempotent = Context.getOrUndefined(
								tool.annotations,
								Tool.Idempotent,
							)
							expect(
								idempotent,
								`${toolName} should annotate Tool.Idempotent=true (safe-retry by convention)`,
							).toBe(true)
						})
					}
				})
			}
		})
	}
})

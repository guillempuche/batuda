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
import { PageTools } from './pages'
import { PipelineTools } from './pipeline'
import { ProductTools } from './products'
import { ProposalTools } from './proposals'
import { RecordingTools } from './recordings'
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
	PageTools,
	PipelineTools,
	ProductTools,
	ProposalTools,
	RecordingTools,
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

const READ_ONLY_NAME = /^(list_|get_|search_|find_|lookup_)/
const DESTRUCTIVE_NAME = /^(delete_|discard_|cancel_)/
const IDEMPOTENT_NAME =
	/^(update_|mark_|set_|reschedule_|reopen_|snooze_|complete_)/

// Tools that take a `limit` but deliberately do not report whether they cut
// anything off. Named one by one so dropping a tool out of the rule is a
// decision somebody made on purpose, not something a new tool inherits.
const TRUNCATION_EXEMPT = new Set([
	// Answers with two separate lists under one limit, so a single "there is
	// more" cannot say which of them it refers to.
	'get_next_steps',
	// Bounded by the stretch of time asked for rather than by a row count.
	'list_upcoming_meetings',
])

// Tools whose result already carries a field shaped as a choice inside a
// choice — a number that may be absent. Named one by one so the rule can keep
// new ones out without pretending these two are fine.
const KNOWN_NESTED_CHOICE = new Set([
	'download_email_attachment',
	'log_interaction',
])

describe('MCP tool annotation coverage', () => {
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
						const outputSchema = Tool.getJsonSchemaFromSchema(
							tool.successSchema,
						) as { type?: unknown }
						expect(
							outputSchema.type,
							`${toolName} success schema must not encode to a JSON array; wrap the list in an object (ListResult / { items })`,
						).not.toBe('array')
					})

					if (!TRUNCATION_EXEMPT.has(toolName)) {
						it('should say whether it returned everything it found', () => {
							// GIVEN a tool that lets the caller cap how many rows come
							//       back, so its answer may be only part of the truth
							// WHEN reading its success schema
							// THEN the schema carries `hasMore` — the only thing that
							//      tells a short list apart from a long one cut short,
							//      so an assistant without it reports the page it got
							//      as the whole answer
							// [tools/${toolkitName} — truncation-signal invariant]
							const input = Tool.getJsonSchema(tool) as {
								properties?: Record<string, unknown>
							}
							if (input.properties?.['limit'] === undefined) return
							const output = Tool.getJsonSchemaFromSchema(
								tool.successSchema,
							) as { properties?: Record<string, unknown> }
							expect(
								output.properties?.['hasMore'],
								`${toolName} takes a limit but never says whether more rows exist; return PageResult / TruncatableResult from _result.ts`,
							).toBeDefined()
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
								const output = Tool.getJsonSchemaFromSchema(
									tool.successSchema,
								) as { properties?: Record<string, unknown> }
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
					}

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

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

// RenamedTools is left out on purpose: every rule below describes the surface a
// client discovers, and those tools are registered precisely so they never
// appear in it. The naming rules would read them as real — delete_email_inbox
// as destructive, for one — and make them claim things they do not do.
// renamed-tools.test.ts holds their rules instead.
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
const EXPECTED_TOOL_COUNT = 97

// A parameter that names another record: `id`, `id_or_slug`, or anything
// ending in `_id`. An assistant holds what a person said, never a database, so
// a value of this shape can only have come from an earlier call — and one that
// does not say which call is the whole of the failure this rule exists for.
const NAMES_ANOTHER_RECORD = /^(id|id_or_slug|.*_id)$/

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

// Tools that ask a person before they act, because they spend money, write to
// somebody's records, or cannot be undone. Listed by hand: what a handler does
// is invisible to a walk over tool definitions, so this names the promise and
// the rule below checks each one can still report a refusal.
//
// It is not the whole set of tools that ought to ask — several more act on the
// world with no gate at all, and finding those is its own piece of work.
const GATED_TOOLS = [
	'delete_research',
	'discover_contacts',
	'publish_page',
	'research_policy',
	'resolve_research_paid_action',
	'resolve_research_proposed_update',
] as const

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

		it('should let no tool declare an approval nothing reads', () => {
			// GIVEN `needsApproval`, which Effect reads only in its AI client loop
			// WHEN looking for it on the tools this MCP server publishes
			// THEN none declares it — on this surface the field does nothing, so a
			//      tool carrying it runs unasked while its description promises
			//      otherwise. Ask with `requireApproval` in the handler instead.
			const declaring = Object.values(TOOLKITS).flatMap(toolkit =>
				Object.entries(toolkit.tools)
					// Present on every tool and usually undefined — it is a declared
					// value that matters, not the key.
					.filter(
						([, tool]) =>
							(tool as { needsApproval?: unknown }).needsApproval !== undefined,
					)
					.map(([name]) => name),
			)
			expect(
				declaring,
				`${declaring.join(', ')} declare needsApproval, which this server never reads`,
			).toEqual([])
		})

		it('should let a gated tool say it was not approved', () => {
			// GIVEN the tools that ask a person before they act
			// WHEN reading the shape each one promises to answer with
			// THEN every one can carry a refusal. A closed success schema cannot,
			//      so the refusal would fail to encode and the caller would meet a
			//      crash where it should read "nobody approved this".
			//
			//      This checks the shape, not the asking — a static walk sees tool
			//      definitions, never their handlers, so it cannot tell whether a
			//      handler calls requireApproval. It keeps a gated tool able to
			//      report a refusal; it does not discover an ungated one.
			for (const name of GATED_TOOLS) {
				const tool = Object.values(TOOLKITS)
					.flatMap(toolkit => Object.entries(toolkit.tools))
					.find(([toolName]) => toolName === name)?.[1]
				expect(
					tool,
					`${name} is gated but no toolkit here publishes it`,
				).toBeDefined()
				const published = JSON.stringify(
					Tool.getJsonSchemaFromSchema((tool as Tool.Any).successSchema),
				)
				// Either the tool names a refusal outright — `confirmation_required`
				// where there was nobody to ask, `cancelled` where the answer was
				// no — or its result is unconstrained and any shape fits.
				expect(
					published.includes('confirmation_required') ||
						published.includes('cancelled') ||
						published === '{}',
					`${name} asks for approval but cannot answer that it did not get it`,
				).toBe(true)
			}
		})

		it('should let the tools that write a message take a mailbox the same way', () => {
			// GIVEN send_email and manage_email_draft, which both compose a
			//       message for the same person out of the same mailboxes
			// WHEN reading the parameters each one publishes
			// THEN neither insists on a mailbox. An assistant is told to write an
			//      email, never which mailbox to write it from, so a rule learned
			//      on one of these is applied to the other — and where the two
			//      disagreed, the failure named a key the caller had never heard
			//      of, which is no new information, so it sent the same call again
			const writers = ['send_email', 'manage_email_draft']
			const insisting = writers.filter(name => {
				const tool = Object.entries(EmailTools.tools).find(
					([toolName]) => toolName === name,
				)?.[1]
				expect(tool, `${name} is no longer published`).toBeDefined()
				const input = Tool.getJsonSchema(tool as Tool.Any) as {
					required?: ReadonlyArray<string>
					properties?: Record<string, unknown>
				}
				expect(
					input.properties?.['inbox_id'],
					`${name} no longer takes inbox_id at all`,
				).toBeDefined()
				return (input.required ?? []).includes('inbox_id')
			})
			expect(
				insisting,
				`${insisting.join(', ')} will not write a message without being told which mailbox, while its sibling will`,
			).toEqual([])
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

					it('should say where every id it insists on comes from', () => {
						// GIVEN a tool that will not run without an id
						// WHEN reading the parameters it publishes
						// THEN each such id says which call produces one. Without
						//      that the caller guesses, is told only that a key it
						//      never heard of is missing, and — having learned
						//      nothing — sends the very same request again
						// [tools/${toolkitName} — id-source invariant]
						const input = Tool.getJsonSchema(tool) as {
							required?: ReadonlyArray<string>
							properties?: Record<string, { description?: unknown }>
						}
						const unsourced = (input.required ?? [])
							.filter(name => NAMES_ANOTHER_RECORD.test(name))
							.filter(name => {
								const said = input.properties?.[name]?.description
								return typeof said !== 'string' || said.trim() === ''
							})
						expect(
							unsourced,
							`${toolName} requires ${unsourced.join(', ')} without saying where to get one; annotate the parameter with the call that returns it (see ./_ids.ts)`,
						).toEqual([])
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

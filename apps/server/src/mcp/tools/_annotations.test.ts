// Cheap static regression net so future tools can't silently land without
// annotation hygiene. Imports every toolkit, walks its tools, and asserts
// the contract every MCP client relies on. New invariants belong here.

import { ServiceMap } from 'effect'
import { Tool } from 'effect/unstable/ai'
import { describe, expect, it } from 'vitest'

import { CalendarTools } from './calendar'
import { CompanyTools } from './companies'
import { ContactTools } from './contacts'
import { DocumentTools } from './documents'
import { EmailTools } from './email'
import { InteractionTools } from './interactions'
import { PageTools } from './pages'
import { PipelineTools } from './pipeline'
import { ProductTools } from './products'
import { ProposalTools } from './proposals'
import { RecordingTools } from './recordings'
import { ResearchCrmTools } from './research-crm'
import { ResearchLifecycleTools } from './research-lifecycle'
import { ResearchMcpTools } from './research-mcp'
import { ResearchRegistryTools } from './research-registry'
import { ResearchSinkTools } from './research-sink'
import { ResearchWebTools } from './research-web'
import { TaskTools } from './tasks'
import { TimelineTools } from './timeline'

const TOOLKITS = {
	CalendarTools,
	CompanyTools,
	ContactTools,
	DocumentTools,
	EmailTools,
	InteractionTools,
	PageTools,
	PipelineTools,
	ProductTools,
	ProposalTools,
	RecordingTools,
	ResearchCrmTools,
	ResearchLifecycleTools,
	ResearchMcpTools,
	ResearchRegistryTools,
	ResearchSinkTools,
	ResearchWebTools,
	TaskTools,
	TimelineTools,
}

// Action-parameterized tools fold multiple verbs (create / update / delete,
// or approve / skip) into one tool; the idempotent and destructive hints
// apply per-action, not to the tool as a whole, so they opt out of the
// naming-pattern invariants below.
const isActionParameterized = (toolName: string): boolean =>
	toolName.startsWith('manage_') || toolName.startsWith('resolve_')

const READ_ONLY_NAME = /^(list_|get_|search_|find_|lookup_|web_)/
const DESTRUCTIVE_NAME = /^(delete_|discard_|cancel_)/
const IDEMPOTENT_NAME =
	/^(update_|mark_|set_|reschedule_|reopen_|snooze_|complete_)/

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
						const title = ServiceMap.getOrUndefined(
							tool.annotations,
							Tool.Title,
						)
						expect(title, `${toolName} missing Tool.Title`).toBeDefined()
						expect(
							typeof title === 'string' && title.length > 0,
							`${toolName} Tool.Title must be a non-empty string`,
						).toBe(true)
					})

					if (READ_ONLY_NAME.test(toolName)) {
						it('should declare Tool.Readonly = true', () => {
							// GIVEN a tool whose name matches a read-only convention
							//       (list_/get_/search_/find_/lookup_/web_)
							// WHEN reading Tool.Readonly from its annotations
							// THEN the value is exactly true so MCP clients can call
							//      it without surfacing a write-confirmation prompt
							// [tools/${toolkitName} — read-only naming invariant]
							const readonly = ServiceMap.getOrUndefined(
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
							const destructive = ServiceMap.getOrUndefined(
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
							const idempotent = ServiceMap.getOrUndefined(
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

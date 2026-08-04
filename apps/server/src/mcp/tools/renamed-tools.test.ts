import { Schema } from 'effect'
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
import {
	RENAMED_TOOLS,
	RenamedTools,
	removedToolMessage,
} from './renamed-tools'
import { ResearchContactsTools } from './research-contacts'
import { ResearchLifecycleTools } from './research-lifecycle'
import { ResearchMcpTools } from './research-mcp'
import { ResearchRegistryTools } from './research-registry'
import { TaskTools } from './tasks'
import { TimelineTools } from './timeline'

// Every tool the server actually serves, so the rules below can be checked
// against the live surface rather than against a second hand-kept list.
const LIVE_TOOL_NAMES = new Set(
	[
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
		ResearchContactsTools,
		ResearchLifecycleTools,
		ResearchMcpTools,
		ResearchRegistryTools,
		TaskTools,
		TimelineTools,
	].flatMap(toolkit => Object.keys(toolkit.tools)),
)

// The tool names an advice sentence points the caller at. Action names are
// written in quotes and tool names bare, so dropping the quoted spans first
// leaves only the tools — otherwise an action like "create_template" reads as a
// tool that does not exist.
const namedTools = (advice: string): ReadonlyArray<string> =>
	advice.replace(/"[^"]*"/g, ' ').match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? []

describe('renamed MCP tools', () => {
	describe('given the table of names this server no longer answers to', () => {
		it('should not shadow a tool the server still serves', () => {
			// GIVEN the entries registered for removed names
			// WHEN comparing them against every live tool
			// THEN none collides — an entry sharing a name with a real tool would
			//      answer "this was removed" for a tool that works
			const shadowed = RENAMED_TOOLS.map(({ gone }) => gone).filter(gone =>
				LIVE_TOOL_NAMES.has(gone),
			)
			expect(
				shadowed,
				`${shadowed.join(', ')} is registered as both a live tool and a removed one`,
			).toEqual([])
		})

		it('should send the caller to a tool that exists', () => {
			// GIVEN each entry's advice, which names its replacement
			// WHEN checking those names against the live tools
			// THEN every one is real — advice naming a tool that was itself removed
			//      in a later round sends the caller from one dead name to another
			const dangling = RENAMED_TOOLS.flatMap(({ gone, advice }) =>
				namedTools(advice)
					.filter(name => !LIVE_TOOL_NAMES.has(name))
					.map(name => `${gone} → ${name}`),
			)
			expect(
				dangling,
				`advice points at tools that do not exist: ${dangling.join('; ')}`,
			).toEqual([])
		})

		it('should register one tool per removed name', () => {
			// GIVEN the table
			// WHEN reading the toolkit built from it
			// THEN each name appears exactly once — a duplicate entry would
			//      silently drop one of the two
			const registered = Object.keys(RenamedTools.tools)
			expect(registered.length).toBe(RENAMED_TOOLS.length)
			expect(new Set(registered)).toEqual(
				new Set(RENAMED_TOOLS.map(({ gone }) => gone)),
			)
		})
	})

	describe('given a caller still holding the old tool list', () => {
		it('should accept the arguments that caller sends', () => {
			// GIVEN create_company's pre-rename arguments
			// WHEN validating them against the registered tool's parameters
			// THEN they pass — arguments rejected as malformed would hide the one
			//      thing the caller needs to hear, that the tool moved
			const tool = RenamedTools.tools['create_company']
			if (!tool) throw new Error('create_company is not registered')
			expect(() =>
				Schema.decodeUnknownSync(tool.parametersSchema)({
					name: 'Test Co',
					slug: 'test-co',
				}),
			).not.toThrow()
		})

		it('should publish an object-typed inputSchema', () => {
			// GIVEN each registered tool
			// WHEN generating the schema the server would publish for it
			// THEN the root is type "object" — a typeless root makes strict clients
			//      discard the entire tool list
			for (const tool of Object.values(RenamedTools.tools)) {
				const inputSchema = Tool.getJsonSchema(tool) as { type?: unknown }
				expect(inputSchema.type, `${tool.name} inputSchema root`).toBe('object')
			}
		})

		it('should be told where the work went and why its list is wrong', () => {
			// GIVEN the message the handler fails with
			// WHEN reading it for create_company
			// THEN it names the replacement and says the list is stale, so an
			//      assistant reconnects instead of retrying the same dead call
			const entry = RENAMED_TOOLS.find(({ gone }) => gone === 'create_company')
			if (!entry) throw new Error('create_company has no entry')
			const message = removedToolMessage(entry)
			expect(message).toContain('create_companies')
			expect(message).toContain('reconnect')
		})
	})
})

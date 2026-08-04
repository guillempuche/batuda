import { Effect, Schema } from 'effect'
import { McpSchema, Tool, Toolkit } from 'effect/unstable/ai'

import { ToolMessage } from '../tool-message'

// Names this server used to answer to. An assistant that listed its tools
// before a rename keeps calling the old name for as long as it holds that list,
// and nothing tells it otherwise: the protocol's tools/list_changed notification
// does not reach the clients we serve, so a cached list is never invalidated.
// Left alone every one of those calls comes back "Tool 'x' not found", which
// says nothing about what to call instead — so each dead name stays registered,
// hidden from the list a client discovers, answering only with where its work
// went.
//
// The hiding only applies for a client the server has seen initialize; one that
// lists without initializing is handed everything, these included. Their
// descriptions say they were removed and name the replacement, so the worst it
// costs such a client is a longer list that tells the truth.

interface RenamedTool {
	readonly gone: string
	readonly advice: string
}

export const RENAMED_TOOLS: ReadonlyArray<RenamedTool> = [
	{
		gone: 'create_company',
		advice:
			'It is now create_companies, which creates a batch: pass { companies: [ { name, slug, … } ] } with one element to create a single company.',
	},
	{
		gone: 'create_email_inbox',
		advice: 'Use manage_email_inbox with action "create".',
	},
	{
		gone: 'update_email_inbox',
		advice: 'Use manage_email_inbox with action "update".',
	},
	{
		gone: 'test_email_inbox',
		advice: 'Use manage_email_inbox with action "test".',
	},
	{
		gone: 'delete_email_inbox',
		advice: 'Use manage_email_inbox with action "delete".',
	},
	{
		gone: 'set_primary_email_inbox',
		advice: 'Use manage_email_inbox with action "set_primary".',
	},
	{
		gone: 'get_email_inbox_status',
		advice:
			'Use list_email_inboxes: it reports whether the caller has a primary mailbox (hasDefault, plus its id and address) alongside the rows.',
	},
	{
		gone: 'list_inbox_footers',
		advice: 'Use manage_inbox_footer with action "list".',
	},
	{
		gone: 'get_inbox_footer',
		advice: 'Use manage_inbox_footer with action "get".',
	},
	{
		gone: 'list_event_types',
		advice: 'Use manage_event_types with action "list".',
	},
	{
		gone: 'sync_event_types',
		advice: 'Use manage_event_types with action "sync".',
	},
	{
		gone: 'manage_instruction_template',
		advice:
			'Use manage_instructions with the template actions "list_templates", "get_template", "create_template", "update_template", "delete_template" and "transfer_template".',
	},
	{
		gone: 'manage_instruction_default_stack',
		advice:
			'Use manage_instructions with action "set_default_stack" or "clear_default_stack".',
	},
	{
		gone: 'manage_instruction_donation',
		advice:
			'Donations are retired: every member may now create and edit org-owned templates directly, so call manage_instructions with action "create_template" and scope "org". To hand a template you own to a colleague, use action "transfer_template".',
	},
]

// Saying the list is out of date matters as much as naming the replacement:
// otherwise an assistant retries the same call, with no reason to suspect its
// own list is the problem.
export const removedToolMessage = ({ gone, advice }: RenamedTool): string =>
	`${gone} no longer exists on this server. ${advice} Your tool list is out of date — reconnect to refresh it.`

// Accepts whatever the stale caller sent. Leaving parameters off publishes
// Tool.EmptyParams, which admits only `{}`, so the old arguments would fail
// validation and the caller would hear that they are wrong rather than that the
// tool moved. Any keys are fine here, and the published root stays an object,
// which strict clients require.
const StaleArguments = Schema.Record(Schema.String, Schema.Unknown)

const makeTombstone = ({ gone, advice }: RenamedTool) =>
	Tool.make(gone, {
		description: `Removed. ${advice}`,
		parameters: StaleArguments,
		success: Schema.Struct({}),
	})
		// Callable by name, but kept out of the list a client discovers.
		.annotate(McpSchema.EnabledWhen, () => false)
		.annotate(Tool.Title, `Removed: ${gone}`)
		.annotate(Tool.Readonly, true)
		.annotate(Tool.Destructive, false)
		.annotate(Tool.OpenWorld, false)

export const RenamedTools = Toolkit.make(...RENAMED_TOOLS.map(makeTombstone))

export const RenamedToolsHandlersLive = RenamedTools.toLayer(
	Object.fromEntries(
		RENAMED_TOOLS.map(entry => [
			entry.gone,
			() => Effect.die(new ToolMessage(removedToolMessage(entry))),
		]),
	),
)

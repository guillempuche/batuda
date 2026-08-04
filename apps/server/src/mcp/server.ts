import { Layer } from 'effect'

import { CompanyResearchPrompt } from './prompts/company-research'
import { DailyBriefingPrompt } from './prompts/daily-briefing'
import {
	ApplyInstructionPrompt,
	SaveInstructionPrompt,
} from './prompts/instructions'
import { InteractionFollowUpPrompt } from './prompts/interaction-follow-up'
import { ProposalDraftPrompt } from './prompts/proposal-draft'
import { ResearchDesignerPrompt } from './prompts/research-designer'
import { CompanyResource } from './resources/company'
import { DocumentResource } from './resources/document'
import { InstructionsResource } from './resources/instructions'
import { PipelineResource } from './resources/pipeline'
import { ResearchResource } from './resources/research'
import { TimelineResource } from './resources/timeline'
import { mcpToolkitSafe } from './safe-toolkit'
import { CalendarHandlersLive, CalendarTools } from './tools/calendar'
import { CompanyHandlersLive, CompanyTools } from './tools/companies'
import { ContactHandlersLive, ContactTools } from './tools/contacts'
import { DocumentHandlersLive, DocumentTools } from './tools/documents'
import { EmailHandlersLive, EmailTools } from './tools/email'
import {
	InstructionsMcpHandlersLive,
	InstructionsMcpTools,
} from './tools/instructions-mcp'
import { InteractionHandlersLive, InteractionTools } from './tools/interactions'
import { MemberHandlersLive, MemberTools } from './tools/members'
import { PageHandlersLive, PageTools } from './tools/pages'
import { PipelineHandlersLive, PipelineTools } from './tools/pipeline'
import { ProductHandlersLive, ProductTools } from './tools/products'
import { ProposalHandlersLive, ProposalTools } from './tools/proposals'
import { RecordingHandlersLive, RecordingTools } from './tools/recordings'
import { RenamedTools, RenamedToolsHandlersLive } from './tools/renamed-tools'
import {
	ResearchContactsHandlersLive,
	ResearchContactsTools,
} from './tools/research-contacts'
import {
	ResearchLifecycleHandlersLive,
	ResearchLifecycleTools,
} from './tools/research-lifecycle'
import { ResearchMcpHandlersLive, ResearchMcpTools } from './tools/research-mcp'
import {
	ResearchRegistryHandlersLive,
	ResearchRegistryTools,
} from './tools/research-registry'
import { TaskHandlersLive, TaskTools } from './tools/tasks'
import { TimelineHandlersLive, TimelineTools } from './tools/timeline'

export const McpToolsLive = Layer.mergeAll(
	mcpToolkitSafe(CompanyTools),
	mcpToolkitSafe(ContactTools),
	mcpToolkitSafe(MemberTools),
	mcpToolkitSafe(InteractionTools),
	mcpToolkitSafe(TaskTools),
	mcpToolkitSafe(DocumentTools),
	mcpToolkitSafe(PageTools),
	mcpToolkitSafe(PipelineTools),
	mcpToolkitSafe(ProductTools),
	mcpToolkitSafe(ProposalTools),
	mcpToolkitSafe(EmailTools),
	mcpToolkitSafe(RecordingTools),
	mcpToolkitSafe(ResearchLifecycleTools),
	mcpToolkitSafe(ResearchMcpTools),
	mcpToolkitSafe(ResearchContactsTools),
	mcpToolkitSafe(ResearchRegistryTools),
	mcpToolkitSafe(InstructionsMcpTools),
	mcpToolkitSafe(TimelineTools),
	mcpToolkitSafe(CalendarTools),
	mcpToolkitSafe(RenamedTools),
	CompanyResource,
	PipelineResource,
	DocumentResource,
	ResearchResource,
	InstructionsResource,
	TimelineResource,
	CompanyResearchPrompt,
	DailyBriefingPrompt,
	ProposalDraftPrompt,
	InteractionFollowUpPrompt,
	ResearchDesignerPrompt,
	ApplyInstructionPrompt,
	SaveInstructionPrompt,
).pipe(
	Layer.provide(CompanyHandlersLive),
	Layer.provide(ContactHandlersLive),
	Layer.provide(MemberHandlersLive),
	Layer.provide(InteractionHandlersLive),
	Layer.provide(TaskHandlersLive),
	Layer.provide(DocumentHandlersLive),
	Layer.provide(PageHandlersLive),
	Layer.provide(PipelineHandlersLive),
	Layer.provide(ProductHandlersLive),
	Layer.provide(ProposalHandlersLive),
	Layer.provide(EmailHandlersLive),
	Layer.provide(RecordingHandlersLive),
	Layer.provide(ResearchLifecycleHandlersLive),
	Layer.provide(ResearchMcpHandlersLive),
	Layer.provide(ResearchContactsHandlersLive),
	Layer.provide(ResearchRegistryHandlersLive),
	Layer.provide(InstructionsMcpHandlersLive),
	Layer.provide(TimelineHandlersLive),
	Layer.provide(CalendarHandlersLive),
	Layer.provide(RenamedToolsHandlersLive),
)

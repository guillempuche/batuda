import { Layer } from 'effect'
import { McpServer } from 'effect/unstable/ai'

import { CompanyResearchPrompt } from './prompts/company-research'
import { DailyBriefingPrompt } from './prompts/daily-briefing'
import { InteractionFollowUpPrompt } from './prompts/interaction-follow-up'
import { ProposalDraftPrompt } from './prompts/proposal-draft'
import { ResearchDesignerPrompt } from './prompts/research-designer'
import { CompanyResource } from './resources/company'
import { DocumentResource } from './resources/document'
import { PipelineResource } from './resources/pipeline'
import { ResearchResource } from './resources/research'
import { TimelineResource } from './resources/timeline'
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
import { PageHandlersLive, PageTools } from './tools/pages'
import { PipelineHandlersLive, PipelineTools } from './tools/pipeline'
import { ProductHandlersLive, ProductTools } from './tools/products'
import { ProposalHandlersLive, ProposalTools } from './tools/proposals'
import { RecordingHandlersLive, RecordingTools } from './tools/recordings'
import {
	ResearchLifecycleHandlersLive,
	ResearchLifecycleTools,
} from './tools/research-lifecycle'
import { ResearchMcpHandlersLive, ResearchMcpTools } from './tools/research-mcp'
import { TaskHandlersLive, TaskTools } from './tools/tasks'
import { TimelineHandlersLive, TimelineTools } from './tools/timeline'

export const McpToolsLive = Layer.mergeAll(
	McpServer.toolkit(CompanyTools),
	McpServer.toolkit(ContactTools),
	McpServer.toolkit(InteractionTools),
	McpServer.toolkit(TaskTools),
	McpServer.toolkit(DocumentTools),
	McpServer.toolkit(PageTools),
	McpServer.toolkit(PipelineTools),
	McpServer.toolkit(ProductTools),
	McpServer.toolkit(ProposalTools),
	McpServer.toolkit(EmailTools),
	McpServer.toolkit(RecordingTools),
	McpServer.toolkit(ResearchLifecycleTools),
	McpServer.toolkit(ResearchMcpTools),
	McpServer.toolkit(InstructionsMcpTools),
	McpServer.toolkit(TimelineTools),
	McpServer.toolkit(CalendarTools),
	CompanyResource,
	PipelineResource,
	DocumentResource,
	ResearchResource,
	TimelineResource,
	CompanyResearchPrompt,
	DailyBriefingPrompt,
	ProposalDraftPrompt,
	InteractionFollowUpPrompt,
	ResearchDesignerPrompt,
).pipe(
	Layer.provide(CompanyHandlersLive),
	Layer.provide(ContactHandlersLive),
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
	Layer.provide(InstructionsMcpHandlersLive),
	Layer.provide(TimelineHandlersLive),
	Layer.provide(CalendarHandlersLive),
)

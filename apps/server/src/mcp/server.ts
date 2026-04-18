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
import { CompanyHandlersLive, CompanyTools } from './tools/companies'
import { ContactHandlersLive, ContactTools } from './tools/contacts'
import { DocumentHandlersLive, DocumentTools } from './tools/documents'
import { EmailHandlersLive, EmailTools } from './tools/email'
import { InteractionHandlersLive, InteractionTools } from './tools/interactions'
import { PageHandlersLive, PageTools } from './tools/pages'
import { PipelineHandlersLive, PipelineTools } from './tools/pipeline'
import { RecordingHandlersLive, RecordingTools } from './tools/recordings'
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
	McpServer.toolkit(EmailTools),
	McpServer.toolkit(RecordingTools),
	McpServer.toolkit(ResearchMcpTools),
	McpServer.toolkit(TimelineTools),
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
	Layer.provide(EmailHandlersLive),
	Layer.provide(RecordingHandlersLive),
	Layer.provide(ResearchMcpHandlersLive),
	Layer.provide(TimelineHandlersLive),
)

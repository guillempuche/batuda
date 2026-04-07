import { Layer } from 'effect'
import { McpServer } from 'effect/unstable/ai'

import { CompanyResearchPrompt } from './prompts/company-research'
import { DailyBriefingPrompt } from './prompts/daily-briefing'
import { InteractionFollowUpPrompt } from './prompts/interaction-follow-up'
import { ProposalDraftPrompt } from './prompts/proposal-draft'
import { CompanyResource } from './resources/company'
import { DocumentResource } from './resources/document'
import { PipelineResource } from './resources/pipeline'
import { CompanyHandlersLive, CompanyTools } from './tools/companies'
import { ContactHandlersLive, ContactTools } from './tools/contacts'
import { DocumentHandlersLive, DocumentTools } from './tools/documents'
import { EmailHandlersLive, EmailTools } from './tools/email'
import { InteractionHandlersLive, InteractionTools } from './tools/interactions'
import { PageHandlersLive, PageTools } from './tools/pages'
import { PipelineHandlersLive, PipelineTools } from './tools/pipeline'
import { TaskHandlersLive, TaskTools } from './tools/tasks'

export const McpToolsLive = Layer.mergeAll(
	McpServer.toolkit(CompanyTools),
	McpServer.toolkit(ContactTools),
	McpServer.toolkit(InteractionTools),
	McpServer.toolkit(TaskTools),
	McpServer.toolkit(DocumentTools),
	McpServer.toolkit(PageTools),
	McpServer.toolkit(PipelineTools),
	McpServer.toolkit(EmailTools),
	CompanyResource,
	PipelineResource,
	DocumentResource,
	CompanyResearchPrompt,
	DailyBriefingPrompt,
	ProposalDraftPrompt,
	InteractionFollowUpPrompt,
).pipe(
	Layer.provide(CompanyHandlersLive),
	Layer.provide(ContactHandlersLive),
	Layer.provide(InteractionHandlersLive),
	Layer.provide(TaskHandlersLive),
	Layer.provide(DocumentHandlersLive),
	Layer.provide(PageHandlersLive),
	Layer.provide(PipelineHandlersLive),
	Layer.provide(EmailHandlersLive),
)

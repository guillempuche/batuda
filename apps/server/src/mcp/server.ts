import { Layer } from 'effect'
import { McpServer } from 'effect/unstable/ai'

import { CompanyResource } from './resources/company'
import { PipelineResource } from './resources/pipeline'
import { CompanyHandlersLive, CompanyTools } from './tools/companies'
import { DocumentHandlersLive, DocumentTools } from './tools/documents'
import { InteractionHandlersLive, InteractionTools } from './tools/interactions'
import { PageHandlersLive, PageTools } from './tools/pages'
import { PipelineHandlersLive, PipelineTools } from './tools/pipeline'
import { TaskHandlersLive, TaskTools } from './tools/tasks'

export const McpToolsLive = Layer.mergeAll(
	McpServer.toolkit(CompanyTools),
	McpServer.toolkit(InteractionTools),
	McpServer.toolkit(TaskTools),
	McpServer.toolkit(DocumentTools),
	McpServer.toolkit(PageTools),
	McpServer.toolkit(PipelineTools),
	CompanyResource,
	PipelineResource,
).pipe(
	Layer.provide(CompanyHandlersLive),
	Layer.provide(InteractionHandlersLive),
	Layer.provide(TaskHandlersLive),
	Layer.provide(DocumentHandlersLive),
	Layer.provide(PageHandlersLive),
	Layer.provide(PipelineHandlersLive),
)

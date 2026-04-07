import { HttpApi } from 'effect/unstable/httpapi'

import { AgentMailWebhookGroup } from './routes/agentmail-webhook'
import { AuthGroup } from './routes/auth'
import { CompaniesGroup } from './routes/companies'
import { ContactsGroup } from './routes/contacts'
import { DocumentsGroup } from './routes/documents'
import { EmailGroup } from './routes/email'
import { HealthGroup } from './routes/health'
import { InteractionsGroup } from './routes/interactions'
import { PagesGroup } from './routes/pages'
import { ProductsGroup } from './routes/products'
import { ProposalsGroup } from './routes/proposals'
import { TasksGroup } from './routes/tasks'
import { WebhooksGroup } from './routes/webhooks'

export const ForjaApi = HttpApi.make('ForjaApi')
	.add(HealthGroup)
	.add(AuthGroup)
	.add(CompaniesGroup)
	.add(ContactsGroup)
	.add(InteractionsGroup)
	.add(TasksGroup)
	.add(DocumentsGroup)
	.add(ProductsGroup)
	.add(ProposalsGroup)
	.add(PagesGroup)
	.add(WebhooksGroup)
	.add(EmailGroup)
	.add(AgentMailWebhookGroup)

export type ForjaApi = typeof ForjaApi

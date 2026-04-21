import { HttpApi, OpenApi } from 'effect/unstable/httpapi'

import { AgentMailWebhookGroup } from './routes/agentmail-webhook'
import { AuthGroup } from './routes/auth'
import { CalendarGroup } from './routes/calendar'
import { CompaniesGroup } from './routes/companies'
import { ContactsGroup } from './routes/contacts'
import { DocumentsGroup } from './routes/documents'
import { EmailGroup } from './routes/email'
import { HealthGroup } from './routes/health'
import { InteractionsGroup } from './routes/interactions'
import { PagesGroup } from './routes/pages'
import { ProductsGroup } from './routes/products'
import { ProposalsGroup } from './routes/proposals'
import { RecordingsGroup } from './routes/recordings'
import { ResearchGroup } from './routes/research'
import { TasksGroup } from './routes/tasks'
import { TimelineGroup } from './routes/timeline'
import { WebhooksGroup } from './routes/webhooks'

export const BatudaApi = HttpApi.make('BatudaApi')
	.annotateMerge(
		OpenApi.annotations({
			title: 'Batuda API',
			version: '0.1.0',
			description:
				'CRM and sales pipeline API for Batuda. Covers companies, contacts, interactions, tasks, documents, proposals, products, email, and recordings.',
		}),
	)
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
	.add(RecordingsGroup)
	.add(ResearchGroup)
	.add(TimelineGroup)
	.add(CalendarGroup)

export type BatudaApi = typeof BatudaApi

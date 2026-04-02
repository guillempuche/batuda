import { HttpApi } from 'effect/unstable/httpapi'

import { CompaniesGroup } from './routes/companies'
import { ContactsGroup } from './routes/contacts'
import { DocumentsGroup } from './routes/documents'
import { HealthGroup } from './routes/health'
import { InteractionsGroup } from './routes/interactions'
import { PagesGroup } from './routes/pages'
import { ProductsGroup } from './routes/products'
import { ProposalsGroup } from './routes/proposals'
import { TasksGroup } from './routes/tasks'
import { WebhooksGroup } from './routes/webhooks'

export const ForjaApi = HttpApi.make('ForjaApi')
	.add(HealthGroup)
	.add(CompaniesGroup)
	.add(ContactsGroup)
	.add(InteractionsGroup)
	.add(TasksGroup)
	.add(DocumentsGroup)
	.add(ProductsGroup)
	.add(ProposalsGroup)
	.add(PagesGroup)
	.add(WebhooksGroup)

export type ForjaApi = typeof ForjaApi

import { HttpApi } from 'effect/unstable/httpapi'

import { CompaniesGroup } from './routes/companies'
import { ContactsGroup } from './routes/contacts'
import { DocumentsGroup } from './routes/documents'
import { InteractionsGroup } from './routes/interactions'
import { PagesGroup } from './routes/pages'
import { ProductsGroup } from './routes/products'
import { ProposalsGroup } from './routes/proposals'
import { TasksGroup } from './routes/tasks'
import { WebhooksGroup } from './routes/webhooks'

export const BatudaApi = HttpApi.make('BatudaApi')
	.add(CompaniesGroup)
	.add(ContactsGroup)
	.add(InteractionsGroup)
	.add(TasksGroup)
	.add(DocumentsGroup)
	.add(ProductsGroup)
	.add(ProposalsGroup)
	.add(PagesGroup)
	.add(WebhooksGroup)

export type BatudaApi = typeof BatudaApi

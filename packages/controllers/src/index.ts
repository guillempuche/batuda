// Shared HttpApi spec — imported by both the server (as handler targets)
// and the frontend (as a typed Atom client via AtomHttpApi.Service).
export { ForjaApi } from './api'
// Tagged errors used in endpoint error unions. Handlers and clients both
// pattern-match on these via `_tag`.
export {
	BadRequest,
	ConfirmRequired,
	Conflict,
	EmailError,
	EmailSendError,
	EmailSendErrorKind,
	EmailSuppressed,
	InsufficientBudget,
	NotFound,
	StorageError,
	StorageErrorOperation,
	Unauthorized,
} from './errors'
// Middleware Tag + SessionContext — the implementing Layer lives in
// `apps/server` because it depends on Better-Auth and Node HTTP. Route
// groups reference the Tag so they can declare `.middleware(SessionMiddleware)`
// without pulling in server-only runtime.
export { SessionContext, SessionMiddleware } from './middleware/session'
// Route groups exported individually so consumers that need a subset
// (e.g., MCP tools that only wire health + auth) don't have to import
// the whole ForjaApi.
export { AgentMailWebhookGroup } from './routes/agentmail-webhook'
export { AuthGroup } from './routes/auth'
export { CompaniesGroup } from './routes/companies'
export { ContactsGroup } from './routes/contacts'
export { DocumentsGroup } from './routes/documents'
export { EmailGroup } from './routes/email'
export { HealthGroup } from './routes/health'
export { InteractionsGroup } from './routes/interactions'
export { PagesGroup } from './routes/pages'
export { ProductsGroup } from './routes/products'
export { ProposalsGroup } from './routes/proposals'
export { RecordingMetadata, RecordingsGroup } from './routes/recordings'
export { ResearchGroup } from './routes/research'
export { TasksGroup } from './routes/tasks'
export { TimelineGroup } from './routes/timeline'
export { WebhooksGroup } from './routes/webhooks'

// Re-exported so MCP tools can `yield* CurrentOrg` the same way they
// `yield* CurrentUser`, without importing the controllers package's
// HTTP-flavored entry point. The tag itself lives in
// `@batuda/controllers/middleware/org` so HTTP handlers and MCP tools
// share one identity.
export { CurrentOrg } from '@batuda/controllers'

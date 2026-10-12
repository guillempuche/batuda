import { Context, type Effect } from 'effect'

import type { CurrentOrg } from '@batuda/controllers'

/**
 * How one MCP request enters its organization's scope: the transaction, the
 * row-level-security role and the org a caller signed in to.
 *
 * Over HTTP the reply to a call can stream before the call has finished — a
 * tool that asks the person something sends the question first and goes on
 * once they answer. A transaction opened around the HTTP request would commit
 * the moment that question went out, and whatever the tool did after the
 * answer would run outside it, on a connection another request may hold by
 * then. So the sign-in step hands over a way in, and each tool call, resource
 * and prompt enters the scope for exactly as long as it runs.
 */
export class McpOrgScope extends Context.Service<
	McpOrgScope,
	{
		readonly run: <A, E, R>(
			effect: Effect.Effect<A, E, R>,
		) => Effect.Effect<A, E, Exclude<R, CurrentOrg>>
	}
>()('McpOrgScope') {}

// Runs MCP work inside the signed-in organization's scope. There is no way to
// run it without one: work that found no scope would read as the server's own
// database role, which row-level security does not hold to one organization.
//
// The scope is a request service, handed over at sign-in and never present at
// boot, so like CurrentOrg it is left out of the type; a call that finds none
// stops with a defect.
export const inMcpOrgScope = <A, E, R>(
	effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, Exclude<R, CurrentOrg>> =>
	McpOrgScope.use(scope => scope.run(effect)) as Effect.Effect<
		A,
		E,
		Exclude<R, CurrentOrg>
	>

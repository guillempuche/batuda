import { Effect } from 'effect'
import type { SqlClient } from 'effect/unstable/sql'

// What an assistant calls itself, taken from the handshake it sends when it
// opens a session. Self-reported, so it is a label that helps a person tell
// their own connections apart — never proof of who is calling.
export type ClientIdentity = {
	readonly name: string | null
	readonly version: string | null
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
	typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null

const nonEmptyString = (value: unknown): string | null =>
	typeof value === 'string' && value.length > 0 ? value : null

// Pull the assistant's name and version out of an opening handshake. Anything
// else — an ordinary call, a batch of them, a body that isn't JSON at all —
// yields nothing, because only the handshake carries this.
export const clientIdentityOf = (body: unknown): ClientIdentity | null => {
	const message = asRecord(body)
	if (message?.['method'] !== 'initialize') return null
	const info = asRecord(asRecord(message['params'])?.['clientInfo'])
	if (!info) return null
	const identity = {
		name: nonEmptyString(info['name']),
		version: nonEmptyString(info['version']),
	}
	return identity.name === null && identity.version === null ? null : identity
}

/**
 * Record which tool is using a given key or connection, so the settings pages
 * can tell one from another.
 *
 * Must run inside the organization's scope: the row can then only ever land in
 * the organization the request resolved to, because the database checks it.
 *
 * The last-used stamp is written for connections only. A key already carries
 * one on the key row itself, and a second clock for the same thing would drift.
 * The update is skipped unless the tool changed or the stamp is over a minute
 * old, so a chatty assistant does not write on every single call — a minute's
 * resolution is all the pages show — while a change of tool still lands at once.
 */
export const recordClientSeen = (
	sql: SqlClient.SqlClient,
	opts: {
		readonly orgId: string
		readonly principalKind: 'api_key' | 'oauth'
		readonly principalId: string
		readonly userId: string
		readonly client: ClientIdentity | null
		readonly userAgent: string | null
	},
) =>
	sql`
		INSERT INTO mcp_client_seen (
			organization_id, principal_kind, principal_id, user_id,
			client_name, client_version, user_agent, last_seen_at
		) VALUES (
			${opts.orgId}, ${opts.principalKind}, ${opts.principalId}, ${opts.userId},
			${opts.client?.name ?? null}, ${opts.client?.version ?? null},
			${opts.userAgent},
			CASE WHEN ${opts.principalKind === 'oauth'} THEN now() ELSE NULL END
		)
		ON CONFLICT (organization_id, principal_kind, principal_id, user_id)
		DO UPDATE SET
			client_name = COALESCE(EXCLUDED.client_name, mcp_client_seen.client_name),
			client_version = COALESCE(EXCLUDED.client_version, mcp_client_seen.client_version),
			user_agent = COALESCE(EXCLUDED.user_agent, mcp_client_seen.user_agent),
			last_seen_at = COALESCE(EXCLUDED.last_seen_at, mcp_client_seen.last_seen_at)
		WHERE (EXCLUDED.client_name IS NOT NULL
					 AND EXCLUDED.client_name IS DISTINCT FROM mcp_client_seen.client_name)
			 OR (EXCLUDED.client_version IS NOT NULL
					 AND EXCLUDED.client_version IS DISTINCT FROM mcp_client_seen.client_version)
			 OR (EXCLUDED.user_agent IS NOT NULL
					 AND EXCLUDED.user_agent IS DISTINCT FROM mcp_client_seen.user_agent)
			 OR (EXCLUDED.last_seen_at IS NOT NULL
					 AND (mcp_client_seen.last_seen_at IS NULL
								OR mcp_client_seen.last_seen_at < now() - interval '1 minute'))
	`.pipe(
		// Losing this record must never cost the caller their request — it is a
		// convenience on a settings page, not part of serving the call.
		Effect.catchCause(cause =>
			Effect.logWarning('Could not record MCP client identity').pipe(
				Effect.annotateLogs({
					event: 'mcp.client_seen.failed',
					orgId: opts.orgId,
					cause: String(cause),
				}),
			),
		),
	)

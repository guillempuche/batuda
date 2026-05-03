import { Data, Effect, Layer, ServiceMap } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

import type { CalcomWebhookPayload } from './calendar'

/**
 * Two-tier org lookup for inbound cal.com webhooks.
 *
 *   1. iCalUID against an existing cal.com calendar_event row
 *   2. organizer.email against an active inboxes row
 *   3. otherwise fail with `UnknownOrg`
 *
 * Runs as `app_service` (BYPASSRLS) inside its own transaction — the
 * resolver IS the gate that decides which org context to scope the rest
 * of the webhook into, so it can't itself depend on having an org.
 */

export class UnknownOrg extends Data.TaggedError('UnknownOrg')<{
	readonly icalUid: string | undefined
	readonly organizerEmail: string | undefined
}> {}

interface OrgScope {
	readonly id: string
	readonly name: string
	readonly slug: string
}

export class OrgResolution extends ServiceMap.Service<OrgResolution>()(
	'OrgResolution',
	{
		make: Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient

			const resolveOrgForCalcomWebhook = (payload: CalcomWebhookPayload) =>
				sql.withTransaction(
					Effect.gen(function* () {
						yield* sql`SET LOCAL ROLE app_service`

						const icalUid = payload.iCalUID
						const organizerEmail = payload.organizer?.email

						// Tier 1: iCalUID against existing cal.com booking row.
						// `(source, provider)` filter narrows away email-sourced
						// ICS rows that could share the same UID across orgs.
						if (icalUid !== undefined && icalUid.length > 0) {
							const eventRows = yield* sql<OrgScope>`
								SELECT o.id, o.name, o.slug
								FROM calendar_events ce
								JOIN "organization" o ON o.id = ce.organization_id
								WHERE ce.ical_uid = ${icalUid}
									AND ce.source = 'booking'
									AND ce.provider = 'calcom'
								ORDER BY ce.created_at DESC
								LIMIT 1
							`
							const hit = eventRows[0]
							if (hit) return hit
						}

						// Tier 2: organizer email against an active inbox row.
						// No global UNIQUE on inboxes.email — multiple orgs CAN
						// share an email (a person owning inboxes in two orgs).
						// `ORDER BY created_at ASC LIMIT 1` favours the longest-
						// standing inbox for deterministic ambiguity resolution.
						if (organizerEmail !== undefined && organizerEmail.length > 0) {
							const inboxRows = yield* sql<OrgScope>`
								SELECT o.id, o.name, o.slug
								FROM inboxes i
								JOIN "organization" o ON o.id = i.organization_id
								WHERE lower(i.email) = lower(${organizerEmail})
									AND i.active = true
								ORDER BY i.created_at ASC
								LIMIT 1
							`
							const hit = inboxRows[0]
							if (hit) return hit
						}

						return yield* Effect.fail(
							new UnknownOrg({ icalUid, organizerEmail }),
						)
					}),
				)

			return { resolveOrgForCalcomWebhook } as const
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make)
}

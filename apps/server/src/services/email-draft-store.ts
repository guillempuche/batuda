import { randomUUID } from 'node:crypto'

import { Effect, Layer, ServiceMap } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

import { CurrentOrg, NotFound } from '@batuda/controllers'

// Owns the full draft state in Postgres: recipient lists, subject, the
// editor block tree, threading metadata. Replaces the
// LocalInboxProvider's filesystem-backed draft surface so drafts survive
// server restarts and remain visible to org members on multiple machines.
//
// All operations are org-scoped via CurrentOrg. RLS on `email_drafts`
// enforces this at the database too — the WHERE clauses here are
// belt-and-suspenders, plus they let us return NotFound (instead of an
// opaque empty result) when the org context doesn't match.

export interface DraftRow {
	readonly draftId: string
	readonly organizationId: string
	readonly inboxId: string
	readonly mode: 'new' | 'reply'
	readonly toAddresses: ReadonlyArray<string>
	readonly ccAddresses: ReadonlyArray<string>
	readonly bccAddresses: ReadonlyArray<string>
	readonly subject: string | null
	readonly inReplyTo: string | null
	readonly threadLinkId: string | null
	readonly clientId: string | null
	readonly bodyJson: unknown
	readonly createdAt: Date
	readonly updatedAt: Date
}

export interface CreateDraftInput {
	readonly inboxId: string
	readonly mode?: 'new' | 'reply'
	readonly to?: ReadonlyArray<string>
	readonly cc?: ReadonlyArray<string>
	readonly bcc?: ReadonlyArray<string>
	readonly subject?: string | null
	readonly inReplyTo?: string | null
	readonly threadLinkId?: string | null
	readonly clientId?: string | null
	readonly bodyJson?: unknown
}

export interface UpdateDraftInput {
	readonly to?: ReadonlyArray<string>
	readonly cc?: ReadonlyArray<string>
	readonly bcc?: ReadonlyArray<string>
	readonly subject?: string | null
	readonly bodyJson?: unknown
}

const SELECT_COLUMNS = `
	draft_id, organization_id, inbox_id, mode,
	to_addresses, cc_addresses, bcc_addresses,
	subject, in_reply_to, thread_link_id, client_id,
	body_json, created_at, updated_at
`

export class DraftStore extends ServiceMap.Service<DraftStore>()('DraftStore', {
	make: Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient

		const create = (input: CreateDraftInput) =>
			Effect.gen(function* () {
				const currentOrg = yield* CurrentOrg
				const draftId = `draft_${randomUUID()}`
				const rows = yield* sql<DraftRow>`
					INSERT INTO email_drafts ${sql.insert({
						draftId,
						organizationId: currentOrg.id,
						inboxId: input.inboxId,
						mode: input.mode ?? 'new',
						toAddresses: input.to ?? [],
						ccAddresses: input.cc ?? [],
						bccAddresses: input.bcc ?? [],
						subject: input.subject ?? null,
						inReplyTo: input.inReplyTo ?? null,
						threadLinkId: input.threadLinkId ?? null,
						clientId: input.clientId ?? null,
						bodyJson: JSON.stringify(input.bodyJson ?? {}),
					})}
					RETURNING ${sql.unsafe(SELECT_COLUMNS)}
				`.pipe(Effect.orDie)
				const row = rows[0]
				if (!row) {
					return yield* Effect.die(
						new Error('INSERT INTO email_drafts RETURNING yielded no row'),
					)
				}
				return row
			})

		const get = (draftId: string) =>
			Effect.gen(function* () {
				const currentOrg = yield* CurrentOrg
				const rows = yield* sql<DraftRow>`
					SELECT ${sql.unsafe(SELECT_COLUMNS)}
					FROM email_drafts
					WHERE draft_id = ${draftId}
					  AND organization_id = ${currentOrg.id}
					LIMIT 1
				`.pipe(Effect.orDie)
				const row = rows[0]
				if (!row) {
					return yield* new NotFound({ entity: 'EmailDraft', id: draftId })
				}
				return row
			})

		const list = (inboxId?: string) =>
			Effect.gen(function* () {
				const currentOrg = yield* CurrentOrg
				if (inboxId) {
					return yield* sql<DraftRow>`
						SELECT ${sql.unsafe(SELECT_COLUMNS)}
						FROM email_drafts
						WHERE inbox_id = ${inboxId}
						  AND organization_id = ${currentOrg.id}
						ORDER BY updated_at DESC
					`.pipe(Effect.orDie)
				}
				return yield* sql<DraftRow>`
					SELECT ${sql.unsafe(SELECT_COLUMNS)}
					FROM email_drafts
					WHERE organization_id = ${currentOrg.id}
					ORDER BY updated_at DESC
				`.pipe(Effect.orDie)
			})

		const update = (draftId: string, input: UpdateDraftInput) =>
			Effect.gen(function* () {
				const currentOrg = yield* CurrentOrg
				const patch: Record<string, unknown> = { updatedAt: new Date() }
				if (input.to !== undefined) patch['toAddresses'] = input.to
				if (input.cc !== undefined) patch['ccAddresses'] = input.cc
				if (input.bcc !== undefined) patch['bccAddresses'] = input.bcc
				if (input.subject !== undefined) patch['subject'] = input.subject
				if (input.bodyJson !== undefined) {
					patch['bodyJson'] = JSON.stringify(input.bodyJson)
				}
				const rows = yield* sql<DraftRow>`
					UPDATE email_drafts SET ${sql.update(patch)}
					WHERE draft_id = ${draftId}
					  AND organization_id = ${currentOrg.id}
					RETURNING ${sql.unsafe(SELECT_COLUMNS)}
				`.pipe(Effect.orDie)
				const row = rows[0]
				if (!row) {
					return yield* new NotFound({ entity: 'EmailDraft', id: draftId })
				}
				return row
			})

		// `delete` is the natural API name but conflicts with the JS reserved
		// word at the call site (`store.delete(...)` works but is borderline);
		// `remove` is the convention in the rest of this codebase (e.g.
		// WebhookService.remove).
		const remove = (draftId: string) =>
			Effect.gen(function* () {
				const currentOrg = yield* CurrentOrg
				yield* sql`
					DELETE FROM email_drafts
					WHERE draft_id = ${draftId}
					  AND organization_id = ${currentOrg.id}
				`.pipe(Effect.orDie)
			})

		return { create, get, list, update, remove } as const
	}),
}) {
	static readonly layer = Layer.effect(this, this.make)
}

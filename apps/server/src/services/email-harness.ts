// Shared harness for the EmailService integration suites: the stand-ins a send
// path needs, the organisation a request runs as, and the transaction that puts
// the database role and the organisation id on the connection.
//
// Not a test file itself; imported by the `*.integration.test.ts` suites.
//
// One SqlClient throughout, deliberately. `enterOrgScope` sets the role and
// `app.current_org_id` on the connection it is handed, so a service built over
// a second `PgLive` would run its queries on a different connection and neither
// would apply — the suite would read as though it runs inside the
// organisation's own scope while actually running as the owner, and would go
// green on a query that had lost its organisation filter. So `PgLive` is
// provided once, at the top, and everything below builds over it.

import { randomUUID } from 'node:crypto'

import { Effect, Layer, ManagedRuntime } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

import {
	BadRequest,
	CurrentOrg,
	GrantConnectFailed,
	SessionContext,
} from '@batuda/controllers'
import { TimelineActivityService } from '@batuda/timeline'

import { PgLive } from '../db/client.js'
import { enterOrgScope } from '../middleware/org.js'
import { CalendarService } from './calendar.js'
import { CredentialCrypto } from './credential-crypto.js'
import { EmailService } from './email.js'
import {
	EmailAttachmentStaging,
	type ResolvedStaging,
} from './email-attachment-staging.js'
import { DraftStore } from './email-draft-store.js'
import { EmailProvider } from './email-provider.js'
import { MailTransport, type OutboundMessage } from './mail-transport.js'
import { StorageProvider } from './storage-provider.js'

/** What the transport was handed, for suites that assert on the wire message. */
export type SentMessage = OutboundMessage

/**
 * What the email service is built over here: stand-ins for everything a send
 * path reaches outside the database, and the real draft store, which is worth
 * exercising because these suites send drafts.
 *
 * `onSend` sees each outgoing message and answers with the Message-ID the
 * transport should report, the way SMTP does. A suite that only reads never
 * passes one, and gets a fresh id each time — two sends answering with the
 * same id would collide on the unique index over (organisation, message id).
 */
export interface HarnessOptions {
	/** Sees each outgoing message and answers with the Message-ID to report. */
	readonly onSend?: (message: SentMessage) => string
	/**
	 * What the staging service answers with at send time. Empty by default, so
	 * nothing downstream of it runs — set it to reach the attachment paths.
	 */
	readonly stagedAttachments?: readonly ResolvedStaging[]
	/**
	 * Makes the post-send purge fail with this message, for asserting what a
	 * failed purge leaves behind. The send itself must still succeed.
	 */
	readonly purgeFailure?: string
	/**
	 * Makes the transport refuse the message, with this as the reason the mail
	 * server gave. Note the send path retries before giving up, so a test using
	 * this needs a generous timeout.
	 */
	readonly sendFailure?: string
	/**
	 * Writes the company's history for real instead of swallowing it.
	 *
	 * Off by default, because most of these suites are about what reaches the
	 * mail server and the history would only be rows nobody reads. A suite that
	 * asserts on what a send leaves behind — the entries, their order, who they
	 * name — needs the real one, and had no way to ask for it before.
	 */
	readonly recordsHistory?: boolean
}

export const emailDependencies = (options?: HarnessOptions) =>
	Layer.mergeAll(
		Layer.succeed(CredentialCrypto, {
			encryptPassword: () => ({
				ciphertext: new Uint8Array([0]),
				nonce: new Uint8Array([0]),
				tag: new Uint8Array([0]),
			}),
			decryptPassword: () => 'stubbed-password',
		} as never),
		Layer.succeed(MailTransport, {
			probe: () => Effect.void,
			send: (_credentials: unknown, message: SentMessage) =>
				options?.sendFailure === undefined
					? Effect.sync(() => ({
							messageId:
								options?.onSend?.(message) ??
								`<harness-sent-${randomUUID()}@taller.test>`,
							raw: new Uint8Array([0]),
						}))
					: // The shape the transport actually fails with: the reason lives
						// in `detail` and the error carries no message of its own, so a
						// test built on a plain Error would pass on text production
						// never produces.
						Effect.fail(
							new GrantConnectFailed({
								inboxId: 'harness-inbox',
								detail: options.sendFailure,
								reason: 'unknown',
							}),
						),
			appendToSent: () => Effect.void,
		} as never),
		Layer.succeed(StorageProvider, { put: () => Effect.void } as never),
		Layer.succeed(EmailAttachmentStaging, {
			resolve: () => Effect.succeed(options?.stagedAttachments ?? []),
			markSentAndCleanup: () =>
				options?.purgeFailure === undefined
					? Effect.void
					: Effect.fail(new BadRequest({ message: options.purgeFailure })),
		} as never),
		options?.recordsHistory === true
			? TimelineActivityService.layer
			: Layer.succeed(TimelineActivityService, {
					record: () => Effect.void,
				} as never),
		Layer.succeed(EmailProvider, {} as never),
		Layer.succeed(CalendarService, {} as never),
		DraftStore.layer,
	)

/** The email service over those, still wanting a SqlClient from above. */
export const emailServiceLayer = (options?: HarnessOptions) =>
	EmailService.layer.pipe(Layer.provide(emailDependencies(options)))

/** Who the request is from, as the middleware would have established it. */
export const actingAs = (args: {
	readonly orgId: string
	readonly orgName: string
	readonly orgSlug: string
	readonly userId: string
}) =>
	Layer.mergeAll(
		Layer.succeed(CurrentOrg, {
			id: args.orgId,
			name: args.orgName,
			slug: args.orgSlug,
			role: 'owner',
		}),
		Layer.succeed(SessionContext, {
			userId: args.userId,
			email: `${args.userId}@test.local`,
			name: undefined,
			isAgent: false,
		}),
	)

export interface AsOrg extends HarnessOptions {
	readonly orgId: string
	readonly orgName: string
	readonly orgSlug: string
	readonly userId: string
}

/**
 * A suite's runtime: the database client, the email service over its stand-ins,
 * and the session, all built once and shared by every test in the file.
 *
 * Built once because building it opens a connection pool. Wrapping each call in
 * `Effect.provide` instead would stand a fresh pool up and tear it down per
 * assertion, which on a suite of fifty is fifty pools for one file's worth of
 * queries. Call `dispose()` in `afterAll`.
 */
export const makeOrgRuntime = (args: AsOrg) =>
	ManagedRuntime.make(
		Layer.mergeAll(actingAs(args), emailServiceLayer(args)).pipe(
			// provideMerge, not provide: PgLive both feeds the service layer and
			// stays visible to the caller, so the connection the org scope is
			// entered on is the one the service queries through. Two builds would
			// put the role and the organisation id on a connection nothing uses.
			Layer.provideMerge(PgLive),
		),
	)

export type OrgRuntime = ReturnType<typeof makeOrgRuntime>

/**
 * An effect wrapped the way a request wraps one: inside the organisation's own
 * database scope. Left as an effect so a caller can take the failure as an Exit.
 */
export const scopedAsOrg = <A, E>(
	args: AsOrg,
	effect: Effect.Effect<
		A,
		E,
		EmailService | SqlClient.SqlClient | CurrentOrg | SessionContext
	>,
) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		return yield* enterOrgScope(sql, {
			org: {
				id: args.orgId,
				name: args.orgName,
				slug: args.orgSlug,
			} as never,
			userId: args.userId,
			role: 'owner',
		})(effect)
	})

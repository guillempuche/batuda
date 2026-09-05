import { EventEmitter } from 'node:events'

import { Cause, Effect, Exit, Fiber } from 'effect'
import { TestClock } from 'effect/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { GrantAuthFailed, GrantConnectFailed } from '@batuda/controllers'

import type { DecryptedCreds } from './mail-transport'

// The two mail libraries stand in for real servers here, because the things
// worth testing are the ones a real server cannot be asked for on demand: a
// connection that never answers, a sign-in that is refused, a socket that
// fails long after anybody was waiting for it.

interface Behaviour {
	imapConnect: () => Promise<unknown>
	imapLogout: () => Promise<unknown>
	imapClose: () => void
	smtpVerify: () => Promise<unknown>
	smtpClose: () => void
}

interface Budget {
	readonly connectionTimeout: number
	readonly greetingTimeout: number
	readonly socketTimeout: number
}

let behaviour: Behaviour
let imapClients: Array<FakeImapFlow>
let smtpTransports: Array<FakeSmtpTransport>
let closed: Array<'imap' | 'smtp'>
// What each library was actually constructed with. Without this the timeouts
// are invisible to every test here, and dropping them would stay green.
let imapOptions: Array<Budget>
let smtpOptions: Array<Budget>

// A real EventEmitter, not a stand-in with a no-op `on`: the crash this
// guards against is Node throwing when 'error' is emitted and nothing is
// listening, so a fake that cannot throw would assert nothing.
class FakeImapFlow extends EventEmitter {
	readonly connect = vi.fn(() => behaviour.imapConnect())
	readonly logout = vi.fn(() => behaviour.imapLogout())
	readonly close = vi.fn(() => {
		closed.push('imap')
		behaviour.imapClose()
	})

	constructor(options: Budget) {
		super()
		imapOptions.push(options)
		imapClients.push(this)
	}
}

class FakeSmtpTransport {
	readonly verify = vi.fn(() => behaviour.smtpVerify())
	readonly sendMail = vi.fn(() =>
		Promise.resolve({
			message: Buffer.from('compiled message'),
			messageId: '<sent@test.local>',
		}),
	)
	readonly close = vi.fn(() => {
		closed.push('smtp')
		behaviour.smtpClose()
	})
}

vi.mock('imapflow', () => ({ ImapFlow: FakeImapFlow }))

vi.mock('nodemailer', () => ({
	default: {
		createTransport: (options: Budget & { streamTransport?: boolean }) => {
			// The compiler that turns a message into bytes opens no connection,
			// so it carries no budget and does not belong in this list.
			if (options.streamTransport !== true) smtpOptions.push(options)
			const transport = new FakeSmtpTransport()
			smtpTransports.push(transport)
			return transport
		},
	},
}))

const { MailTransport } = await import('./mail-transport')

const creds: DecryptedCreds = {
	inboxId: 'inbox-under-test',
	imapHost: 'imap.test.local',
	imapPort: 993,
	imapSecurity: 'tls',
	smtpHost: 'smtp.test.local',
	smtpPort: 465,
	smtpSecurity: 'tls',
	username: 'someone@test.local',
	password: 'app-pw',
}

const probe = () => Effect.runSync(MailTransport.make).probe(creds)

const send = () =>
	Effect.runSync(MailTransport.make).send(creds, {
		from: 'someone@test.local',
		to: ['somebody@example.test'],
		subject: 'a message',
		text: 'hello',
	})

const extractFailure = <E>(cause: Cause.Cause<E>): E | null => {
	for (const reason of cause.reasons) {
		if (Cause.isFailReason(reason)) return reason.error
	}
	return null
}

const failureOf = async (): Promise<GrantAuthFailed | GrantConnectFailed> => {
	const exit = await Effect.runPromise(Effect.exit(probe()))
	if (Exit.isSuccess(exit)) throw new Error('expected the probe to fail')
	const failure = extractFailure(exit.cause)
	if (failure === null) throw new Error('expected a typed failure')
	return failure
}

const rejectWith = (fields: Record<string, unknown>) => () =>
	Promise.reject(Object.assign(new Error('probe fixture'), fields))

beforeEach(() => {
	imapClients = []
	smtpTransports = []
	imapOptions = []
	smtpOptions = []
	closed = []
	behaviour = {
		imapConnect: () => Promise.resolve(),
		imapLogout: () => Promise.resolve(),
		imapClose: () => {},
		smtpVerify: () => Promise.resolve(),
		smtpClose: () => {},
	}
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('MailTransport.probe', () => {
	describe('when a caller is waiting on the answer', () => {
		it('should bound both legs without cutting a slow server short', async () => {
			// GIVEN a mailbox being probed, which somebody is waiting on
			// WHEN both legs are opened
			await Effect.runPromise(probe())

			// THEN no timer is left at the library's own generous default, or a
			// probe could outlast the person watching for it
			const budgets = [...imapOptions, ...smtpOptions]
			expect(budgets).toHaveLength(2)
			for (const budget of budgets) {
				expect(budget.connectionTimeout).toBeLessThanOrEqual(15_000)
				expect(budget.greetingTimeout).toBeLessThanOrEqual(16_000)
				expect(budget.socketTimeout).toBeLessThanOrEqual(15_000)

				// AND the timer that decides a server is dead rather than merely
				// busy is not cut below what the mail libraries chose for
				// themselves: an unreachable verdict refuses the mailbox every
				// send until a later check clears it
				expect(budget.greetingTimeout).toBeGreaterThanOrEqual(10_000)
			}
		})
	})

	describe('when a message goes out', () => {
		it('should not give the send the room an upload gets', async () => {
			// GIVEN a mailbox with a message to send
			// WHEN the message goes out
			await Effect.runPromise(send())

			// THEN the connection that carried it is held to the send's own
			// budget. A socket timer as loose as the one filing a sent copy
			// gets would let a server keep a message the client had given up
			// waiting for, and the retry above would send it a second time
			expect(smtpOptions).toHaveLength(1)
			expect(smtpOptions[0]?.socketTimeout).toBeLessThanOrEqual(15_000)
		})
	})

	describe('when both legs answer', () => {
		it('should succeed, and close what it opened', async () => {
			// GIVEN a mail server that accepts the credentials on both protocols
			// WHEN the mailbox is probed
			await Effect.runPromise(probe())

			// THEN the IMAP session is ended politely before the socket is
			// dropped, and neither connection is left open
			expect(imapClients[0]?.logout).toHaveBeenCalledTimes(1)
			expect(closed).toEqual(['imap', 'smtp'])
		})
	})

	describe('when IMAP refuses the credentials', () => {
		beforeEach(() => {
			behaviour.imapConnect = rejectWith({
				authenticationFailed: true,
				response: 'NO [AUTHENTICATIONFAILED] Invalid login or password',
			})
		})

		it('should fail as a credential problem', async () => {
			// GIVEN a mailbox whose password the server rejects
			// WHEN it is probed
			const failure = await failureOf()

			// THEN the failure says the credentials were wrong, not that the
			// server was unreachable
			expect(failure._tag).toBe('GrantAuthFailed')
			expect(failure.reason).toBe('invalid_credentials')
			expect(failure.detail).toContain('Invalid login or password')
		})

		it('should read the status word the server sent, not only the flag', async () => {
			// GIVEN a refusal carrying only the server's status word. imapflow
			// sets both this and the flag above, so a test that goes in through
			// the flag alone would pass with this branch deleted.
			behaviour.imapConnect = rejectWith({
				serverResponseCode: 'AUTHENTICATIONFAILED',
				response: 'NO [AUTHENTICATIONFAILED] Invalid login or password',
			})

			// WHEN the mailbox is probed
			const failure = await failureOf()

			// THEN it is still read as the credentials being wrong
			expect(failure._tag).toBe('GrantAuthFailed')
			expect(failure.reason).toBe('invalid_credentials')
		})

		it('should close the IMAP connection and never open an SMTP one', async () => {
			// GIVEN the same refusal
			// WHEN it is probed
			await failureOf()

			// THEN the refused connection is handed back, and the second leg is
			// never reached — so there is nothing there to close
			expect(closed).toEqual(['imap'])
			expect(smtpTransports).toHaveLength(0)
		})
	})

	describe('when IMAP accepts and SMTP refuses the credentials', () => {
		beforeEach(() => {
			behaviour.smtpVerify = rejectWith({ code: 'EAUTH' })
		})

		it('should fail as a credential problem and close both connections', async () => {
			// GIVEN a server that signs the mailbox in over IMAP but not SMTP
			// WHEN it is probed
			const failure = await failureOf()

			// THEN the credentials are blamed, and both connections are closed
			expect(failure._tag).toBe('GrantAuthFailed')
			expect(failure.reason).toBe('invalid_credentials')
			expect(closed).toEqual(['imap', 'smtp'])
		})
	})

	describe('when SMTP answers a bare 535 with no code', () => {
		it('should still read it as a credential problem', async () => {
			// GIVEN a server that reports a refused sign-in only by its number
			behaviour.smtpVerify = rejectWith({ responseCode: 535 })

			// WHEN the mailbox is probed
			const failure = await failureOf()

			// THEN it is read the same way as a named refusal
			expect(failure._tag).toBe('GrantAuthFailed')
			expect(failure.reason).toBe('invalid_credentials')
		})
	})

	describe('when the connection fails rather than the sign-in', () => {
		// One row per group the code actually tells apart. The other members of
		// each group take the same branch, so they would test nothing further.
		it.each([
			['ETIMEDOUT', 'timeout'],
			['ENOTFOUND', 'dns'],
			['ECONNREFUSED', 'unreachable'],
			['ESOCKET', 'tls'],
			['ERR_SSL_WRONG_VERSION_NUMBER', 'tls'],
			['DEPTH_ZERO_SELF_SIGNED_CERT', 'tls'],
			['SOMETHING_NEW', 'unknown'],
		])('should read %s as %s', async (code, reason) => {
			// GIVEN a connection that fails before any sign-in is attempted
			behaviour.imapConnect = rejectWith({ code })

			// WHEN the mailbox is probed
			const failure = await failureOf()

			// THEN the failure carries a reason that can be counted later,
			// rather than only the sentence the library happened to use
			expect(failure._tag).toBe('GrantConnectFailed')
			expect(failure.reason).toBe(reason)
		})

		it('should read an error with no code at all as unknown', async () => {
			// GIVEN a failure that says nothing about why
			behaviour.imapConnect = () => Promise.reject(new Error('no code here'))

			// WHEN the mailbox is probed
			const failure = await failureOf()

			// THEN it is recorded as unknown rather than guessed at
			expect(failure.reason).toBe('unknown')
		})
	})

	describe('when the server accepts the connection but never answers', () => {
		it('should give up at the deadline and hand the connection back', async () => {
			// GIVEN a server that holds the connection open and says nothing
			behaviour.imapConnect = () => new Promise<never>(() => {})

			// WHEN the mailbox is probed and the wait runs past the deadline
			const exit = await Effect.runPromise(
				Effect.gen(function* () {
					const fiber = yield* Effect.forkChild(Effect.exit(probe()))
					yield* TestClock.adjust('45 seconds')
					return yield* Fiber.join(fiber)
				}).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
			)

			// THEN the probe gives up rather than waiting on a silent server
			// forever
			expect(Exit.isFailure(exit)).toBe(true)
			const failure = Exit.isFailure(exit) ? extractFailure(exit.cause) : null
			expect(failure?._tag).toBe('GrantConnectFailed')
			expect(failure?.reason).toBe('timeout')

			// AND the connection it was waiting on is closed, not orphaned
			expect(closed).toEqual(['imap'])
		})
	})

	describe('when closing a connection fails', () => {
		it('should still report why the probe itself failed', async () => {
			// GIVEN a probe that cannot reach SMTP, and a close that throws
			behaviour.smtpVerify = rejectWith({ code: 'ECONNREFUSED' })
			behaviour.smtpClose = () => {
				throw new Error('close blew up')
			}

			// WHEN the mailbox is probed
			const failure = await failureOf()

			// THEN the reason the caller gets is the one that matters, not the
			// trouble met while tidying up after it
			expect(failure._tag).toBe('GrantConnectFailed')
			expect(failure.reason).toBe('unreachable')
		})

		it('should still succeed when the probe itself went through', async () => {
			// GIVEN a healthy mailbox whose IMAP connection throws on close
			behaviour.imapClose = () => {
				throw new Error('close blew up')
			}

			// WHEN it is probed
			// THEN the mailbox is reported as working
			await Effect.runPromise(probe())
		})
	})

	describe('when the library closes the connection before reporting why', () => {
		it('should blame what actually happened, not the closing', async () => {
			// GIVEN a socket that dies mid-connect. imapflow tears the connection
			// down first and rejects the call with its own "Unexpected close", so
			// the reason is only ever delivered to the error listener.
			behaviour.imapConnect = () =>
				new Promise((_resolve, reject) => {
					const client = imapClients[0]
					client?.emit(
						'error',
						Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }),
					)
					reject(
						Object.assign(new Error('Unexpected close'), {
							code: 'ClosedAfterConnectTLS',
						}),
					)
				})
			vi.spyOn(console, 'warn').mockImplementation(() => {})

			// WHEN the mailbox is probed
			const failure = await failureOf()

			// THEN the mailbox is reported as unreachable rather than as an
			// unexplained close, which is the difference between a reason
			// somebody can act on and one nobody can
			expect(failure._tag).toBe('GrantConnectFailed')
			expect(failure.reason).toBe('unreachable')
		})
	})

	describe('when a connection fails after the probe has walked away', () => {
		it('should not bring the process down', async () => {
			// GIVEN a mailbox that has already been probed
			const written = vi.spyOn(console, 'warn').mockImplementation(() => {})
			await Effect.runPromise(probe())
			const client = imapClients[0]

			// WHEN the socket dies later and the client reports it the only way
			// it can — by emitting 'error', which Node turns into a throw when
			// nothing is listening
			const emit = () =>
				client?.emit(
					'error',
					Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }),
				)

			// THEN nothing escapes, so the crash guard never sees it
			expect(emit).not.toThrow()

			// AND what gets written down is the sort of failure it was, not the
			// words the server used about somebody's account
			expect(written).toHaveBeenCalledTimes(1)
			const line = String(written.mock.calls[0]?.[0])
			const parsed = JSON.parse(line) as {
				level: string
				timestamp: string
				annotations: Record<string, unknown>
			}
			expect(parsed.level).toBe('WARN')
			expect(parsed.timestamp).toEqual(expect.any(String))
			// Under `annotations`, the way the process's own logger writes every
			// other event — loose at the top level it would be invisible to the
			// queries that find them.
			expect(parsed.annotations).toMatchObject({
				event: 'inbox.imap_client_error',
				inboxId: 'inbox-under-test',
				reason: 'unreachable',
			})
			expect(line).not.toContain('socket hang up')
		})
	})
})

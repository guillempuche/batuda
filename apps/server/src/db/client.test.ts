import { createServer } from 'node:net'

import { ConfigProvider, Effect, Exit, Layer } from 'effect'
import { describe, expect, it, onTestFinished } from 'vitest'

import { PgLive } from './client'

// A port on this machine that hangs up on every connection, held for the whole
// case so nothing else can take it in between.
const hangingUpPort = (): Promise<{ port: number; close: () => void }> =>
	new Promise((resolve, reject) => {
		const listener = createServer(socket => socket.destroy())
		listener.on('error', reject)
		listener.listen(0, '127.0.0.1', () => {
			const address = listener.address()
			if (address === null || typeof address === 'string') {
				listener.close()
				reject(new Error('the operating system named no port'))
				return
			}
			resolve({ port: address.port, close: () => listener.close() })
		})
	})

describe('PgLive', () => {
	describe('when the database cannot be reached', () => {
		it('should fail to start rather than start and fail every request', async () => {
			// GIVEN a database address that hangs up on every connection
			const { port, close } = await hangingUpPort()
			onTestFinished(close)
			const config = ConfigProvider.layer(
				ConfigProvider.fromUnknown({
					DATABASE_URL: `postgres://nobody:nothing@127.0.0.1:${port}/none`,
				}),
			)

			// WHEN the database layer is built, as it is when the server boots
			const exit = await Effect.runPromiseExit(
				Effect.scoped(Layer.build(PgLive.pipe(Layer.provide(config)))),
			)

			// THEN building it fails, so the process stops before it can answer a
			// health check and be put in place of a release that works
			expect(Exit.isFailure(exit)).toBe(true)
		}, 15_000)
	})
})

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { installCrashGuards } from './crash-guards'

type ProcessSignal = 'uncaughtException' | 'unhandledRejection'
type ProcessListener = (...args: ReadonlyArray<unknown>) => void

const GUARDED_SIGNALS: ReadonlyArray<ProcessSignal> = [
	'uncaughtException',
	'unhandledRejection',
]

// Use the general event-emitter type here: the stricter process-specific
// typings won't accept a value that could be either of our two events.
const emitter: NodeJS.EventEmitter = process

const listenersFor = (signal: ProcessSignal): ReadonlyArray<ProcessListener> =>
	emitter.listeners(signal) as unknown as ReadonlyArray<ProcessListener>

describe('installCrashGuards', () => {
	// The handlers attach to the global `process` and call process.exit when they
	// fire, so each test snapshots the listeners that already exist and removes
	// only the ones it adds — and never emits the events.
	const baseline = new Map<ProcessSignal, ReadonlyArray<ProcessListener>>()

	beforeEach(() => {
		for (const signal of GUARDED_SIGNALS)
			baseline.set(signal, listenersFor(signal))
	})

	afterEach(() => {
		for (const signal of GUARDED_SIGNALS) {
			const keep = new Set(baseline.get(signal))
			for (const listener of listenersFor(signal)) {
				if (!keep.has(listener)) emitter.removeListener(signal, listener)
			}
		}
	})

	describe('when installed', () => {
		it('should register one uncaughtException handler', () => {
			// GIVEN the uncaughtException listeners present before install
			// [crash-guards.ts — process.on('uncaughtException')]
			const before = process.listenerCount('uncaughtException')

			// WHEN the crash guards are installed
			installCrashGuards()

			// THEN exactly one handler has been added
			expect(process.listenerCount('uncaughtException')).toBe(before + 1)
		})

		it('should register one unhandledRejection handler', () => {
			// GIVEN the unhandledRejection listeners present before install
			// [crash-guards.ts — process.on('unhandledRejection')]
			const before = process.listenerCount('unhandledRejection')

			// WHEN the crash guards are installed
			installCrashGuards()

			// THEN exactly one handler has been added
			expect(process.listenerCount('unhandledRejection')).toBe(before + 1)
		})
	})
})

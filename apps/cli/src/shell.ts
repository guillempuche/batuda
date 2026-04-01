import { resolve } from 'node:path'

import { Effect, Stream } from 'effect'
import { ChildProcess } from 'effect/unstable/process'

export const ROOT = resolve(import.meta.dirname, '../../..')

/** Run a command with stdout/stderr inherited (visible in terminal). */
export const exec = (cmd: string, ...args: string[]) =>
	Effect.gen(function* () {
		const handle = yield* ChildProcess.make(cmd, args, {
			shell: true,
			stdout: 'inherit',
			stderr: 'inherit',
		})
		const code = yield* handle.exitCode
		if (code !== 0) {
			return yield* Effect.fail(
				new Error(`\`${cmd} ${args.join(' ')}\` exited with code ${code}`),
			)
		}
	}).pipe(Effect.scoped)

/** Like `exec`, but runs in a specific working directory. */
export const execIn = (cwd: string, cmd: string, ...args: string[]) =>
	Effect.gen(function* () {
		const handle = yield* ChildProcess.make(cmd, args, {
			cwd,
			shell: true,
			stdout: 'inherit',
			stderr: 'inherit',
		})
		const code = yield* handle.exitCode
		if (code !== 0) {
			return yield* Effect.fail(
				new Error(`\`${cmd} ${args.join(' ')}\` exited with code ${code}`),
			)
		}
	}).pipe(Effect.scoped)

/** Run a command silently and return its stdout as a trimmed string. */
export const execSilent = (cmd: string, ...args: string[]) =>
	Effect.gen(function* () {
		const handle = yield* ChildProcess.make(cmd, args, {
			shell: true,
		})
		const chunks = yield* Stream.runCollect(handle.stdout)
		const code = yield* handle.exitCode
		if (code !== 0) {
			return yield* Effect.fail(
				new Error(`\`${cmd} ${args.join(' ')}\` exited with code ${code}`),
			)
		}
		return Buffer.concat([...chunks])
			.toString()
			.trim()
	}).pipe(Effect.scoped)

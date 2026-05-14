import { fileURLToPath } from 'node:url'

import * as p from '@clack/prompts'
import { NodeRuntime, NodeServices } from '@effect/platform-node'
import { Cause, Effect } from 'effect'
import { Command } from 'effect/unstable/cli'
import pc from 'picocolors'

import { batuda } from './cli'
import { getTarget, loadEnv } from './lib/load-env'
import { recoveryHint } from './lib/recovery-hint'

// Populate process.env + resolve --env before any Effect Config reads.
loadEnv()

// `runWith` takes argv explicitly (vs. `run` which reads process.argv), so the
// menu can synthesise argv from a navigation path. Leaf `Flag.withFallbackPrompt`
// still drives prompts, so new flags in cli.ts show up here for free.
const runCommand = Command.runWith(batuda, { version: '0.0.1' })

// ── Tree introspection ─────────────────────────────────────

// `Command.withSubcommands` accepts `SubcommandGroup` entries so help output
// can label sections; for menu navigation we just want the flat children.
const childrenOf = (
	cmd: Command.Command.Any,
): ReadonlyArray<Command.Command.Any> =>
	cmd.subcommands.flatMap(group => [...group.commands])

const isLeaf = (cmd: Command.Command.Any): boolean =>
	childrenOf(cmd).length === 0

// `invite-admin` → `Invite admin`. A per-command label override would
// reintroduce the maintenance burden auto-discovery removes; the name is
// already the CLI's source of truth.
const humanize = (name: string): string => {
	const lowered = name.replaceAll('-', ' ')
	return lowered.charAt(0).toUpperCase() + lowered.slice(1)
}

const descriptionOf = (cmd: Command.Command.Any): string | undefined =>
	cmd.shortDescription ?? cmd.description ?? undefined

// Walk back to a command by name path. Used by "← Back" so we don't have to
// maintain a parent pointer alongside the navigation state. Returns the
// deepest valid ancestor if a segment is missing — defensive only; callers
// pass paths built from prior valid navigation.
const resolvePath = (
	root: Command.Command.Any,
	path: ReadonlyArray<string>,
): Command.Command.Any => {
	let cmd: Command.Command.Any = root
	for (const segment of path) {
		const next = childrenOf(cmd).find(c => c.name === segment)
		if (!next) return cmd
		cmd = next
	}
	return cmd
}

// ── Error recovery ─────────────────────────────────────────

const withRecovery = <A, E, R>(
	effect: Effect.Effect<A, E, R>,
): Effect.Effect<void, never, R> =>
	effect.pipe(
		Effect.catchCause((cause: Cause.Cause<E>) => {
			const error = Cause.squash(cause)
			const hint = recoveryHint(error)
			const message = error instanceof Error ? error.message : String(error)
			p.log.error(
				hint ? `${message}\n\n  ${pc.yellow('Hint:')} ${hint}` : message,
			)
			return Effect.void
		}),
		Effect.asVoid,
	)

// ── TUI ────────────────────────────────────────────────────

// Sentinel option values. Prefixed with `__` so they never collide with a
// real subcommand name.
const BACK = '__back'
const EXIT = '__exit'

type MenuOption = { value: string; label: string; hint?: string }

// Returns a mutable array because clack's `p.select` typing rejects readonly.
const buildMenuOptions = (
	children: ReadonlyArray<Command.Command.Any>,
	isTop: boolean,
): Array<MenuOption> => {
	const items: Array<MenuOption> = children.map(child => {
		const hint = descriptionOf(child)
		return hint
			? { value: child.name, label: humanize(child.name), hint }
			: { value: child.name, label: humanize(child.name) }
	})
	if (!isTop) {
		items.push({ value: BACK, label: '← Back', hint: 'Up one level' })
	}
	items.push({ value: EXIT, label: 'Exit', hint: 'Quit the CLI' })
	return items
}

const tui = Effect.gen(function* () {
	const target = getTarget()
	const targetBadge =
		target === 'cloud'
			? pc.bgRed(pc.white(' CLOUD '))
			: pc.bgGreen(pc.black(' LOCAL '))
	p.intro(`${pc.bgCyan(pc.black(' Batuda CLI '))} ${targetBadge}`)

	mainLoop: while (true) {
		let path: ReadonlyArray<string> = []
		let cmd: Command.Command.Any = batuda

		while (true) {
			if (isLeaf(cmd)) {
				yield* withRecovery(runCommand([...path]))
				p.log.message(pc.dim('───'))
				continue mainLoop
			}

			const children = childrenOf(cmd)
			const isTop = path.length === 0
			const options = buildMenuOptions(children, isTop)

			const selection = yield* Effect.promise(() =>
				p.select({
					message: isTop ? 'What do you want to do?' : `${path.join(' › ')} →`,
					options,
				}),
			)

			// Ctrl-C / Esc at top exits the TUI; deeper, it rewinds to the
			// top menu so the user can't get trapped in a sub-tree.
			if (p.isCancel(selection)) {
				if (isTop) {
					p.outro(pc.green('Bye!'))
					return
				}
				continue mainLoop
			}
			if (selection === EXIT) {
				p.outro(pc.green('Bye!'))
				return
			}
			if (selection === BACK) {
				path = path.slice(0, -1)
				cmd = resolvePath(batuda, path)
				continue
			}

			const next = children.find(c => c.name === selection)
			if (!next) continue
			path = [...path, selection]
			cmd = next
		}
	}
})

// ── Run ────────────────────────────────────────────────────

// `tui`'s error channel is `never` after `withRecovery` swallows leaf
// failures and `Effect.promise` (used for the menu prompt) declares no
// failure. No tapError needed — runtime defects still surface via
// `NodeRuntime.runMain`'s defect handler.
const program = tui.pipe(Effect.provide(NodeServices.layer))

// Match the cli.ts `isMain` guard so importing this module (unlikely but
// possible) doesn't auto-launch.
const isMain =
	typeof import.meta?.url === 'string' &&
	process.argv[1] === fileURLToPath(import.meta.url)

if (isMain) {
	NodeRuntime.runMain(
		program as unknown as Effect.Effect<void, unknown, never>,
		{ disableErrorReporting: true },
	)
}

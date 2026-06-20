export const BatudaGuards = async ({ client, $, directory }) => {
	return {
		'tool.execute.before': async (input, output) => {
			const tool = input.tool
			const args = output.args ?? {}

			// ── write/edit guards ────────────────────────────────────────
			if (tool === 'write' || tool === 'edit') {
				const filePath = args.filePath ?? ''

				// Block writes to migrations with invalid filename format.
				// Edits to existing migrations ask via the permission config.
				if (
					tool === 'write' &&
					filePath.includes('apps/server/src/db/migrations/')
				) {
					const filename = filePath.split('/').pop() ?? ''
					if (!/^\d{4}_[a-z_]+\.ts$/.test(filename)) {
						throw new Error(
							'Migration must match NNNN_description.ts (e.g. 0002_add_contacts.ts)',
						)
					}
				}

				if (filePath.includes('apps/server/src/db/migrations/')) {
					const ts = new Date().toISOString().replace('T', ' ').slice(0, 19)
					await $`printf '[%s] %s\n' ${ts} ${filePath} >> ${directory}/.opencode/migration-audit.log`.nothrow()
				}
			}

			// ── bash guards ──────────────────────────────────────────────
			if (tool === 'bash') {
				const cmd = args.command ?? ''
				// Block bare --force/-f pushes; allow --force-with-lease.
				if (
					/git push/.test(cmd) &&
					!/--force-with-lease/.test(cmd) &&
					/(\s--force(\s|$)|\s-f(\s|$))/.test(cmd)
				) {
					throw new Error(
						'Force push is destructive. Use --force-with-lease or ask the user first.',
					)
				}
			}
		},

		// Injects the current branch into the system prompt every turn so
		// the AI always knows which worktree / feature branch it is in.
		'experimental.chat.system.transform': async (input, output) => {
			const branch = await $`git -C ${directory} rev-parse --abbrev-ref HEAD`
				.text()
				.catch(() => null)
			if (branch) {
				output.system += `\n\n[Current git branch: ${branch.trim()}]`
			}
		},

		// Re-injects critical rules after context compaction so the AI does
		// not abandon planned workflows mid-session.
		'experimental.session.compacting': async (input, output) => {
			output.context.push(`## Critical rules (must be followed even after compaction)

- **Never read .env files.** Use Config.string() / Config.redacted() in Effect code.
- **Migration filenames:** apps/server/src/db/migrations/ files must match \`NNNN_description.ts\` (e.g. \`0003_add_contacts.ts\`). Never edit an existing migration; create a new one.
- **After editing packages/domain/src/schema/:** check whether a new Effect SQL migration is needed.
- **After editing apps/internal/src/ with Lingui macros** (<Trans>, useLingui, msg\`): run \`pnpm -F @batuda/internal i18n:extract\`, translate new msgids in non-en messages.po, then \`pnpm -F @batuda/internal i18n:check\` before ending the turn.
- **Never force-push.** Use \`git push --force-with-lease\` or ask first.
- **Dates:** prefer \`DateTime.nowUnsafe()\` + \`toDateUtc()\` / \`formatIso()\` and SQL \`now()\` over \`new Date()\`.
- **Filenames:** kebab-case for all files including React components.
- **Env vars:** name the capability, not the vendor (\`STORAGE_*\`, \`EMAIL_*\`, never \`R2_*\`, \`AGENTMAIL_*\`).`)
		},

		// Provision a linked worktree's database + bucket on session start.
		// The script exits 0 in non-worktree contexts and on all error paths.
		'session.created': async () => {
			await $`${directory}/.claude/hooks/worktree-up.sh`.quiet().nothrow()
		},
	}
}

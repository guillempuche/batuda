// The database the psql-seeded fixtures write to. playwright.config.ts loads the
// running checkout's own `.env` into the environment before the workers start,
// so this is that checkout's database — the very one its app reads, in the main
// repo and in a linked worktree alike. An explicit E2E_DATABASE_URL still wins
// (CI / staging).
//
// There is deliberately no literal fallback: a hardcoded default silently sent
// fixtures to the main checkout's database while the browser hit a worktree's
// app, so the two never shared data. A missing value now fails loudly instead.
const url = process.env['E2E_DATABASE_URL'] ?? process.env['DATABASE_URL']
if (!url) {
	throw new Error(
		'e2e: DATABASE_URL is not set. Run against a provisioned checkout (its .env supplies it) or export E2E_DATABASE_URL.',
	)
}

export const DATABASE_URL = url

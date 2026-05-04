/**
 * Maps known error patterns to actionable recovery hints.
 *
 * Used by both cli.ts and tui.ts so that failures always suggest
 * a next step for newcomers and AI agents.
 */

// ── Helpers ──────────────────────────────────────────────

const pgCode = (e: unknown): string | undefined => {
	const cause = (e as { cause?: { code?: string } })?.cause
	return cause?.code
}

const tag = (e: unknown): string | undefined =>
	e && typeof e === 'object' && '_tag' in e
		? String((e as { _tag: unknown })._tag)
		: undefined

const reasonTag = (e: unknown): string | undefined => {
	const reason = (e as { reason?: unknown })?.reason
	return tag(reason) ?? tag(e)
}

const msg = (e: unknown): string =>
	e instanceof Error ? e.message : String(e ?? '')

// ── Hint lookup ─────────────────────────────────────────

export const recoveryHint = (e: unknown): string | undefined => {
	const t = reasonTag(e)
	const code = pgCode(e) ?? pgCode((e as { reason?: unknown })?.reason)
	const message = msg(e)

	// Constraint violations (unique, not-null, check, FK)
	if (code === '23505') {
		return 'Unique constraint violated — duplicate data. Run: pnpm cli db reset && pnpm cli seed'
	}
	if (code === '23502') {
		return 'NOT NULL constraint violated — a required column received null'
	}
	if (t === 'ConstraintError') {
		return 'Constraint violated. Run: pnpm cli db reset && pnpm cli seed'
	}

	// Connection refused — DB not running
	if (
		t === 'ConnectionError' ||
		message.includes('ECONNREFUSED') ||
		message.includes('connection refused') ||
		message.includes('Connection terminated')
	) {
		return 'Cannot connect to database. Run: pnpm cli services up'
	}

	// Authentication — bad credentials
	if (t === 'AuthenticationError' && code?.startsWith('28')) {
		return 'Database authentication failed. Check DATABASE_URL in .env'
	}

	// Missing config / env vars
	if (t === 'ConfigError' || message.includes('DATABASE_URL is not set')) {
		return 'Missing environment variables. Run: pnpm cli setup'
	}

	// Docker not running
	if (
		message.includes('Docker command failed') ||
		message.includes('Cannot connect to the Docker daemon')
	) {
		return 'Docker is not running. Start Docker or OrbStack first'
	}

	// Migration needed (relation does not exist)
	if (
		code === '42P01' ||
		(message.includes('relation') && message.includes('does not exist'))
	) {
		return 'Tables missing. Run: pnpm cli db migrate'
	}

	return undefined
}

/**
 * Build metadata resolved once at startup.
 * Shared by the server health endpoint and OTLP resource attributes across
 * every process (server, mail-worker).
 *
 * Fallback chains:
 * - version: npm_package_version (pnpm dev) → SERVICE_VERSION (CI) → "unknown"
 * - commit:  GIT_SHA (CI) → "unknown"
 * - region:  REGION (Unikraft metro) → "local"
 */
export const buildMeta = {
	version:
		process.env['npm_package_version'] ??
		process.env['SERVICE_VERSION'] ??
		'unknown',
	commit: process.env['GIT_SHA'] ?? 'unknown',
	commitShort: (process.env['GIT_SHA'] ?? 'unknown').slice(0, 7),
	region: process.env['REGION'] ?? 'local',
} as const

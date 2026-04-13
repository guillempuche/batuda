import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

import { ProviderError, QuotaExhausted } from '../domain/errors'
import { ProviderQuota } from './ports'

// ── ProviderQuota Layer factory ──

export interface ProviderQuotaConfig {
	readonly userId: string
}

export const makeProviderQuotaLayer = (config: ProviderQuotaConfig) =>
	Layer.effect(
		ProviderQuota,
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient

			// Read the quota config for a provider. Returns null if no quota
			// is configured (quota check is skipped — budget is the only gate).
			const getQuotaConfig = (provider: string) =>
				Effect.gen(function* () {
					const rows = yield* sql`
						SELECT quota_total, quota_unit, period_months, period_anchor,
							   sync_mode, billing_model, cents_per_unit
						FROM provider_quotas
						WHERE user_id = ${config.userId} AND provider = ${provider}
						LIMIT 1
					`
					return rows[0] as
						| {
								quota_total: number
								quota_unit: string
								period_months: number
								period_anchor: string | null
								sync_mode: string
								billing_model: string
								cents_per_unit: number
						  }
						| undefined
				}).pipe(Effect.orDie)

			// Get current usage for a provider in the current period.
			const getCurrentUsage = (provider: string) =>
				Effect.gen(function* () {
					const [row] = yield* sql<{ units_consumed: number }>`
						SELECT COALESCE(units_consumed, 0)::int AS units_consumed
						FROM provider_usage
						WHERE user_id = ${config.userId}
						  AND provider = ${provider}
						  AND period_start = date_trunc('month', now())::date
					`
					return row?.units_consumed ?? 0
				}).pipe(Effect.orDie)

			return ProviderQuota.of({
				check: (provider: string, units: number) =>
					Effect.gen(function* () {
						const quota = yield* getQuotaConfig(provider)
						// No quota configured → skip check (budget is the only gate)
						if (!quota) return

						const used = yield* getCurrentUsage(provider)
						const remaining = quota.quota_total - used
						if (remaining < units) {
							return yield* new QuotaExhausted({
								provider,
								unit: quota.quota_unit,
								remaining: Math.max(0, remaining),
							})
						}
					}),

				consume: (provider: string, units: number) =>
					Effect.gen(function* () {
						const quota = yield* getQuotaConfig(provider)
						if (!quota) return

						const used = yield* getCurrentUsage(provider)
						const remaining = quota.quota_total - used
						if (remaining < units) {
							return yield* new QuotaExhausted({
								provider,
								unit: quota.quota_unit,
								remaining: Math.max(0, remaining),
							})
						}

						// Upsert the usage counter. Period resets are implicit:
						// if no row exists for current month, INSERT starts at 0.
						yield* sql`
							INSERT INTO provider_usage (user_id, provider, period_start, units_consumed)
							VALUES (${config.userId}, ${provider}, date_trunc('month', now())::date, ${units})
							ON CONFLICT (user_id, provider, period_start)
							DO UPDATE SET units_consumed = provider_usage.units_consumed + ${units}
						`.pipe(Effect.orDie)
					}),

				remaining: (provider: string) =>
					Effect.gen(function* () {
						const quota = yield* getQuotaConfig(provider)
						if (!quota) return { total: 0, used: 0, unit: 'unknown' }

						const used = yield* getCurrentUsage(provider)
						return {
							total: quota.quota_total,
							used,
							unit: quota.quota_unit,
						}
					}),

				sync: (provider: string) =>
					Effect.gen(function* () {
						const quota = yield* getQuotaConfig(provider)
						if (!quota || quota.sync_mode !== 'api') {
							return yield* new ProviderError({
								provider,
								message: `sync not supported for ${provider} (sync_mode=${quota?.sync_mode ?? 'none'})`,
								recoverable: false,
							})
						}

						// Provider-specific sync logic is implemented in infrastructure
						// adapters. This placeholder logs and returns — the actual sync
						// (e.g. Firecrawl GET /v2/team/credit-usage) lives in the
						// infrastructure layer and calls this service's consume/check.
						yield* Effect.logInfo(
							`provider quota sync requested for ${provider}`,
						)
					}),
			})
		}),
	)

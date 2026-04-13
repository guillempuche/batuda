import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient

	// ── Subject row additions ──
	yield* Effect.all([
		sql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS version int NOT NULL DEFAULT 0`,
		sql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS deleted_at timestamptz`,
		sql`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS version int NOT NULL DEFAULT 0`,
		sql`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS deleted_at timestamptz`,
	])

	// ── Core: research_runs ──
	yield* sql`
		CREATE TABLE IF NOT EXISTS research_runs (
			id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
			parent_id               uuid REFERENCES research_runs(id) ON DELETE CASCADE,
			kind                    text NOT NULL CHECK (kind IN ('leaf','group','followup')) DEFAULT 'leaf',

			query                   text NOT NULL,
			mode                    text NOT NULL DEFAULT 'deep',
			schema_name             text,

			status                  text NOT NULL CHECK (status IN ('queued','running','succeeded','failed','cancelled','deleted')),
			context                 jsonb NOT NULL DEFAULT '{}'::jsonb,

			findings                jsonb NOT NULL DEFAULT '{}'::jsonb,
			brief_md                text,

			budget_cents            int NOT NULL DEFAULT 0,
			paid_budget_cents       int NOT NULL DEFAULT 0,
			cost_cents              int NOT NULL DEFAULT 0,
			paid_cost_cents         int NOT NULL DEFAULT 0,
			cost_breakdown          jsonb NOT NULL DEFAULT '{}'::jsonb,
			quota_breakdown         jsonb NOT NULL DEFAULT '{}'::jsonb,
			tokens_in               int NOT NULL DEFAULT 0,
			tokens_out              int NOT NULL DEFAULT 0,
			paid_policy             jsonb NOT NULL DEFAULT '{}'::jsonb,

			idempotency_key         text UNIQUE,
			created_by              text NOT NULL,
			created_at              timestamptz NOT NULL DEFAULT now(),
			started_at              timestamptz,
			completed_at            timestamptz,
			updated_at              timestamptz NOT NULL DEFAULT now(),

			tool_log                jsonb NOT NULL DEFAULT '[]'::jsonb
		)
	`

	yield* Effect.all([
		sql`CREATE INDEX IF NOT EXISTS research_runs_status_idx ON research_runs(status) WHERE status IN ('queued','running')`,
		sql`CREATE INDEX IF NOT EXISTS research_runs_parent_idx ON research_runs(parent_id)`,
		sql`CREATE INDEX IF NOT EXISTS research_runs_created_by_idx ON research_runs(created_by)`,
	])

	// ── Sources (globally deduped by url_hash) ──
	yield* sql`
		CREATE TABLE IF NOT EXISTS sources (
			id                text PRIMARY KEY,
			kind              text NOT NULL CHECK (kind IN ('web','registry','archive','report')),
			provider          text NOT NULL,
			url               text NOT NULL,
			url_hash          text NOT NULL UNIQUE,
			domain            text NOT NULL,
			title             text,
			author            text,
			published_at      timestamptz,
			language          text,
			first_fetched_at  timestamptz NOT NULL DEFAULT now(),
			last_fetched_at   timestamptz NOT NULL DEFAULT now(),
			content_hash      text NOT NULL,
			content_ref       text
		)
	`

	yield* sql`CREATE INDEX IF NOT EXISTS sources_domain_idx ON sources(domain)`

	// ── Many-to-many: research_runs <-> sources ──
	yield* sql`
		CREATE TABLE IF NOT EXISTS research_run_sources (
			research_id  uuid NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
			source_id    text NOT NULL REFERENCES sources(id),
			local_ref    text NOT NULL,
			fetched_at   timestamptz NOT NULL DEFAULT now(),
			cost_cents   int NOT NULL DEFAULT 0,
			PRIMARY KEY (research_id, source_id)
		)
	`

	// ── Polymorphic link: run <-> subject row ──
	yield* sql`
		CREATE TABLE IF NOT EXISTS research_links (
			research_id    uuid NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
			subject_table  text NOT NULL CHECK (subject_table IN ('companies','contacts')),
			subject_id     uuid NOT NULL,
			link_kind      text NOT NULL CHECK (link_kind IN ('input','finding')),
			created_at     timestamptz NOT NULL DEFAULT now(),
			PRIMARY KEY (research_id, subject_table, subject_id)
		)
	`

	yield* sql`CREATE INDEX IF NOT EXISTS research_links_subject_idx ON research_links(subject_table, subject_id)`

	// ── Paid-spend audit log ──
	yield* sql`
		CREATE TABLE IF NOT EXISTS research_paid_spend (
			id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
			research_id      uuid NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
			user_id          text NOT NULL,
			provider         text NOT NULL,
			tool             text NOT NULL,
			idempotency_key  text NOT NULL UNIQUE,
			amount_cents     int NOT NULL,
			quota_units      int,
			quota_unit       text,
			args             jsonb NOT NULL,
			result_hash      text,
			result_data      jsonb,
			source_id        text REFERENCES sources(id),
			auto_approved    boolean NOT NULL,
			approved_by      text,
			at               timestamptz NOT NULL DEFAULT now()
		)
	`

	yield* sql`CREATE INDEX IF NOT EXISTS research_paid_spend_user_at_idx ON research_paid_spend(user_id, at DESC)`

	// ── User-level spending policy ──
	yield* sql`
		CREATE TABLE IF NOT EXISTS user_research_policy (
			user_id                    text PRIMARY KEY,
			budget_cents               int NOT NULL DEFAULT 100,
			paid_budget_cents          int NOT NULL DEFAULT 500,
			auto_approve_paid_cents    int NOT NULL DEFAULT 200,
			paid_monthly_cap_cents     int NOT NULL DEFAULT 2000,
			updated_at                 timestamptz NOT NULL DEFAULT now()
		)
	`

	// ── Provider quota config ──
	yield* sql`
		CREATE TABLE IF NOT EXISTS provider_quotas (
			user_id          text NOT NULL,
			provider         text NOT NULL,
			billing_model    text NOT NULL CHECK (billing_model IN ('monthly_plan', 'pay_per_call')),
			sync_mode        text NOT NULL CHECK (sync_mode IN ('api', 'manual')) DEFAULT 'manual',
			quota_total      int NOT NULL,
			quota_unit       text NOT NULL,
			period_months    int NOT NULL DEFAULT 1,
			period_anchor    date,
			cents_per_unit   int NOT NULL DEFAULT 0,
			warn_at_pct      int NOT NULL DEFAULT 80,
			last_synced_at   timestamptz,
			updated_at       timestamptz NOT NULL DEFAULT now(),
			PRIMARY KEY (user_id, provider)
		)
	`

	// ── Provider usage counter ──
	yield* sql`
		CREATE TABLE IF NOT EXISTS provider_usage (
			user_id          text NOT NULL,
			provider         text NOT NULL,
			period_start     date NOT NULL,
			units_consumed   int NOT NULL DEFAULT 0,
			PRIMARY KEY (user_id, provider, period_start)
		)
	`
})

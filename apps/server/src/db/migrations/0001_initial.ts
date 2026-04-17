import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient

	// ── CRM core ─────────────────────────────────────────────────────
	yield* sql`
		CREATE TABLE IF NOT EXISTS companies (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			slug TEXT NOT NULL UNIQUE,
			name TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'prospect',
			industry TEXT,
			size_range TEXT,
			region TEXT,
			location TEXT,
			source TEXT,
			priority INTEGER DEFAULT 2,
			website TEXT,
			email TEXT,
			phone TEXT,
			instagram TEXT,
			linkedin TEXT,
			google_maps_url TEXT,
			products_fit TEXT[],
			tags TEXT[],
			pain_points TEXT,
			current_tools TEXT,
			next_action TEXT,
			next_action_at TIMESTAMPTZ,
			last_contacted_at TIMESTAMPTZ,
			latitude NUMERIC(9,6),
			longitude NUMERIC(9,6),
			geocoded_at TIMESTAMPTZ,
			geocode_source TEXT,
			metadata JSONB,
			version INT NOT NULL DEFAULT 0,
			deleted_at TIMESTAMPTZ,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			CONSTRAINT companies_latlng_chk CHECK (
				(latitude IS NULL AND longitude IS NULL)
				OR (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)
			)
		)
	`
	yield* sql`
		CREATE TABLE IF NOT EXISTS contacts (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
			name TEXT NOT NULL,
			role TEXT,
			is_decision_maker BOOLEAN DEFAULT false,
			email TEXT,
			phone TEXT,
			whatsapp TEXT,
			linkedin TEXT,
			instagram TEXT,
			email_status TEXT NOT NULL DEFAULT 'unknown',
			email_status_reason TEXT,
			email_status_updated_at TIMESTAMPTZ,
			email_soft_bounce_count INTEGER NOT NULL DEFAULT 0,
			notes TEXT,
			metadata JSONB,
			version INT NOT NULL DEFAULT 0,
			deleted_at TIMESTAMPTZ,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)
	`
	yield* sql`
		CREATE TABLE IF NOT EXISTS interactions (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
			contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
			date TIMESTAMPTZ NOT NULL,
			duration_min INTEGER,
			channel TEXT NOT NULL,
			direction TEXT NOT NULL,
			type TEXT NOT NULL,
			subject TEXT,
			summary TEXT,
			outcome TEXT,
			next_action TEXT,
			next_action_at DATE,
			metadata JSONB,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)
	`
	yield* sql`
		CREATE TABLE IF NOT EXISTS tasks (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
			contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
			type TEXT NOT NULL,
			title TEXT NOT NULL,
			notes TEXT,
			due_at TIMESTAMPTZ,
			completed_at TIMESTAMPTZ,
			metadata JSONB,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)
	`
	yield* sql`
		CREATE TABLE IF NOT EXISTS products (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			slug TEXT NOT NULL UNIQUE,
			name TEXT NOT NULL,
			type TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'active',
			description TEXT,
			default_price NUMERIC(10, 2),
			price_type TEXT DEFAULT 'fixed',
			target_industries TEXT[],
			metadata JSONB,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)
	`
	yield* sql`
		CREATE TABLE IF NOT EXISTS proposals (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
			contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
			status TEXT NOT NULL DEFAULT 'draft',
			title TEXT NOT NULL,
			line_items JSONB NOT NULL,
			total_value NUMERIC(10, 2),
			currency TEXT DEFAULT 'EUR',
			sent_at TIMESTAMPTZ,
			expires_at TIMESTAMPTZ,
			responded_at TIMESTAMPTZ,
			notes TEXT,
			metadata JSONB,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)
	`
	yield* sql`
		CREATE TABLE IF NOT EXISTS documents (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
			interaction_id UUID REFERENCES interactions(id) ON DELETE SET NULL,
			type TEXT NOT NULL,
			title TEXT,
			content TEXT NOT NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)
	`
	yield* sql`
		CREATE TABLE IF NOT EXISTS pages (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
			slug TEXT NOT NULL,
			lang TEXT NOT NULL,
			title TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'draft',
			template TEXT,
			content JSONB NOT NULL,
			meta JSONB,
			published_at TIMESTAMPTZ,
			expires_at TIMESTAMPTZ,
			view_count INTEGER NOT NULL DEFAULT 0,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			UNIQUE (slug, lang)
		)
	`
	yield* sql`
		CREATE TABLE IF NOT EXISTS webhook_endpoints (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			name TEXT NOT NULL,
			url TEXT NOT NULL,
			events TEXT[] NOT NULL,
			secret TEXT,
			is_active BOOLEAN NOT NULL DEFAULT true,
			last_triggered_at TIMESTAMPTZ,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)
	`

	// ── Email stack ──────────────────────────────────────────────────
	// inboxes must be created before email_thread_links (FK dependency).
	yield* sql`
		CREATE TABLE IF NOT EXISTS inboxes (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			provider TEXT NOT NULL,
			provider_inbox_id TEXT NOT NULL,
			email TEXT NOT NULL,
			display_name TEXT,
			purpose TEXT NOT NULL CHECK (purpose IN ('human','agent','shared')),
			owner_user_id TEXT,
			is_default BOOLEAN NOT NULL DEFAULT false,
			active BOOLEAN NOT NULL DEFAULT true,
			client_id TEXT,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			UNIQUE (provider, provider_inbox_id)
		)
	`
	yield* sql`
		CREATE TABLE IF NOT EXISTS email_thread_links (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			provider TEXT NOT NULL,
			provider_thread_id TEXT NOT NULL UNIQUE,
			provider_inbox_id TEXT NOT NULL,
			inbox_id UUID REFERENCES inboxes(id) ON DELETE SET NULL,
			company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
			contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
			subject TEXT,
			status TEXT NOT NULL DEFAULT 'open',
			last_read_at TIMESTAMPTZ,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)
	`
	// Default shape for recipients reflects the { to, cc, bcc } schema.
	yield* sql`
		CREATE TABLE IF NOT EXISTS email_messages (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			provider TEXT NOT NULL,
			provider_message_id TEXT NOT NULL UNIQUE,
			provider_thread_id TEXT NOT NULL,
			provider_inbox_id TEXT NOT NULL,
			direction TEXT NOT NULL,
			company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
			contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
			recipients JSONB NOT NULL DEFAULT '{"to":[],"cc":[],"bcc":[]}'::jsonb,
			status TEXT NOT NULL,
			status_reason TEXT,
			bounce_type TEXT,
			bounce_sub_type TEXT,
			inbound_classification TEXT CHECK (inbound_classification IN ('normal','spam','blocked')),
			status_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)
	`

	yield* sql`
		CREATE TABLE IF NOT EXISTS inbox_footers (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			inbox_id UUID NOT NULL REFERENCES inboxes(id) ON DELETE CASCADE,
			name TEXT NOT NULL,
			html TEXT NOT NULL,
			text_fallback TEXT NOT NULL DEFAULT '',
			is_default BOOLEAN NOT NULL DEFAULT false,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)
	`

	// ── Call recordings ──────────────────────────────────────────────
	yield* sql`
		CREATE TABLE IF NOT EXISTS call_recordings (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			interaction_id UUID NOT NULL UNIQUE REFERENCES interactions(id) ON DELETE CASCADE,
			storage_key TEXT NOT NULL,
			mime_type TEXT NOT NULL,
			byte_size BIGINT NOT NULL,
			duration_sec INTEGER,

			transcript_status TEXT,
			transcript_text TEXT,
			transcript_segments JSONB,
			detected_languages JSONB,
			transcribed_at TIMESTAMPTZ,
			transcript_error TEXT,
			provider TEXT,
			provider_request_id TEXT,
			caller_speaker_id TEXT,

			deleted_at TIMESTAMPTZ,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)
	`

	// ── Research: runs, sources, m2m, links, paid spend, policy, quotas ──
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
	yield* sql`
		CREATE TABLE IF NOT EXISTS provider_usage (
			user_id          text NOT NULL,
			provider         text NOT NULL,
			period_start     date NOT NULL,
			units_consumed   int NOT NULL DEFAULT 0,
			PRIMARY KEY (user_id, provider, period_start)
		)
	`

	// ── Indexes ──────────────────────────────────────────────────────
	yield* Effect.all([
		// email_thread_links
		sql`CREATE INDEX IF NOT EXISTS idx_email_thread_links_company_id ON email_thread_links(company_id)`,
		sql`CREATE INDEX IF NOT EXISTS idx_email_thread_links_provider_inbox_id ON email_thread_links(provider_inbox_id)`,
		sql`CREATE INDEX IF NOT EXISTS idx_email_thread_links_inbox_id ON email_thread_links(inbox_id)`,
		sql`CREATE INDEX IF NOT EXISTS idx_email_thread_links_subject_lower ON email_thread_links(lower(subject))`,
		sql`CREATE INDEX IF NOT EXISTS idx_email_thread_links_status_updated ON email_thread_links(provider_inbox_id, status, updated_at DESC)`,

		// email_messages
		sql`CREATE INDEX IF NOT EXISTS idx_email_messages_provider_thread_id ON email_messages(provider_thread_id)`,
		sql`CREATE INDEX IF NOT EXISTS idx_email_messages_contact_id ON email_messages(contact_id) WHERE contact_id IS NOT NULL`,
		sql`CREATE INDEX IF NOT EXISTS idx_email_messages_status ON email_messages(status)`,
		sql`
			CREATE INDEX IF NOT EXISTS idx_email_messages_inbound_active
			ON email_messages(created_at DESC)
			WHERE direction = 'inbound' AND (inbound_classification IS NULL OR inbound_classification = 'normal')
		`,

		// inboxes
		sql`CREATE INDEX IF NOT EXISTS idx_inboxes_purpose ON inboxes(purpose) WHERE active = true`,
		sql`CREATE INDEX IF NOT EXISTS idx_inboxes_owner_user_id ON inboxes(owner_user_id) WHERE owner_user_id IS NOT NULL`,
		sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_inboxes_single_default ON inboxes((1)) WHERE is_default = true`,

		// inbox_footers
		sql`CREATE INDEX IF NOT EXISTS idx_inbox_footers_inbox_id ON inbox_footers(inbox_id)`,
		sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_inbox_footers_single_default ON inbox_footers(inbox_id) WHERE is_default = true`,

		// call_recordings — partial index on the common "active" path.
		sql`CREATE INDEX IF NOT EXISTS idx_call_recordings_active ON call_recordings(deleted_at) WHERE deleted_at IS NULL`,

		// research_runs
		sql`CREATE INDEX IF NOT EXISTS research_runs_status_idx ON research_runs(status) WHERE status IN ('queued','running')`,
		sql`CREATE INDEX IF NOT EXISTS research_runs_parent_idx ON research_runs(parent_id)`,
		sql`CREATE INDEX IF NOT EXISTS research_runs_created_by_idx ON research_runs(created_by)`,

		// sources / research_links / research_paid_spend
		sql`CREATE INDEX IF NOT EXISTS sources_domain_idx ON sources(domain)`,
		sql`CREATE INDEX IF NOT EXISTS research_links_subject_idx ON research_links(subject_table, subject_id)`,
		sql`CREATE INDEX IF NOT EXISTS research_paid_spend_user_at_idx ON research_paid_spend(user_id, at DESC)`,
	])
})

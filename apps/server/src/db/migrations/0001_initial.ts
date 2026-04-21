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

	// ── Calendar ─────────────────────────────────────────────────────
	// Event types are vendor-neutral: `provider` names the backend, and
	// `provider_event_type_id` is always TEXT (cal.com yields numeric ids,
	// Google/Microsoft yield strings — storing both as TEXT keeps the
	// column shape stable across provider swaps).
	yield* sql`
		CREATE TABLE IF NOT EXISTS calendar_event_types (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			slug TEXT NOT NULL UNIQUE,
			provider TEXT NOT NULL CHECK (provider IN ('calcom','google','microsoft','internal')),
			provider_event_type_id TEXT,
			title TEXT NOT NULL,
			duration_minutes INTEGER NOT NULL,
			location_kind TEXT NOT NULL CHECK (location_kind IN ('video','phone','address','link','none')),
			default_location_value TEXT,
			active BOOLEAN NOT NULL DEFAULT true,
			synced_at TIMESTAMPTZ,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			UNIQUE (provider, provider_event_type_id)
		)
	`
	// `source` = why it's in our DB; `provider` = which backend owns
	// the upstream row. Splitting them lets the booking backend swap
	// without rewriting `source='booking'` rows. `ical_uid` is always
	// present (generated locally for source='internal') so future
	// CalDAV export stays a no-op.
	yield* sql`
		CREATE TABLE IF NOT EXISTS calendar_events (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			source TEXT NOT NULL CHECK (source IN ('booking','email','internal')),
			provider TEXT NOT NULL CHECK (provider IN ('calcom','google','microsoft','email','internal')),
			provider_booking_id TEXT,
			ical_uid TEXT NOT NULL UNIQUE,
			ical_sequence INTEGER NOT NULL DEFAULT 0,
			event_type_id UUID REFERENCES calendar_event_types(id) ON DELETE SET NULL,
			start_at TIMESTAMPTZ NOT NULL,
			end_at TIMESTAMPTZ NOT NULL,
			status TEXT NOT NULL CHECK (status IN ('confirmed','tentative','cancelled')),
			title TEXT NOT NULL,
			location_type TEXT NOT NULL CHECK (location_type IN ('video','phone','address','link','none')),
			location_value TEXT,
			video_call_url TEXT,
			organizer_email TEXT NOT NULL,
			company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
			contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
			interaction_id UUID REFERENCES interactions(id) ON DELETE SET NULL,
			metadata JSONB,
			raw_ics BYTEA,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			CONSTRAINT calendar_events_provider_booking_consistent CHECK (
				(source = 'booking' AND provider_booking_id IS NOT NULL)
				OR (source IN ('email','internal') AND provider_booking_id IS NULL)
			)
		)
	`
	// `contact_id` mirrors email→contact resolution; `company_id`
	// mirrors contact_id's company for fast joins.
	yield* sql`
		CREATE TABLE IF NOT EXISTS calendar_event_attendees (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			event_id UUID NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
			email TEXT NOT NULL,
			name TEXT,
			contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
			company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
			rsvp TEXT NOT NULL DEFAULT 'needs-action' CHECK (rsvp IN ('needs-action','accepted','declined','tentative')),
			is_organizer BOOLEAN NOT NULL DEFAULT false,
			updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			UNIQUE (event_id, email)
		)
	`

	// ── Tasks ────────────────────────────────────────────────────────
	// `company_id` is nullable: internal work (e.g., "prep onsite day")
	// has no company. `assignee_id` and `actor_id` are Better-Auth user
	// ids (TEXT cuid2); no FK to `user` because the auth stack runs its
	// own migrations. `completed_at` must co-exist with status='done'.
	yield* sql`
		CREATE TABLE IF NOT EXISTS tasks (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
			contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
			type TEXT NOT NULL,
			title TEXT NOT NULL,
			notes TEXT,
			status TEXT NOT NULL DEFAULT 'open'
				CHECK (status IN ('open','in_progress','blocked','in_review','done','cancelled')),
			source TEXT NOT NULL DEFAULT 'user'
				CHECK (source IN ('user','agent','webhook','email','booking')),
			priority TEXT NOT NULL DEFAULT 'normal'
				CHECK (priority IN ('low','normal','high')),
			assignee_id TEXT,
			actor_id TEXT,
			due_at TIMESTAMPTZ,
			snoozed_until TIMESTAMPTZ,
			completed_at TIMESTAMPTZ,
			linked_interaction_id UUID REFERENCES interactions(id) ON DELETE SET NULL,
			linked_calendar_event_id UUID REFERENCES calendar_events(id) ON DELETE SET NULL,
			linked_thread_link_id UUID REFERENCES email_thread_links(id) ON DELETE SET NULL,
			linked_proposal_id UUID REFERENCES proposals(id) ON DELETE SET NULL,
			metadata JSONB,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			CONSTRAINT tasks_completed_at_matches_status CHECK (
				(status = 'done' AND completed_at IS NOT NULL)
				OR (status <> 'done' AND completed_at IS NULL)
			)
		)
	`
	// Append-only audit trail. `change` holds a field-level diff as
	// { field: [oldValue, newValue] }. Cascading delete mirrors tasks.
	yield* sql`
		CREATE TABLE IF NOT EXISTS task_events (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
			at TIMESTAMPTZ NOT NULL DEFAULT now(),
			actor_id TEXT,
			actor_kind TEXT NOT NULL CHECK (actor_kind IN ('user','agent')),
			change JSONB NOT NULL
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

	// Footer bodies are typed block trees; html/text are derived on send.
	yield* sql`
		CREATE TABLE IF NOT EXISTS inbox_footers (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			inbox_id UUID NOT NULL REFERENCES inboxes(id) ON DELETE CASCADE,
			name TEXT NOT NULL,
			body_json JSONB NOT NULL,
			is_default BOOLEAN NOT NULL DEFAULT false,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)
	`

	// Draft body shadow — AgentMail's draft API exposes html/text only, so
	// the editor-authored block tree lives here keyed by the provider's
	// draft_id. Local provider doesn't need this (stores bodyJson inline
	// in its on-disk JSON); the row is AgentMail-only in practice but the
	// table is provider-agnostic.
	yield* sql`
		CREATE TABLE IF NOT EXISTS email_draft_bodies (
			draft_id TEXT PRIMARY KEY,
			inbox_id UUID NOT NULL REFERENCES inboxes(id) ON DELETE CASCADE,
			body_json JSONB NOT NULL,
			updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)
	`

	// Staged attachments — tracks each upload so we can sweep on draft
	// delete / send / TTL. Durable storage key lives in storage_key; the
	// bytes themselves are in StorageProvider under that key. cid is
	// populated at send time so reply-open can re-link inline images.
	yield* sql`
		CREATE TABLE IF NOT EXISTS email_attachment_staging (
			staging_id TEXT PRIMARY KEY,
			inbox_id UUID NOT NULL REFERENCES inboxes(id) ON DELETE CASCADE,
			draft_id TEXT,
			storage_key TEXT NOT NULL,
			filename TEXT NOT NULL,
			content_type TEXT NOT NULL,
			size_bytes BIGINT NOT NULL,
			is_inline BOOLEAN NOT NULL DEFAULT false,
			cid TEXT,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			expires_at TIMESTAMPTZ NOT NULL,
			sent_at TIMESTAMPTZ
		)
	`

	// ── Activity event log ───────────────────────────────────────────
	// Polymorphic timeline of every notable event (emails, calls, documents,
	// proposals, research runs, system events).
	yield* sql`
		CREATE TABLE IF NOT EXISTS timeline_activity (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			kind TEXT NOT NULL,
			entity_type TEXT NOT NULL,
			entity_id UUID NOT NULL,
			company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
			contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
			channel TEXT,
			direction TEXT,
			actor_user_id UUID,
			occurred_at TIMESTAMPTZ NOT NULL,
			summary TEXT,
			payload JSONB NOT NULL DEFAULT '{}'::jsonb,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)
	`

	// One row per (email_message × email_address × role) so every CC'd
	// participant is addressable, even when no contact exists yet.
	yield* sql`
		CREATE TABLE IF NOT EXISTS message_participants (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			email_message_id UUID NOT NULL REFERENCES email_messages(id) ON DELETE CASCADE,
			email_address TEXT NOT NULL,
			display_name TEXT,
			role TEXT NOT NULL,
			contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)
	`

	// Denormalised cadence columns so "who haven't I emailed in 30 days?"
	// is a single-table scan.
	yield* sql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS last_email_at TIMESTAMPTZ`
	yield* sql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS last_call_at TIMESTAMPTZ`
	yield* sql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS last_meeting_at TIMESTAMPTZ`
	yield* sql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS next_calendar_event_at TIMESTAMPTZ`
	yield* sql`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS last_email_at TIMESTAMPTZ`
	yield* sql`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS last_call_at TIMESTAMPTZ`
	yield* sql`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS last_meeting_at TIMESTAMPTZ`
	yield* sql`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS next_calendar_event_at TIMESTAMPTZ`

	// Backfill cadence columns from existing interactions (pre-prod, safe).
	// recordings.ts writes channel='call' while the docs say 'phone' — include both.
	yield* sql`
		UPDATE companies c SET
			last_email_at   = (SELECT MAX(date) FROM interactions WHERE company_id = c.id AND channel = 'email'),
			last_call_at    = (SELECT MAX(date) FROM interactions WHERE company_id = c.id AND channel IN ('phone', 'call')),
			last_meeting_at = (SELECT MAX(date) FROM interactions WHERE company_id = c.id AND channel IN ('visit', 'event'))
	`
	yield* sql`
		UPDATE contacts co SET
			last_email_at   = (SELECT MAX(date) FROM interactions WHERE contact_id = co.id AND channel = 'email'),
			last_call_at    = (SELECT MAX(date) FROM interactions WHERE contact_id = co.id AND channel IN ('phone', 'call')),
			last_meeting_at = (SELECT MAX(date) FROM interactions WHERE contact_id = co.id AND channel IN ('visit', 'event'))
	`

	// Backfill message_participants from existing email_messages.recipients.
	// Current shape: { to: [string], cc: [string], bcc: [string] } of email strings.
	yield* sql`
		INSERT INTO message_participants (email_message_id, email_address, role)
		SELECT m.id, lower(addr.value), roles.role_name
		FROM email_messages m
		CROSS JOIN LATERAL (VALUES ('to'), ('cc'), ('bcc')) AS roles(role_name)
		CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(m.recipients->roles.role_name, '[]'::jsonb)) AS addr(value)
		WHERE addr.value IS NOT NULL AND addr.value <> ''
		ON CONFLICT DO NOTHING
	`
	// Outbound 'from' can be recovered via the sending inbox.
	yield* sql`
		INSERT INTO message_participants (email_message_id, email_address, role)
		SELECT m.id, lower(i.email), 'from'
		FROM email_messages m
		JOIN inboxes i ON i.provider_inbox_id = m.provider_inbox_id
		WHERE m.direction = 'outbound'
		ON CONFLICT DO NOTHING
	`
	// Link each participant to an existing contact row when the email matches.
	yield* sql`
		UPDATE message_participants mp SET contact_id = c.id
		FROM contacts c
		WHERE lower(c.email) = mp.email_address AND mp.contact_id IS NULL
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
			kind                    text NOT NULL CHECK (kind IN ('leaf','group','followup','cache_hit')) DEFAULT 'leaf',

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

	// ── Research checkpoint columns + cache tables ─────────────────
	yield* sql`ALTER TABLE research_runs ADD COLUMN IF NOT EXISTS research_text text`
	yield* sql`ALTER TABLE research_runs ADD COLUMN IF NOT EXISTS phase smallint NOT NULL DEFAULT 0`
	yield* sql`ALTER TABLE research_runs ADD COLUMN IF NOT EXISTS schema_version int`

	yield* sql`
		CREATE TABLE IF NOT EXISTS search_cache (
			key_hash    text PRIMARY KEY,
			provider    text NOT NULL,
			query       text NOT NULL,
			items       jsonb NOT NULL,
			units_cost  int NOT NULL DEFAULT 0,
			cached_at   timestamptz NOT NULL DEFAULT now(),
			expires_at  timestamptz NOT NULL,
			hit_count   int NOT NULL DEFAULT 0
		)
	`
	yield* sql`
		CREATE TABLE IF NOT EXISTS extraction_cache (
			key_hash       text PRIMARY KEY,
			content_hash   text NOT NULL,
			schema_name    text NOT NULL,
			schema_version int NOT NULL,
			model          text NOT NULL,
			result         jsonb NOT NULL,
			tokens_in      int NOT NULL DEFAULT 0,
			tokens_out     int NOT NULL DEFAULT 0,
			cached_at      timestamptz NOT NULL DEFAULT now()
		)
	`
	yield* sql`
		CREATE TABLE IF NOT EXISTS llm_cache (
			key_hash       text PRIMARY KEY,
			tier           text NOT NULL CHECK (tier IN ('agent','extract','writer')),
			model          text NOT NULL,
			prompt_preview text NOT NULL,
			response       jsonb NOT NULL,
			tokens_in      int NOT NULL DEFAULT 0,
			tokens_out     int NOT NULL DEFAULT 0,
			cached_at      timestamptz NOT NULL DEFAULT now(),
			expires_at     timestamptz NOT NULL,
			hit_count      int NOT NULL DEFAULT 0
		)
	`
	yield* sql`
		CREATE TABLE IF NOT EXISTS research_cache (
			key_hash    text PRIMARY KEY,
			user_id     text NOT NULL,
			research_id uuid NOT NULL REFERENCES research_runs(id),
			cached_at   timestamptz NOT NULL DEFAULT now(),
			expires_at  timestamptz NOT NULL
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

		// email_draft_bodies
		sql`CREATE INDEX IF NOT EXISTS idx_email_draft_bodies_inbox ON email_draft_bodies(inbox_id)`,

		// email_attachment_staging — hot paths are per-inbox recency, draft cleanup, and TTL sweep.
		sql`CREATE INDEX IF NOT EXISTS idx_email_attachment_staging_inbox ON email_attachment_staging(inbox_id, created_at DESC)`,
		sql`CREATE INDEX IF NOT EXISTS idx_email_attachment_staging_draft ON email_attachment_staging(draft_id) WHERE draft_id IS NOT NULL`,
		sql`CREATE INDEX IF NOT EXISTS idx_email_attachment_staging_expires ON email_attachment_staging(expires_at) WHERE sent_at IS NULL`,

		// call_recordings — partial index on the common "active" path.
		sql`CREATE INDEX IF NOT EXISTS idx_call_recordings_active ON call_recordings(deleted_at) WHERE deleted_at IS NULL`,

		// timeline_activity — company/contact/kind feeds are the hot queries.
		sql`CREATE INDEX IF NOT EXISTS idx_timeline_activity_company ON timeline_activity(company_id, occurred_at DESC)`,
		sql`CREATE INDEX IF NOT EXISTS idx_timeline_activity_contact ON timeline_activity(contact_id, occurred_at DESC) WHERE contact_id IS NOT NULL`,
		sql`CREATE INDEX IF NOT EXISTS idx_timeline_activity_entity ON timeline_activity(entity_type, entity_id)`,
		sql`CREATE INDEX IF NOT EXISTS idx_timeline_activity_kind ON timeline_activity(kind, occurred_at DESC)`,

		// message_participants — case-insensitive uniqueness + fast lookup by email/contact.
		sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_message_participants_msg_addr_role ON message_participants(email_message_id, lower(email_address), role)`,
		sql`CREATE INDEX IF NOT EXISTS idx_message_participants_email ON message_participants(lower(email_address))`,
		sql`CREATE INDEX IF NOT EXISTS idx_message_participants_contact ON message_participants(contact_id) WHERE contact_id IS NOT NULL`,

		// research_runs
		sql`CREATE INDEX IF NOT EXISTS research_runs_status_idx ON research_runs(status) WHERE status IN ('queued','running')`,
		sql`CREATE INDEX IF NOT EXISTS research_runs_parent_idx ON research_runs(parent_id)`,
		sql`CREATE INDEX IF NOT EXISTS research_runs_created_by_idx ON research_runs(created_by)`,

		// sources / research_links / research_paid_spend
		sql`CREATE INDEX IF NOT EXISTS sources_domain_idx ON sources(domain)`,
		sql`CREATE INDEX IF NOT EXISTS research_links_subject_idx ON research_links(subject_table, subject_id)`,
		sql`CREATE INDEX IF NOT EXISTS research_paid_spend_user_at_idx ON research_paid_spend(user_id, at DESC)`,

		// research cache tables
		sql`CREATE INDEX IF NOT EXISTS search_cache_expires_idx ON search_cache(expires_at)`,
		sql`CREATE INDEX IF NOT EXISTS llm_cache_tier_expires_idx ON llm_cache(tier, expires_at)`,
		sql`CREATE INDEX IF NOT EXISTS research_cache_user_expires_idx ON research_cache(user_id, expires_at)`,
		sql`CREATE INDEX IF NOT EXISTS extraction_cache_content_schema_idx ON extraction_cache(content_hash, schema_name)`,

		// calendar_events — hot queries are the month grid (by start_at) and
		// the "meetings with X" join (company/contact × start_at).
		sql`CREATE INDEX IF NOT EXISTS calendar_events_start_idx ON calendar_events(start_at)`,
		sql`CREATE INDEX IF NOT EXISTS calendar_events_company_idx ON calendar_events(company_id, start_at) WHERE company_id IS NOT NULL`,
		sql`CREATE INDEX IF NOT EXISTS calendar_events_contact_idx ON calendar_events(contact_id, start_at) WHERE contact_id IS NOT NULL`,
		sql`CREATE UNIQUE INDEX IF NOT EXISTS calendar_events_provider_booking_idx ON calendar_events(provider, provider_booking_id) WHERE provider_booking_id IS NOT NULL`,

		// calendar_event_attendees — fast "upcoming meetings with contact" lookup.
		sql`CREATE INDEX IF NOT EXISTS calendar_event_attendees_contact_idx ON calendar_event_attendees(contact_id) WHERE contact_id IS NOT NULL`,
		sql`CREATE INDEX IF NOT EXISTS calendar_event_attendees_event_idx ON calendar_event_attendees(event_id)`,

		// tasks — queue-style views (by assignee+status) and overdue scan.
		sql`CREATE INDEX IF NOT EXISTS tasks_assignee_status_idx ON tasks(assignee_id, status) WHERE assignee_id IS NOT NULL`,
		sql`CREATE INDEX IF NOT EXISTS tasks_due_at_open_idx ON tasks(due_at) WHERE status = 'open' AND due_at IS NOT NULL`,
		sql`CREATE INDEX IF NOT EXISTS tasks_company_idx ON tasks(company_id) WHERE company_id IS NOT NULL`,

		// task_events — most recent changes per task drive the undo drawer.
		sql`CREATE INDEX IF NOT EXISTS task_events_task_id_idx ON task_events(task_id, at DESC)`,
	])
})

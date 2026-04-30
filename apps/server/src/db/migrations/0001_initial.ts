import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// Single-initial-migration policy: this file is the only schema source of
// truth. Every CREATE TABLE here is the table's final shape — no
// ADD COLUMN / ALTER COLUMN / DROP COLUMN patches stacked on top, no
// data backfills. `pnpm cli db reset` drops the database and re-runs this
// from scratch; the seed (`apps/cli/src/commands/seed.ts`) populates the
// rows the dev/test environment needs.
//
// Better Auth runs its own migration *before* this one (see
// `apps/server/src/db/migrate.ts`), so the auth-managed tables — `user`,
// `session`, `account`, `verification`, `organization`, `member`,
// `invitation` — already exist when we get here. The only adjustment we
// make to those is `member.primary_inbox_id` at the bottom of this file:
// Better Auth's `additionalFields` lands it as TEXT, but the FK target
// `inboxes.id` is UUID, so we drop+readd that column with the right type.

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient

	// ── Multi-tenant roles ───────────────────────────────────────────
	// `app_user` is what HTTP and MCP request handlers run as. RLS gates
	// row visibility on `current_setting('app.current_org_id', true)`,
	// which the per-request middleware sets at the top of every
	// transaction.
	// `app_service` is what the mail-worker and cron jobs run as.
	// BYPASSRLS lets background workers resolve the org explicitly from
	// each row instead of carrying a session-scoped GUC across batches.
	// NOLOGIN on both: the database connection still authenticates as
	// the DATABASE_URL owner; the app issues `SET ROLE` inside the
	// request boundary so the boundary is auditable.
	yield* sql`
		DO $$
		BEGIN
			IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
				CREATE ROLE app_user NOLOGIN;
			END IF;
			IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_service') THEN
				CREATE ROLE app_service NOLOGIN BYPASSRLS;
			END IF;
		END
		$$;
	`

	// ── CRM core ─────────────────────────────────────────────────────
	// `organization_id` is required on every row that holds user data.
	// `slug` is unique per org so two orgs can each have a company called
	// `acme`. Cadence columns (last_*_at, next_calendar_event_at) are
	// denormalised so "who haven't I emailed in 30 days?" is a single
	// table scan; they're maintained by handlers and the worker, not by
	// triggers (the project favours explicit writes over hidden state).
	yield* sql`
		CREATE TABLE IF NOT EXISTS companies (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			organization_id TEXT NOT NULL,
			slug TEXT NOT NULL,
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
			last_email_at TIMESTAMPTZ,
			last_call_at TIMESTAMPTZ,
			last_meeting_at TIMESTAMPTZ,
			next_calendar_event_at TIMESTAMPTZ,
			latitude NUMERIC(9,6),
			longitude NUMERIC(9,6),
			geocoded_at TIMESTAMPTZ,
			geocode_source TEXT,
			metadata JSONB,
			version INT NOT NULL DEFAULT 0,
			deleted_at TIMESTAMPTZ,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			UNIQUE (organization_id, slug),
			CONSTRAINT companies_latlng_chk CHECK (
				(latitude IS NULL AND longitude IS NULL)
				OR (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)
			)
		)
	`
	yield* sql`
		CREATE TABLE IF NOT EXISTS contacts (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			organization_id TEXT NOT NULL,
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
			last_email_at TIMESTAMPTZ,
			last_call_at TIMESTAMPTZ,
			last_meeting_at TIMESTAMPTZ,
			next_calendar_event_at TIMESTAMPTZ,
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
			organization_id TEXT NOT NULL,
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
			organization_id TEXT NOT NULL,
			slug TEXT NOT NULL,
			name TEXT NOT NULL,
			type TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'active',
			description TEXT,
			default_price NUMERIC(10, 2),
			price_type TEXT DEFAULT 'fixed',
			target_industries TEXT[],
			metadata JSONB,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			UNIQUE (organization_id, slug)
		)
	`
	yield* sql`
		CREATE TABLE IF NOT EXISTS proposals (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			organization_id TEXT NOT NULL,
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
			organization_id TEXT NOT NULL,
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
			organization_id TEXT NOT NULL,
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
			UNIQUE (organization_id, slug, lang)
		)
	`
	yield* sql`
		CREATE TABLE IF NOT EXISTS webhook_endpoints (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			organization_id TEXT NOT NULL,
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
	// One inbox = one IMAP+SMTP mailbox (Infomaniak / Fastmail / M365 /
	// generic IMAP). Credentials are AES-256-GCM ciphertext at rest;
	// folder_state holds per-folder UIDVALIDITY + lastUid checkpoints
	// the mail-worker uses to resume IMAP sync without duplicates.
	yield* sql`
		CREATE TABLE IF NOT EXISTS inboxes (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			organization_id TEXT NOT NULL,
			email TEXT NOT NULL,
			display_name TEXT,
			purpose TEXT NOT NULL,
			owner_user_id TEXT,
			is_default BOOLEAN NOT NULL DEFAULT false,
			is_private BOOLEAN NOT NULL DEFAULT false,
			active BOOLEAN NOT NULL DEFAULT true,

			imap_host TEXT NOT NULL,
			imap_port INTEGER NOT NULL,
			imap_security TEXT NOT NULL CHECK (imap_security IN ('tls','starttls','plain')),

			smtp_host TEXT NOT NULL,
			smtp_port INTEGER NOT NULL,
			smtp_security TEXT NOT NULL CHECK (smtp_security IN ('tls','starttls','plain')),

			username TEXT NOT NULL,
			password_ciphertext BYTEA NOT NULL,
			password_nonce BYTEA NOT NULL,
			password_tag BYTEA NOT NULL,

			grant_status TEXT NOT NULL DEFAULT 'connected'
				CHECK (grant_status IN ('connected','auth_failed','connect_failed','disabled')),
			grant_last_error TEXT,
			grant_last_seen_at TIMESTAMPTZ,

			folder_state JSONB NOT NULL DEFAULT '{}'::jsonb,

			created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

			CONSTRAINT inboxes_purpose_owner_chk CHECK (
				(purpose = 'human'  AND owner_user_id IS NOT NULL) OR
				(purpose = 'agent'  AND owner_user_id IS NOT NULL) OR
				(purpose = 'shared' AND owner_user_id IS NULL AND is_private = false)
			)
		)
	`
	// external_thread_id is the RFC 5322 Message-ID of the thread root —
	// stable across providers, replaces the old per-vendor thread id.
	yield* sql`
		CREATE TABLE IF NOT EXISTS email_thread_links (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			organization_id TEXT NOT NULL,
			external_thread_id TEXT NOT NULL,
			inbox_id UUID REFERENCES inboxes(id) ON DELETE SET NULL,
			company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
			contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
			subject TEXT,
			status TEXT NOT NULL DEFAULT 'open',
			last_read_at TIMESTAMPTZ,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			UNIQUE (organization_id, external_thread_id)
		)
	`

	// ── Calendar ─────────────────────────────────────────────────────
	// Event types are vendor-neutral: `provider` names the backend, and
	// `provider_event_type_id` is always TEXT (cal.com yields numeric ids,
	// Google/Microsoft yield strings — storing both as TEXT keeps the
	// column shape stable across provider swaps). Slug is unique per org.
	yield* sql`
		CREATE TABLE IF NOT EXISTS calendar_event_types (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			organization_id TEXT NOT NULL,
			slug TEXT NOT NULL,
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
			UNIQUE (organization_id, slug),
			UNIQUE (organization_id, provider, provider_event_type_id)
		)
	`
	// `source` = why it's in our DB; `provider` = which backend owns
	// the upstream row. Splitting them lets the booking backend swap
	// without rewriting `source='booking'` rows. `ical_uid` is per-org
	// unique; iCal UIDs are RFC-globally-unique in theory, but two orgs
	// importing the same external feed should each get their own row.
	yield* sql`
		CREATE TABLE IF NOT EXISTS calendar_events (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			organization_id TEXT NOT NULL,
			source TEXT NOT NULL CHECK (source IN ('booking','email','internal')),
			provider TEXT NOT NULL CHECK (provider IN ('calcom','google','microsoft','email','internal')),
			provider_booking_id TEXT,
			ical_uid TEXT NOT NULL,
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
			UNIQUE (organization_id, ical_uid),
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
			organization_id TEXT NOT NULL,
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
			organization_id TEXT NOT NULL,
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
			organization_id TEXT NOT NULL,
			task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
			at TIMESTAMPTZ NOT NULL DEFAULT now(),
			actor_id TEXT,
			actor_kind TEXT NOT NULL CHECK (actor_kind IN ('user','agent')),
			change JSONB NOT NULL
		)
	`

	// One row per RFC 822 message. message_id is the RFC 5322 Message-ID
	// (stable across providers); imap_uid + imap_uidvalidity locate the
	// message inside the user's mailbox so the worker can resume sync.
	// raw_rfc822_ref points at the full bytes in object storage; parsed
	// text/html bodies live inline for fast list/thread reads.
	// Default recipients shape is { to, cc, bcc } — JSONB snapshot for
	// compose UI; queryable index lives in message_participants.
	yield* sql`
		CREATE TABLE IF NOT EXISTS email_messages (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			organization_id TEXT NOT NULL,
			inbox_id UUID REFERENCES inboxes(id) ON DELETE SET NULL,

			message_id TEXT NOT NULL,
			in_reply_to TEXT,
			"references" TEXT[],

			direction TEXT NOT NULL,
			folder TEXT NOT NULL,
			imap_uid INTEGER,
			imap_uidvalidity INTEGER,

			raw_rfc822_ref TEXT NOT NULL,
			subject TEXT,
			received_at TIMESTAMPTZ,
			text_preview TEXT,
			text_body TEXT,
			html_body TEXT,

			company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
			contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
			recipients JSONB NOT NULL DEFAULT '{"to":[],"cc":[],"bcc":[]}'::jsonb,

			status TEXT NOT NULL CHECK (status IN ('normal','spam','blocked','bounced')),
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
			organization_id TEXT NOT NULL,
			inbox_id UUID NOT NULL REFERENCES inboxes(id) ON DELETE CASCADE,
			name TEXT NOT NULL,
			body_json JSONB NOT NULL,
			is_default BOOLEAN NOT NULL DEFAULT false,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)
	`

	// Drafts are owned by Postgres (not the provider filesystem) so they
	// survive server restarts and can be queried by other org members in
	// the same workspace. body_json is the editor's block tree; html/text
	// are derived on send. Recipient lists land as TEXT[] so partial
	// recipient sets (drafts in flight) are queryable without JSON parsing.
	// `mode` distinguishes new from reply drafts; `thread_link_id` and
	// `in_reply_to` carry the threading context for replies. `client_id`
	// is the editor session id, opaque to the server, used for optimistic
	// reconciliation between two tabs editing the same draft.
	yield* sql`
		CREATE TABLE IF NOT EXISTS email_drafts (
			draft_id TEXT PRIMARY KEY,
			organization_id TEXT NOT NULL,
			inbox_id UUID NOT NULL REFERENCES inboxes(id) ON DELETE CASCADE,
			mode TEXT NOT NULL DEFAULT 'new'
				CHECK (mode IN ('new', 'reply')),
			to_addresses TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
			cc_addresses TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
			bcc_addresses TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
			subject TEXT,
			in_reply_to TEXT,
			thread_link_id UUID REFERENCES email_thread_links(id) ON DELETE SET NULL,
			client_id TEXT,
			body_json JSONB NOT NULL DEFAULT '{}'::jsonb,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
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
			organization_id TEXT NOT NULL,
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
	// actor_user_id is TEXT because Better Auth user ids are cuid2 strings,
	// not UUIDs.
	yield* sql`
		CREATE TABLE IF NOT EXISTS timeline_activity (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			organization_id TEXT NOT NULL,
			kind TEXT NOT NULL,
			entity_type TEXT NOT NULL,
			entity_id UUID NOT NULL,
			company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
			contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
			channel TEXT,
			direction TEXT,
			actor_user_id TEXT,
			occurred_at TIMESTAMPTZ NOT NULL,
			summary TEXT,
			payload JSONB NOT NULL DEFAULT '{}'::jsonb,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)
	`

	// One row per (email_message × email_address × role) so every CC'd
	// participant is addressable, even when no contact exists yet.
	// Org isolation is transitive through email_messages — see the RLS
	// policy at the bottom of this file.
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

	// ── Call recordings ──────────────────────────────────────────────
	yield* sql`
		CREATE TABLE IF NOT EXISTS call_recordings (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			organization_id TEXT NOT NULL,
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
	// research_runs: idempotency_key is per-org so two orgs can run the
	// same query independently. research_text/phase/schema_version are
	// checkpoint columns the engine fills in mid-run.
	yield* sql`
		CREATE TABLE IF NOT EXISTS research_runs (
			id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
			organization_id         text NOT NULL,
			parent_id               uuid REFERENCES research_runs(id) ON DELETE CASCADE,
			kind                    text NOT NULL CHECK (kind IN ('leaf','group','followup','cache_hit')) DEFAULT 'leaf',

			query                   text NOT NULL,
			mode                    text NOT NULL DEFAULT 'deep',
			schema_name             text,
			schema_version          int,
			phase                   smallint NOT NULL DEFAULT 0,

			status                  text NOT NULL CHECK (status IN ('queued','running','succeeded','failed','cancelled','deleted')),
			context                 jsonb NOT NULL DEFAULT '{}'::jsonb,

			findings                jsonb NOT NULL DEFAULT '{}'::jsonb,
			brief_md                text,
			research_text           text,

			budget_cents            int NOT NULL DEFAULT 0,
			paid_budget_cents       int NOT NULL DEFAULT 0,
			cost_cents              int NOT NULL DEFAULT 0,
			paid_cost_cents         int NOT NULL DEFAULT 0,
			cost_breakdown          jsonb NOT NULL DEFAULT '{}'::jsonb,
			quota_breakdown         jsonb NOT NULL DEFAULT '{}'::jsonb,
			tokens_in               int NOT NULL DEFAULT 0,
			tokens_out              int NOT NULL DEFAULT 0,
			paid_policy             jsonb NOT NULL DEFAULT '{}'::jsonb,

			idempotency_key         text,
			created_by              text NOT NULL,
			created_at              timestamptz NOT NULL DEFAULT now(),
			started_at              timestamptz,
			completed_at            timestamptz,
			updated_at              timestamptz NOT NULL DEFAULT now(),

			tool_log                jsonb NOT NULL DEFAULT '[]'::jsonb,

			UNIQUE (organization_id, idempotency_key)
		)
	`
	// sources stays GLOBAL: it's a content-addressable cache keyed by
	// url_hash. Two orgs researching the same domain share the same row;
	// org isolation is enforced through research_run_sources (which IS
	// org-scoped via research_id).
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
			organization_id  text NOT NULL,
			research_id      uuid NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
			source_id        text NOT NULL REFERENCES sources(id),
			local_ref        text NOT NULL,
			fetched_at       timestamptz NOT NULL DEFAULT now(),
			cost_cents       int NOT NULL DEFAULT 0,
			PRIMARY KEY (research_id, source_id)
		)
	`
	yield* sql`
		CREATE TABLE IF NOT EXISTS research_links (
			organization_id  text NOT NULL,
			research_id      uuid NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
			subject_table    text NOT NULL CHECK (subject_table IN ('companies','contacts')),
			subject_id       uuid NOT NULL,
			link_kind        text NOT NULL CHECK (link_kind IN ('input','finding')),
			created_at       timestamptz NOT NULL DEFAULT now(),
			PRIMARY KEY (research_id, subject_table, subject_id)
		)
	`
	// research_paid_spend: idempotency_key is per-org so paid calls in
	// one org never collide with another. (Pre-rewrite this was global.)
	yield* sql`
		CREATE TABLE IF NOT EXISTS research_paid_spend (
			id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
			organization_id  text NOT NULL,
			research_id      uuid NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
			user_id          text NOT NULL,
			provider         text NOT NULL,
			tool             text NOT NULL,
			idempotency_key  text NOT NULL,
			amount_cents     int NOT NULL,
			quota_units      int,
			quota_unit       text,
			args             jsonb NOT NULL,
			result_hash      text,
			result_data      jsonb,
			source_id        text REFERENCES sources(id),
			auto_approved    boolean NOT NULL,
			approved_by      text,
			at               timestamptz NOT NULL DEFAULT now(),
			UNIQUE (organization_id, idempotency_key)
		)
	`
	// user_research_policy / provider_quotas / provider_usage stay
	// per-user (no organization_id). They're user-level configuration
	// that travels with the user across orgs — Alice's OpenAI quota is
	// Alice's regardless of which org she's working in today.
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

	// ── Caches (global de-dup, no org scoping) ──────────────────────
	// Keyed by content/query hash; the same URL fetched by two orgs
	// shares the cache row. The org-scoped data is in research_runs.
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
		// Per-org indices on CRM tables — org_id leads in every read.
		sql`CREATE INDEX IF NOT EXISTS idx_companies_org ON companies(organization_id)`,
		sql`CREATE INDEX IF NOT EXISTS idx_contacts_org ON contacts(organization_id)`,
		sql`CREATE INDEX IF NOT EXISTS idx_contacts_company ON contacts(company_id)`,
		sql`CREATE INDEX IF NOT EXISTS idx_interactions_org ON interactions(organization_id)`,
		sql`CREATE INDEX IF NOT EXISTS idx_interactions_company ON interactions(company_id)`,
		sql`CREATE INDEX IF NOT EXISTS idx_products_org ON products(organization_id)`,
		sql`CREATE INDEX IF NOT EXISTS idx_proposals_org ON proposals(organization_id)`,
		sql`CREATE INDEX IF NOT EXISTS idx_documents_org ON documents(organization_id)`,
		sql`CREATE INDEX IF NOT EXISTS idx_pages_org ON pages(organization_id)`,
		sql`CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_org ON webhook_endpoints(organization_id)`,
		sql`CREATE INDEX IF NOT EXISTS idx_calendar_event_types_org ON calendar_event_types(organization_id)`,
		sql`CREATE INDEX IF NOT EXISTS idx_calendar_events_org ON calendar_events(organization_id)`,
		sql`CREATE INDEX IF NOT EXISTS idx_calendar_event_attendees_org ON calendar_event_attendees(organization_id)`,
		sql`CREATE INDEX IF NOT EXISTS idx_tasks_org ON tasks(organization_id)`,
		sql`CREATE INDEX IF NOT EXISTS idx_task_events_org ON task_events(organization_id)`,
		sql`CREATE INDEX IF NOT EXISTS idx_timeline_activity_org ON timeline_activity(organization_id)`,
		sql`CREATE INDEX IF NOT EXISTS idx_call_recordings_org ON call_recordings(organization_id)`,
		sql`CREATE INDEX IF NOT EXISTS idx_research_runs_org ON research_runs(organization_id)`,
		sql`CREATE INDEX IF NOT EXISTS idx_research_run_sources_org ON research_run_sources(organization_id)`,
		sql`CREATE INDEX IF NOT EXISTS idx_research_links_org ON research_links(organization_id)`,
		sql`CREATE INDEX IF NOT EXISTS idx_research_paid_spend_org ON research_paid_spend(organization_id)`,

		// email_thread_links — org_updated index drives the inbox-list view.
		sql`CREATE INDEX IF NOT EXISTS idx_email_thread_links_company_id ON email_thread_links(company_id)`,
		sql`CREATE INDEX IF NOT EXISTS idx_email_thread_links_inbox_id ON email_thread_links(inbox_id)`,
		sql`CREATE INDEX IF NOT EXISTS idx_email_thread_links_subject_lower ON email_thread_links(lower(subject))`,
		sql`CREATE INDEX IF NOT EXISTS idx_email_thread_links_org_updated ON email_thread_links(organization_id, updated_at DESC)`,

		// email_messages — imap_dedupe + msgid keep duplicate fetches no-ops;
		// references GIN powers the threading lookup.
		sql`CREATE INDEX IF NOT EXISTS idx_email_messages_contact_id ON email_messages(contact_id) WHERE contact_id IS NOT NULL`,
		sql`CREATE INDEX IF NOT EXISTS idx_email_messages_status ON email_messages(status)`,
		sql`CREATE INDEX IF NOT EXISTS idx_email_messages_org_status ON email_messages(organization_id, status_updated_at DESC)`,
		sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_email_messages_imap_dedupe ON email_messages(inbox_id, imap_uidvalidity, imap_uid) WHERE imap_uid IS NOT NULL`,
		sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_email_messages_msgid ON email_messages(organization_id, message_id)`,
		sql`CREATE INDEX IF NOT EXISTS idx_email_messages_references ON email_messages USING GIN ("references")`,
		sql`CREATE INDEX IF NOT EXISTS idx_email_messages_inbox_received ON email_messages(inbox_id, received_at DESC)`,
		sql`
			CREATE INDEX IF NOT EXISTS idx_email_messages_inbound_active
			ON email_messages(created_at DESC)
			WHERE direction = 'inbound' AND (inbound_classification IS NULL OR inbound_classification = 'normal')
		`,

		// inboxes — defaults are scoped per (org, owner, purpose) for owned
		// boxes and per (org, purpose) for shared boxes; worker scans by
		// grant_status so an isolated index pays for itself.
		sql`CREATE INDEX IF NOT EXISTS idx_inboxes_org ON inboxes(organization_id)`,
		sql`CREATE INDEX IF NOT EXISTS idx_inboxes_purpose ON inboxes(purpose) WHERE active = true`,
		sql`
			CREATE INDEX IF NOT EXISTS idx_inboxes_org_owner_active
			ON inboxes(organization_id, owner_user_id)
			WHERE owner_user_id IS NOT NULL AND active = true
		`,
		sql`
			CREATE UNIQUE INDEX IF NOT EXISTS idx_inboxes_default_per_owner
			ON inboxes(organization_id, owner_user_id, purpose)
			WHERE is_default = true AND owner_user_id IS NOT NULL
		`,
		sql`
			CREATE UNIQUE INDEX IF NOT EXISTS idx_inboxes_default_shared
			ON inboxes(organization_id, purpose)
			WHERE is_default = true AND owner_user_id IS NULL
		`,
		sql`CREATE INDEX IF NOT EXISTS idx_inboxes_grant_status ON inboxes(grant_status) WHERE active = true`,

		// inbox_footers
		sql`CREATE INDEX IF NOT EXISTS idx_inbox_footers_inbox_id ON inbox_footers(inbox_id)`,
		sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_inbox_footers_single_default ON inbox_footers(inbox_id) WHERE is_default = true`,

		// email_drafts
		sql`CREATE INDEX IF NOT EXISTS idx_email_drafts_inbox ON email_drafts(inbox_id)`,
		sql`CREATE INDEX IF NOT EXISTS idx_email_drafts_org_updated ON email_drafts(organization_id, updated_at DESC)`,

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
		sql`CREATE UNIQUE INDEX IF NOT EXISTS calendar_events_provider_booking_idx ON calendar_events(organization_id, provider, provider_booking_id) WHERE provider_booking_id IS NOT NULL`,

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

	// ── Better Auth additions ───────────────────────────────────────
	// member.primary_inbox_id is the member's default From identity in
	// this org; ON DELETE SET NULL so deleting the inbox demotes the
	// member back to "no primary" rather than cascading them out.
	// migrate.ts runs Better Auth before this CRM migration so `member`
	// already exists by the time we reach this block. Better Auth's
	// additionalFields declares `primaryInboxId` as `string`, which lands
	// as TEXT — but the FK target inboxes.id is UUID, so we drop the
	// stale TEXT column and re-add it with the right type before
	// installing the FK.
	yield* sql`ALTER TABLE "member" DROP COLUMN IF EXISTS primary_inbox_id`
	yield* sql`
		ALTER TABLE "member"
			ADD COLUMN primary_inbox_id UUID
	`
	yield* sql`
		DO $$
		BEGIN
			IF NOT EXISTS (
				SELECT 1 FROM pg_constraint WHERE conname = 'member_primary_inbox_id_fkey'
			) THEN
				ALTER TABLE "member"
					ADD CONSTRAINT member_primary_inbox_id_fkey
					FOREIGN KEY (primary_inbox_id) REFERENCES inboxes(id) ON DELETE SET NULL;
			END IF;
		END
		$$;
	`
	yield* sql`
		CREATE INDEX IF NOT EXISTS idx_member_primary_inbox
			ON "member"(primary_inbox_id) WHERE primary_inbox_id IS NOT NULL
	`

	// ── Row-level security ──────────────────────────────────────────
	// Every org-scoped table has RLS gated on
	// current_setting('app.current_org_id', true). The web request path
	// sets this GUC inside withTransaction; the worker uses app_service
	// (BYPASSRLS) and resolves the org explicitly per row.
	//
	// FORCE ROW LEVEL SECURITY makes the policy apply to the table owner
	// too, not just non-owners — without FORCE, the role that owns the
	// table (typically the DATABASE_URL connection role) bypasses the
	// policy. TO app_user scopes the policy so app_service still gets to
	// bypass cleanly via its BYPASSRLS attribute.
	//
	// message_participants is scoped transitively through email_messages
	// (no organization_id column of its own).
	yield* Effect.all([
		// Email stack
		sql`ALTER TABLE inboxes ENABLE ROW LEVEL SECURITY`,
		sql`ALTER TABLE inboxes FORCE ROW LEVEL SECURITY`,
		sql`ALTER TABLE email_thread_links ENABLE ROW LEVEL SECURITY`,
		sql`ALTER TABLE email_thread_links FORCE ROW LEVEL SECURITY`,
		sql`ALTER TABLE email_messages ENABLE ROW LEVEL SECURITY`,
		sql`ALTER TABLE email_messages FORCE ROW LEVEL SECURITY`,
		sql`ALTER TABLE email_drafts ENABLE ROW LEVEL SECURITY`,
		sql`ALTER TABLE email_drafts FORCE ROW LEVEL SECURITY`,
		sql`ALTER TABLE inbox_footers ENABLE ROW LEVEL SECURITY`,
		sql`ALTER TABLE inbox_footers FORCE ROW LEVEL SECURITY`,
		sql`ALTER TABLE email_attachment_staging ENABLE ROW LEVEL SECURITY`,
		sql`ALTER TABLE email_attachment_staging FORCE ROW LEVEL SECURITY`,
		sql`ALTER TABLE message_participants ENABLE ROW LEVEL SECURITY`,
		sql`ALTER TABLE message_participants FORCE ROW LEVEL SECURITY`,

		// CRM core
		sql`ALTER TABLE companies ENABLE ROW LEVEL SECURITY`,
		sql`ALTER TABLE companies FORCE ROW LEVEL SECURITY`,
		sql`ALTER TABLE contacts ENABLE ROW LEVEL SECURITY`,
		sql`ALTER TABLE contacts FORCE ROW LEVEL SECURITY`,
		sql`ALTER TABLE interactions ENABLE ROW LEVEL SECURITY`,
		sql`ALTER TABLE interactions FORCE ROW LEVEL SECURITY`,
		sql`ALTER TABLE products ENABLE ROW LEVEL SECURITY`,
		sql`ALTER TABLE products FORCE ROW LEVEL SECURITY`,
		sql`ALTER TABLE proposals ENABLE ROW LEVEL SECURITY`,
		sql`ALTER TABLE proposals FORCE ROW LEVEL SECURITY`,
		sql`ALTER TABLE documents ENABLE ROW LEVEL SECURITY`,
		sql`ALTER TABLE documents FORCE ROW LEVEL SECURITY`,
		sql`ALTER TABLE pages ENABLE ROW LEVEL SECURITY`,
		sql`ALTER TABLE pages FORCE ROW LEVEL SECURITY`,
		sql`ALTER TABLE webhook_endpoints ENABLE ROW LEVEL SECURITY`,
		sql`ALTER TABLE webhook_endpoints FORCE ROW LEVEL SECURITY`,
		sql`ALTER TABLE calendar_event_types ENABLE ROW LEVEL SECURITY`,
		sql`ALTER TABLE calendar_event_types FORCE ROW LEVEL SECURITY`,
		sql`ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY`,
		sql`ALTER TABLE calendar_events FORCE ROW LEVEL SECURITY`,
		sql`ALTER TABLE calendar_event_attendees ENABLE ROW LEVEL SECURITY`,
		sql`ALTER TABLE calendar_event_attendees FORCE ROW LEVEL SECURITY`,
		sql`ALTER TABLE tasks ENABLE ROW LEVEL SECURITY`,
		sql`ALTER TABLE tasks FORCE ROW LEVEL SECURITY`,
		sql`ALTER TABLE task_events ENABLE ROW LEVEL SECURITY`,
		sql`ALTER TABLE task_events FORCE ROW LEVEL SECURITY`,
		sql`ALTER TABLE timeline_activity ENABLE ROW LEVEL SECURITY`,
		sql`ALTER TABLE timeline_activity FORCE ROW LEVEL SECURITY`,
		sql`ALTER TABLE call_recordings ENABLE ROW LEVEL SECURITY`,
		sql`ALTER TABLE call_recordings FORCE ROW LEVEL SECURITY`,

		// Research
		sql`ALTER TABLE research_runs ENABLE ROW LEVEL SECURITY`,
		sql`ALTER TABLE research_runs FORCE ROW LEVEL SECURITY`,
		sql`ALTER TABLE research_run_sources ENABLE ROW LEVEL SECURITY`,
		sql`ALTER TABLE research_run_sources FORCE ROW LEVEL SECURITY`,
		sql`ALTER TABLE research_links ENABLE ROW LEVEL SECURITY`,
		sql`ALTER TABLE research_links FORCE ROW LEVEL SECURITY`,
		sql`ALTER TABLE research_paid_spend ENABLE ROW LEVEL SECURITY`,
		sql`ALTER TABLE research_paid_spend FORCE ROW LEVEL SECURITY`,
	])

	// Policies — single shape applied uniformly: org_id matches the GUC.
	// USING gates reads/updates/deletes; WITH CHECK gates inserts/updates
	// so a row can never be written into a different org than the GUC.
	yield* Effect.all([
		sql`
			CREATE POLICY org_isolation_inboxes ON inboxes
				TO app_user
				USING (organization_id = current_setting('app.current_org_id', true))
				WITH CHECK (organization_id = current_setting('app.current_org_id', true))
		`,
		sql`
			CREATE POLICY org_isolation_email_thread_links ON email_thread_links
				TO app_user
				USING (organization_id = current_setting('app.current_org_id', true))
				WITH CHECK (organization_id = current_setting('app.current_org_id', true))
		`,
		sql`
			CREATE POLICY org_isolation_email_messages ON email_messages
				TO app_user
				USING (organization_id = current_setting('app.current_org_id', true))
				WITH CHECK (organization_id = current_setting('app.current_org_id', true))
		`,
		sql`
			CREATE POLICY org_isolation_email_drafts ON email_drafts
				TO app_user
				USING (organization_id = current_setting('app.current_org_id', true))
				WITH CHECK (organization_id = current_setting('app.current_org_id', true))
		`,
		sql`
			CREATE POLICY org_isolation_inbox_footers ON inbox_footers
				TO app_user
				USING (organization_id = current_setting('app.current_org_id', true))
				WITH CHECK (organization_id = current_setting('app.current_org_id', true))
		`,
		sql`
			CREATE POLICY org_isolation_email_attachment_staging ON email_attachment_staging
				TO app_user
				USING (organization_id = current_setting('app.current_org_id', true))
				WITH CHECK (organization_id = current_setting('app.current_org_id', true))
		`,
		// message_participants — transitive through email_messages.
		sql`
			CREATE POLICY org_isolation_message_participants ON message_participants
				TO app_user
				USING (
					EXISTS (
						SELECT 1 FROM email_messages m
						WHERE m.id = message_participants.email_message_id
							AND m.organization_id = current_setting('app.current_org_id', true)
					)
				)
				WITH CHECK (
					EXISTS (
						SELECT 1 FROM email_messages m
						WHERE m.id = message_participants.email_message_id
							AND m.organization_id = current_setting('app.current_org_id', true)
					)
				)
		`,

		// CRM core — uniform shape.
		sql`
			CREATE POLICY org_isolation_companies ON companies
				TO app_user
				USING (organization_id = current_setting('app.current_org_id', true))
				WITH CHECK (organization_id = current_setting('app.current_org_id', true))
		`,
		sql`
			CREATE POLICY org_isolation_contacts ON contacts
				TO app_user
				USING (organization_id = current_setting('app.current_org_id', true))
				WITH CHECK (organization_id = current_setting('app.current_org_id', true))
		`,
		sql`
			CREATE POLICY org_isolation_interactions ON interactions
				TO app_user
				USING (organization_id = current_setting('app.current_org_id', true))
				WITH CHECK (organization_id = current_setting('app.current_org_id', true))
		`,
		sql`
			CREATE POLICY org_isolation_products ON products
				TO app_user
				USING (organization_id = current_setting('app.current_org_id', true))
				WITH CHECK (organization_id = current_setting('app.current_org_id', true))
		`,
		sql`
			CREATE POLICY org_isolation_proposals ON proposals
				TO app_user
				USING (organization_id = current_setting('app.current_org_id', true))
				WITH CHECK (organization_id = current_setting('app.current_org_id', true))
		`,
		sql`
			CREATE POLICY org_isolation_documents ON documents
				TO app_user
				USING (organization_id = current_setting('app.current_org_id', true))
				WITH CHECK (organization_id = current_setting('app.current_org_id', true))
		`,
		sql`
			CREATE POLICY org_isolation_pages ON pages
				TO app_user
				USING (organization_id = current_setting('app.current_org_id', true))
				WITH CHECK (organization_id = current_setting('app.current_org_id', true))
		`,
		sql`
			CREATE POLICY org_isolation_webhook_endpoints ON webhook_endpoints
				TO app_user
				USING (organization_id = current_setting('app.current_org_id', true))
				WITH CHECK (organization_id = current_setting('app.current_org_id', true))
		`,
		sql`
			CREATE POLICY org_isolation_calendar_event_types ON calendar_event_types
				TO app_user
				USING (organization_id = current_setting('app.current_org_id', true))
				WITH CHECK (organization_id = current_setting('app.current_org_id', true))
		`,
		sql`
			CREATE POLICY org_isolation_calendar_events ON calendar_events
				TO app_user
				USING (organization_id = current_setting('app.current_org_id', true))
				WITH CHECK (organization_id = current_setting('app.current_org_id', true))
		`,
		sql`
			CREATE POLICY org_isolation_calendar_event_attendees ON calendar_event_attendees
				TO app_user
				USING (organization_id = current_setting('app.current_org_id', true))
				WITH CHECK (organization_id = current_setting('app.current_org_id', true))
		`,
		sql`
			CREATE POLICY org_isolation_tasks ON tasks
				TO app_user
				USING (organization_id = current_setting('app.current_org_id', true))
				WITH CHECK (organization_id = current_setting('app.current_org_id', true))
		`,
		sql`
			CREATE POLICY org_isolation_task_events ON task_events
				TO app_user
				USING (organization_id = current_setting('app.current_org_id', true))
				WITH CHECK (organization_id = current_setting('app.current_org_id', true))
		`,
		sql`
			CREATE POLICY org_isolation_timeline_activity ON timeline_activity
				TO app_user
				USING (organization_id = current_setting('app.current_org_id', true))
				WITH CHECK (organization_id = current_setting('app.current_org_id', true))
		`,
		sql`
			CREATE POLICY org_isolation_call_recordings ON call_recordings
				TO app_user
				USING (organization_id = current_setting('app.current_org_id', true))
				WITH CHECK (organization_id = current_setting('app.current_org_id', true))
		`,

		// Research
		sql`
			CREATE POLICY org_isolation_research_runs ON research_runs
				TO app_user
				USING (organization_id = current_setting('app.current_org_id', true))
				WITH CHECK (organization_id = current_setting('app.current_org_id', true))
		`,
		sql`
			CREATE POLICY org_isolation_research_run_sources ON research_run_sources
				TO app_user
				USING (organization_id = current_setting('app.current_org_id', true))
				WITH CHECK (organization_id = current_setting('app.current_org_id', true))
		`,
		sql`
			CREATE POLICY org_isolation_research_links ON research_links
				TO app_user
				USING (organization_id = current_setting('app.current_org_id', true))
				WITH CHECK (organization_id = current_setting('app.current_org_id', true))
		`,
		sql`
			CREATE POLICY org_isolation_research_paid_spend ON research_paid_spend
				TO app_user
				USING (organization_id = current_setting('app.current_org_id', true))
				WITH CHECK (organization_id = current_setting('app.current_org_id', true))
		`,
	])

	// ── Grants ──────────────────────────────────────────────────────
	// Defense-in-depth on top of RLS:
	//   1. REVOKE PUBLIC's default access to schema/objects so a forgotten
	//      future table doesn't end up world-readable.
	//   2. GRANT SCHEMA USAGE to app_user/app_service so they can resolve
	//      object names.
	//   3. GRANT full DML on every existing table to app_service (BYPASSRLS
	//      worker/cron path) — RLS doesn't gate it anyway.
	//   4. GRANT full DML on every existing app-data table to app_user — RLS
	//      then gates row visibility per-org.
	//   5. GRANT SELECT only on Better Auth tables to app_user. Better Auth's
	//      own API endpoints (/auth/*) are routed by Better Auth's HTTP
	//      integration outside our OrgMiddleware, so they run as the
	//      DATABASE_URL owner (not app_user) and keep full DML. Locking the
	//      request-path role to read-only on auth tables means even a SQL
	//      injection in a CRM handler can't mint sessions or hijack users.
	//   6. ALTER DEFAULT PRIVILEGES so a future migration that adds a table
	//      auto-grants it to both roles without re-issuing GRANT statements.
	yield* sql`REVOKE ALL ON SCHEMA public FROM PUBLIC`
	yield* sql`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC`
	yield* sql`REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC`

	yield* sql`GRANT USAGE ON SCHEMA public TO app_user, app_service`
	yield* sql`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_service`
	yield* sql`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user, app_service`

	// app_user gets DML on every existing table EXCEPT the Better Auth
	// auth-management tables. We then revoke writes on those auth tables
	// so even with the broad GRANT below the request-path role can only
	// read identity state.
	yield* sql`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user`
	yield* sql`REVOKE INSERT, UPDATE, DELETE ON "user", "session", "account", "verification", "organization", "member", "invitation" FROM app_user`

	// Default privileges so future tables (in any later migration) inherit
	// the same posture without manual GRANTs. New tables created in
	// `public` will be readable+writable by app_service and app_user;
	// administrators can still REVOKE on individual auth-style tables
	// after creation if needed.
	yield* sql`
		ALTER DEFAULT PRIVILEGES IN SCHEMA public
			GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user, app_service
	`
	yield* sql`
		ALTER DEFAULT PRIVILEGES IN SCHEMA public
			GRANT USAGE, SELECT ON SEQUENCES TO app_user, app_service
	`
})

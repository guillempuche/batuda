import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient
	yield* Effect.all([
		sql`
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
				metadata JSONB,
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
			)
		`,
		sql`
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
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
			)
		`,
		sql`
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
		`,
		sql`
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
		`,
		sql`
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
		`,
		sql`
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
		`,
		sql`
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
		`,
		sql`
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
		`,
		sql`
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
		`,
		sql`
			CREATE TABLE IF NOT EXISTS email_thread_links (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				agentmail_thread_id TEXT NOT NULL UNIQUE,
				agentmail_inbox_id TEXT NOT NULL,
				company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
				contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
				subject TEXT,
				status TEXT NOT NULL DEFAULT 'open',
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
			)
		`,
		sql`CREATE INDEX IF NOT EXISTS idx_email_thread_links_company_id ON email_thread_links(company_id)`,
		sql`CREATE INDEX IF NOT EXISTS idx_email_thread_links_inbox_id ON email_thread_links(agentmail_inbox_id)`,
		sql`
			CREATE TABLE IF NOT EXISTS email_messages (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				agentmail_message_id TEXT NOT NULL UNIQUE,
				agentmail_thread_id TEXT NOT NULL,
				agentmail_inbox_id TEXT NOT NULL,
				direction TEXT NOT NULL,
				company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
				contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
				recipients JSONB NOT NULL DEFAULT '[]'::jsonb,
				status TEXT NOT NULL,
				status_reason TEXT,
				bounce_type TEXT,
				bounce_sub_type TEXT,
				status_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
			)
		`,
		sql`CREATE INDEX IF NOT EXISTS idx_email_messages_thread_id ON email_messages(agentmail_thread_id)`,
		sql`CREATE INDEX IF NOT EXISTS idx_email_messages_contact_id ON email_messages(contact_id) WHERE contact_id IS NOT NULL`,
		sql`CREATE INDEX IF NOT EXISTS idx_email_messages_status ON email_messages(status)`,
	])
})

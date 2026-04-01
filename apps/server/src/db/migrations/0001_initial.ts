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
			CREATE TABLE IF NOT EXISTS api_keys (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				name TEXT NOT NULL,
				key_hash TEXT NOT NULL UNIQUE,
				scopes TEXT[] NOT NULL DEFAULT '{}',
				is_active BOOLEAN NOT NULL DEFAULT true,
				last_used_at TIMESTAMPTZ,
				expires_at TIMESTAMPTZ,
				created_at TIMESTAMPTZ NOT NULL DEFAULT now()
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
	])
})

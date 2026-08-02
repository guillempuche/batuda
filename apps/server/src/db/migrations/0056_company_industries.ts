import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// Each organisation keeps its own list of the trades it sells to.
//
// Until now a company's trade had to be one of nine words the app shipped with,
// and research rewrote everything else to "other" before storing it. A metal
// fabricator, a cheese producer and a driving school were all "other", so none of
// them could be picked out as a group — the trade was found, then thrown away.
//
// Free text on its own does not work either: it fills up with near-duplicates.
// This database holds "Metal fabrication" 107 times and "Metal Fabrication" 57
// times as two unrelated values, so a filter for one misses the other.
//
// So: a list per organisation, and a company points at an entry in it. Two
// spellings meet through `folded_key` — the name with accents, case and
// punctuation set aside — and the uniqueness rule on it is what stops the third
// spelling of a trade becoming a third trade. The folding itself is done in
// TypeScript (`foldLabel`), so there is one definition of when two names mean the
// same thing rather than one here and another in the application.
//
// A trade research turned up arrives with `needs_review` set, because the name is
// still the model's wording. One a person typed does not: typing it is the review.

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient

	yield* sql`
		CREATE TABLE IF NOT EXISTS company_industries (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			organization_id TEXT NOT NULL,
			-- The trade as somebody wrote it, which is what people see.
			label TEXT NOT NULL,
			-- The same trade in a web address.
			slug TEXT NOT NULL,
			-- The comparison form: what decides two spellings are one trade. Written
			-- by the application, never derived here, so the rule has one home.
			folded_key TEXT NOT NULL,
			-- Set for a trade research found, cleared once somebody has looked at it.
			needs_review BOOLEAN NOT NULL DEFAULT false,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)
	`

	// The guard that makes convergence real rather than hoped for: two writers
	// racing to add the same trade end up with one row, and the loser re-reads it.
	yield* sql`
		CREATE UNIQUE INDEX IF NOT EXISTS company_industries_folded_idx
			ON company_industries (organization_id, folded_key)
	`
	yield* sql`
		CREATE UNIQUE INDEX IF NOT EXISTS company_industries_slug_idx
			ON company_industries (organization_id, slug)
	`
	yield* sql`GRANT SELECT, INSERT, UPDATE, DELETE ON company_industries TO app_user, app_service`
	yield* sql`ALTER TABLE company_industries ENABLE ROW LEVEL SECURITY`
	yield* sql`ALTER TABLE company_industries FORCE ROW LEVEL SECURITY`
	yield* sql`
		CREATE POLICY org_isolation_company_industries ON company_industries
			TO app_user
			USING (organization_id = current_setting('app.current_org_id', true))
			WITH CHECK (organization_id = current_setting('app.current_org_id', true))
	`

	// RESTRICT, not SET NULL: a trade being removed must not quietly blank the
	// trade of every company on it, which is the loss this whole change is about.
	// The service refuses to remove one still in use, and this is the backstop.
	yield* sql`
		ALTER TABLE companies
			ADD COLUMN IF NOT EXISTS industry_id UUID
			REFERENCES company_industries(id) ON DELETE RESTRICT
	`

	// Carry over what is already on file. The most-used spelling of each trade
	// becomes its name, so 107 "Metal fabrication" beat 57 "Metal Fabrication"
	// rather than whichever row happened to sort first. These are values people
	// already live with, so none of them is flagged for review.
	//
	// This is the one place the folding is written in SQL. It is a single move of
	// existing rows, not a rule the application keeps — folding a whole table
	// through TypeScript would mean streaming it — and a test pins this expression
	// against `foldLabel` so the two cannot quietly disagree.
	yield* sql`
		INSERT INTO company_industries (organization_id, label, slug, folded_key, needs_review)
		SELECT organization_id,
			mode() WITHIN GROUP (ORDER BY industry) AS label,
			replace(folded, ' ', '-') AS slug,
			folded,
			false
		FROM (
			SELECT organization_id, industry,
				btrim(regexp_replace(
					lower(regexp_replace(normalize(industry, NFD), '[̀-ͯ·]', '', 'g')),
					'[^[:alnum:]]+', ' ', 'g')) AS folded
			FROM companies
			WHERE industry IS NOT NULL AND btrim(industry) <> '' AND deleted_at IS NULL
		) folded_rows
		WHERE folded <> ''
		GROUP BY organization_id, folded
		ON CONFLICT (organization_id, folded_key) DO NOTHING
	`

	yield* sql`
		UPDATE companies c
		SET industry_id = i.id
		FROM company_industries i
		WHERE i.organization_id = c.organization_id
			AND c.industry_id IS NULL
			AND c.industry IS NOT NULL
			AND i.folded_key = btrim(regexp_replace(
				lower(regexp_replace(normalize(c.industry, NFD), '[̀-ͯ·]', '', 'g')),
				'[^[:alnum:]]+', ' ', 'g'))
	`

	// The stored trade becomes the slug, so a bookmarked ?industry=… keeps working
	// and every existing read of the column keeps its meaning without a join.
	yield* sql`
		UPDATE companies c
		SET industry = i.slug
		FROM company_industries i
		WHERE i.id = c.industry_id AND c.industry IS DISTINCT FROM i.slug
	`

	yield* sql`
		CREATE INDEX IF NOT EXISTS idx_companies_industry
			ON companies (organization_id, industry_id)
			WHERE industry_id IS NOT NULL
	`
})

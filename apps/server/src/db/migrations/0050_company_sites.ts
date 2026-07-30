import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// A company was one place: one address, one pair of coordinates, one pin on the
// map. That describes a single-site business, and stops describing a company the
// moment it has two shops.
//
// It matters most for the rep working a territory. Searching a map rectangle
// reads the company's one coordinate pair, so a chain registered in Barcelona is
// invisible to anyone drawing a box around Tarragona — even with a branch on
// Tarragona's main street. The branch exists, it is just not a thing that can be
// found.
//
// `sites` gives each branch a row of its own: where it is, what it is called, and
// the company it belongs to. A site can hold its own ways of being reached and
// its own people, because both of those already say what they belong to by table
// and id, and `sites` is simply another answer.
//
// The company keeps its own coordinates. For the great majority — one place, one
// pin — that is the whole truth and a site row would be ceremony. A site is what
// you add when there is a second place, so the map has to look at both.
//
// The same rule about where a place may be, and the same index that makes a
// rectangle search cheap, as the companies table has carried since the start —
// copied deliberately rather than left to be noticed later, since a coordinate
// that cannot exist is worth refusing at the door.

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient

	yield* sql`
		CREATE TABLE IF NOT EXISTS sites (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			organization_id TEXT NOT NULL,
			company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
			-- What a person calls this place: "Girona shop", "Tarragona depot".
			name TEXT NOT NULL,
			-- The street address as it would be written on an envelope, and the
			-- town and country separately so a search can narrow without parsing it.
			address TEXT,
			location TEXT,
			country TEXT,
			latitude NUMERIC(9,6),
			longitude NUMERIC(9,6),
			geocoded_at TIMESTAMPTZ,
			geocode_source TEXT,
			-- Which one to show when only one can be: the registered office, the
			-- shop the phone rings at. Exactly one per company is the intent; it is
			-- not enforced, because two while somebody is reorganising is a worse
			-- reason to refuse a write than it is a problem.
			is_primary BOOLEAN NOT NULL DEFAULT false,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			CONSTRAINT sites_latlng_chk CHECK (
				(latitude IS NULL AND longitude IS NULL)
				OR (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)
			)
		)
	`

	yield* sql`CREATE INDEX IF NOT EXISTS sites_company_idx ON sites(company_id)`
	yield* sql`CREATE INDEX IF NOT EXISTS idx_sites_org ON sites(organization_id)`
	// The rectangle search, which is the whole reason these rows exist.
	yield* sql`
		CREATE INDEX IF NOT EXISTS idx_sites_lat_lng ON sites (latitude, longitude)
			WHERE latitude IS NOT NULL AND longitude IS NOT NULL
	`

	yield* sql`GRANT SELECT, INSERT, UPDATE, DELETE ON sites TO app_user, app_service`

	yield* sql`ALTER TABLE sites ENABLE ROW LEVEL SECURITY`
	yield* sql`ALTER TABLE sites FORCE ROW LEVEL SECURITY`
	yield* sql`
		CREATE POLICY org_isolation_sites ON sites
			TO app_user
			USING (organization_id = current_setting('app.current_org_id', true))
			WITH CHECK (organization_id = current_setting('app.current_org_id', true))
	`
})

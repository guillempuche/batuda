import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// Make the database refuse a company value the app would refuse.
//
// The app now checks these on the way in, but rows written before it did are
// still there, and they are not few: production holds 151 of 153 size bands in
// spellings the list does not have ("~20", "21–50" with a dash that is not a
// dash, "150+", "70"), and 24 companies at priority 4 or 5 — written by
// assistants following a tool description that advertised a range twice the real
// one. Statuses drifted the same way, which is why the board has always coerced
// an unknown one rather than trusting it.
//
// So each column is put right before it is constrained. Constraining first would
// abort the whole release, since the migrator runs every file in one transaction.
//
// And the constraint is added for real, not `NOT VALID`. A deferred constraint
// still fires on the next UPDATE, so those 151 companies would become editable by
// nobody — a failure that only appears in production, where the bad rows are.
//
// `country` is deliberately left alone. Two letters is the shape of a country
// code, not a list of the countries that exist, so there is nothing closed to
// check it against.

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient

	// The bands themselves changed shape at the same time: the four narrowest were
	// grouped into two, because telling a sole trader from a five-person workshop
	// rarely changes how either is sold to, and the single open-ended top band
	// became three, because an organisation selling to very large companies cannot
	// work with "five thousand or more" as its last word on the subject.
	//
	// Every new boundary is one the old set also had, so each old band falls
	// entirely inside exactly one new band and no company is moved to a size it
	// was never said to be. The one exception is the old open top: "5001+" said
	// only "at least five thousand", so it lands in the lowest band that can still
	// be true of it, and anything larger is re-read from the page it came from.
	yield* sql`
		UPDATE companies SET size_range = CASE size_range
			WHEN '1-5' THEN '1-10'
			WHEN '6-10' THEN '1-10'
			WHEN '11-25' THEN '11-50'
			WHEN '26-50' THEN '11-50'
			WHEN '5001+' THEN '5001-25000'
			ELSE size_range
		END
		WHERE size_range IN ('1-5','6-10','11-25','26-50','5001+')
	`

	// Then whatever is left that was never a band at all. Production is mostly
	// this: a head-count somebody typed or a run read off a page — "~20", "150+",
	// "21-50", "1.700 empleados". Read the number the way the app reads it, with a
	// thousands separator between digits dropped first so "1.700" is not read as
	// one, and band it. A size with no number in it ("SME", "small") becomes no
	// size rather than a guess at one.
	yield* sql`
		UPDATE companies SET size_range = CASE
			WHEN (regexp_match(regexp_replace(size_range, '(?<=\\d)[.,](?=\\d)', '', 'g'), '\\d+'))[1] IS NULL
				THEN NULL
			WHEN (regexp_match(regexp_replace(size_range, '(?<=\\d)[.,](?=\\d)', '', 'g'), '\\d+'))[1]::bigint <= 10 THEN '1-10'
			WHEN (regexp_match(regexp_replace(size_range, '(?<=\\d)[.,](?=\\d)', '', 'g'), '\\d+'))[1]::bigint <= 50 THEN '11-50'
			WHEN (regexp_match(regexp_replace(size_range, '(?<=\\d)[.,](?=\\d)', '', 'g'), '\\d+'))[1]::bigint <= 200 THEN '51-200'
			WHEN (regexp_match(regexp_replace(size_range, '(?<=\\d)[.,](?=\\d)', '', 'g'), '\\d+'))[1]::bigint <= 500 THEN '201-500'
			WHEN (regexp_match(regexp_replace(size_range, '(?<=\\d)[.,](?=\\d)', '', 'g'), '\\d+'))[1]::bigint <= 1000 THEN '501-1000'
			WHEN (regexp_match(regexp_replace(size_range, '(?<=\\d)[.,](?=\\d)', '', 'g'), '\\d+'))[1]::bigint <= 5000 THEN '1001-5000'
			WHEN (regexp_match(regexp_replace(size_range, '(?<=\\d)[.,](?=\\d)', '', 'g'), '\\d+'))[1]::bigint <= 25000 THEN '5001-25000'
			WHEN (regexp_match(regexp_replace(size_range, '(?<=\\d)[.,](?=\\d)', '', 'g'), '\\d+'))[1]::bigint <= 100000 THEN '25001-100000'
			ELSE '100001+'
		END
		WHERE size_range IS NOT NULL
			AND size_range NOT IN ('1-10','11-50','51-200','201-500','501-1000','1001-5000','5001-25000','25001-100000','100001+')
	`

	// Warmer than the three bands the app shows means nothing, so it becomes the
	// coldest one rather than a value no filter offers.
	yield* sql`UPDATE companies SET priority = 3 WHERE priority IS NOT NULL AND priority > 3`
	yield* sql`UPDATE companies SET priority = 1 WHERE priority IS NOT NULL AND priority < 1`

	// A stage the board has no column for is invisible on it, which is why the
	// board already quietly reads one as "prospect". Doing it here means the row
	// says what the board shows.
	yield* sql`
		UPDATE companies SET status = 'prospect'
		WHERE status NOT IN ('prospect','contacted','responded','meeting','proposal','client','closed','dead')
	`

	yield* sql`
		ALTER TABLE companies ADD CONSTRAINT companies_status_chk
			CHECK (status IN ('prospect','contacted','responded','meeting','proposal','client','closed','dead'))
	`
	yield* sql`
		ALTER TABLE companies ADD CONSTRAINT companies_priority_chk
			CHECK (priority IS NULL OR priority BETWEEN 1 AND 3)
	`
	yield* sql`
		ALTER TABLE companies ADD CONSTRAINT companies_size_range_chk
			CHECK (size_range IS NULL OR size_range IN
				('1-10','11-50','51-200','201-500','501-1000','1001-5000','5001-25000','25001-100000','100001+'))
	`
})

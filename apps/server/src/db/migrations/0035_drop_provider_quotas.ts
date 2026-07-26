import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// These two tables held a per-person allowance of a provider's monthly credits
// and how many of them that person had used. Nothing ever counted against them:
// no code path read or wrote either table, and the piece meant to ask the
// provider how many credits were really left was never written.
//
// They also measured the wrong thing. A provider plan is bought once for the
// whole company and used through a single key, so an allowance held per person
// would let two people each spend the whole month's credits.
//
// What a run really consumed is recorded on the run itself, so the question
// these tables were meant to answer is now asked of data that exists.
//
// expand-contract: pre-production clean break — this same release removes the
// service, its layer, the error it raised and the seed that filled these tables.
// Nothing reads them on the request path, so dropping them in this deploy is
// safe. Dropping each table drops its indexes and policies with it.

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient

	yield* sql`DROP TABLE IF EXISTS provider_usage`
	yield* sql`DROP TABLE IF EXISTS provider_quotas`
})

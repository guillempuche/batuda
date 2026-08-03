import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// Stop keeping a second list of who a product is for.
//
// The column held the trades a product was meant to be sold into. Nothing ever
// read it: no filter, no screen, and the research pipeline never saw it. It was
// written in five places and consumed in none.
//
// The organisation already says who it sells to, in its standing instructions,
// and says it in the form that actually reaches the model — prose it can reason
// with, alongside the pain each offer removes and the price it goes for. A
// structured copy beside that prose is a second answer to one question, kept by
// hand, with nothing checking that the two agree.
//
// The live half of the relationship stays: companies.products_fit holds the
// products that suit a company, which research proposes and the company panel
// shows.
//
// expand-contract: pre-production clean break. This same release removes every
// writer of products.target_industries — the model, both route inputs, the agent
// tool and the seeds — so nothing is left asking for it once this is out.

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient

	yield* sql`ALTER TABLE products DROP COLUMN IF EXISTS target_industries`
})

/**
 * The research runs behind a CRM row.
 *
 * Lives on its own, apart from the apply path that writes these links, because
 * the company service reads it too — and a company that imported the apply path
 * would close an import loop back onto itself through the geocoding it forks.
 */

import type { SqlClient } from 'effect/unstable/sql'

export interface ProvenanceEntry {
	readonly runId: string
	readonly runCompletedAt: Date | null
	readonly sources: ReadonlyArray<{ sourceId: string; url: string }>
}

// Where an applied row's evidence came from: for every research run linked to
// the row, the run's completion date and the URLs of the sources its citations
// point at. Resolves from the run↔row link and the sources table alone, so it
// still works after a run's bulkier transcript is pruned for retention.
export const researchProvenance = (
	sql: SqlClient.SqlClient,
	orgId: string,
	subjectTable: 'companies' | 'contacts',
	subjectId: string,
) =>
	sql<ProvenanceEntry>`
		SELECT
			rl.research_id AS run_id,
			r.completed_at AS run_completed_at,
			COALESCE((
				SELECT json_agg(json_build_object('sourceId', s.id, 'url', s.url))
				FROM jsonb_array_elements(rl.citations) cit
				JOIN sources s ON s.id = cit->>'source_id'
			), '[]'::json) AS sources
		FROM research_links rl
		JOIN research_runs r ON r.id = rl.research_id
		WHERE rl.organization_id = ${orgId}
			AND rl.subject_table = ${subjectTable}
			AND rl.subject_id = ${subjectId}
		ORDER BY r.completed_at DESC NULLS LAST
	`

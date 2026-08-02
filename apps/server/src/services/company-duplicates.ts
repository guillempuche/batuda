/**
 * Spotting that a company being added is one already on file.
 *
 * The only check until now was an exact slug clash, so "acme" and "acme-sl"
 * both landed and the same firm sat in the list twice under two spellings.
 *
 * What makes a shared word evidence is how rare it is *in this organisation*.
 * A freight CRM where forty companies are called "Transports something" learns
 * nothing from the word "transports"; a restaurant CRM where one is, learns a
 * great deal. So the weight of a word is worked out from the organisation's own
 * rows rather than from a list of words somebody decided were generic — no list
 * can be right for both of those CRMs at once.
 *
 * Nothing is blocked. A likely duplicate is reported back with the row that was
 * created, because only the person adding it knows whether two similar names are
 * two branches or one company typed twice.
 */

import { Effect } from 'effect'
import type { SqlClient } from 'effect/unstable/sql'

import { foldLabel } from '@batuda/domain'

type Sql = SqlClient.SqlClient

// Company-form words carry no information about which company this is: every
// Spanish company is an SL or an SA. Dropping them stops "Puig SL" and "Ferré
// SL" reading as a half match.
const LEGAL_SUFFIXES = new Set([
	'sl',
	'slu',
	'sa',
	'sau',
	'scp',
	'sc',
	'sccl',
	'sll',
	'srl',
	'spa',
	'sarl',
	'ltd',
	'limited',
	'plc',
	'llc',
	'inc',
	'corp',
	'co',
	'gmbh',
	'ag',
	'bv',
	'nv',
	'oy',
	'ab',
	'as',
])

/**
 * The words of a name worth comparing: folded so spelling, case and accents stop
 * mattering, with the company-form words dropped.
 */
export const nameTokens = (name: string): ReadonlyArray<string> =>
	foldLabel(name)
		.split(' ')
		.filter(token => token.length > 0 && !LEGAL_SUFFIXES.has(token))

/**
 * How much a word is worth as a name in this organisation. A word used by one
 * company is the whole signal; a word used by as many as `genericAt` is simply
 * how this organisation names things and is worth nothing. Continuous rather than
 * a yes/no flag, so three copies of one company degrade a shared word instead of
 * blinding the check.
 */
export const tokenWeight = (df: number, genericAt: number): number =>
	df <= 1 ? 1 : Math.max(0, 1 - Math.log(df) / Math.log(Math.max(2, genericAt)))

/** Where "used by this many companies" starts meaning "this org names things this way". */
export const genericAtFor = (companyCount: number): number =>
	Math.max(5, Math.ceil(companyCount * 0.01))

/** The bare host of a web address — "acme.co.uk" from "https://www.acme.co.uk/about". */
export const hostOf = (website: string): string | undefined => {
	const host = website
		.trim()
		.toLowerCase()
		.replace(/^[a-z]+:\/\//, '')
		.replace(/^www\./, '')
		.split(/[/?#]/)[0]
	return host?.includes('.') ? host : undefined
}

/**
 * How much of the incoming name the candidate accounts for, between 0 and 1.
 * Measured against the incoming name's own words so that adding a long
 * description to an existing short name still scores high.
 */
export const nameOverlap = (
	incoming: ReadonlyArray<string>,
	candidate: ReadonlyArray<string>,
	weightOf: (token: string) => number,
): number => {
	const total = incoming.reduce((sum, token) => sum + weightOf(token), 0)
	if (total === 0) return 0
	const shared = new Set(candidate)
	const matched = incoming
		.filter(token => shared.has(token))
		.reduce((sum, token) => sum + weightOf(token), 0)
	return matched / total
}

/** A company already on file that the one being added may be another spelling of. */
export interface PossibleDuplicate {
	readonly slug: string
	readonly existing_slug: string
	readonly existing_name: string
	readonly matched_on: 'website' | 'name'
	/** 0–100, how much of the new name the existing one accounts for. */
	readonly confidence: number
}

export interface IncomingCompany {
	readonly slug: string
	readonly name: string
	readonly website?: string | undefined
}

// A name has to be mostly accounted for before it is worth interrupting someone
// over. Set where "Transports Ferré" and "Transports Puig" stay apart once
// `transports` has lost its weight, while "Acme" and "Acme SL" do not.
const REPORT_ABOVE = 0.7

// An organisation with more companies than this has its weights worked out from
// the first slice rather than all of them. Far above any real CRM; it exists so
// one enormous organisation cannot make every create slow.
const SAMPLE_CAP = 5000

interface CandidateRow {
	readonly id: string
	readonly slug: string
	readonly name: string
	readonly website: string | null
}

/**
 * Which of the companies being added look like ones already on file.
 *
 * One query, then all the comparing in TypeScript: the folding that decides two
 * spellings match lives in one place, so there is no second copy in SQL that
 * could drift away from it.
 */
export const findDuplicateCompanies = (
	sql: Sql,
	orgId: string,
	incoming: ReadonlyArray<IncomingCompany>,
) =>
	Effect.gen(function* () {
		if (incoming.length === 0) return [] as ReadonlyArray<PossibleDuplicate>

		const existing = yield* sql<CandidateRow>`
			SELECT c.id, c.slug, c.name,
				(SELECT ch.address FROM channels ch
					WHERE ch.subject_table = 'companies'
						AND ch.subject_id = c.id
						AND ch.channel = 'website'
					ORDER BY ch.is_primary DESC
					LIMIT 1) AS website
			FROM companies c
			WHERE c.organization_id = ${orgId} AND c.deleted_at IS NULL
			LIMIT ${SAMPLE_CAP}
		`
		if (existing.length === 0) return [] as ReadonlyArray<PossibleDuplicate>

		if (existing.length === SAMPLE_CAP) {
			yield* Effect.logInfo('companies.duplicates.sampled').pipe(
				Effect.annotateLogs({ organization_id: orgId, sampled: SAMPLE_CAP }),
			)
		}

		// How many companies use each word, which is what decides the word's worth.
		const documentFrequency = new Map<string, number>()
		const tokensByRow = existing.map(row => {
			const tokens = nameTokens(row.name)
			for (const token of new Set(tokens)) {
				documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1)
			}
			return tokens
		})
		const genericAt = genericAtFor(existing.length)
		const weightOf = (token: string): number =>
			tokenWeight(documentFrequency.get(token) ?? 0, genericAt)

		const hostsByRow = existing.map(row =>
			row.website === null ? undefined : hostOf(row.website),
		)

		const found: Array<PossibleDuplicate> = []
		for (const candidate of incoming) {
			const tokens = nameTokens(candidate.name)
			const host =
				candidate.website === undefined ? undefined : hostOf(candidate.website)
			let best: PossibleDuplicate | undefined
			for (const [index, row] of existing.entries()) {
				// The same web address is the same company, whatever it calls itself.
				const sameHost = host !== undefined && hostsByRow[index] === host
				const overlap = nameOverlap(tokens, tokensByRow[index] ?? [], weightOf)
				if (!sameHost && overlap < REPORT_ABOVE) continue
				const confidence = sameHost ? 100 : Math.round(overlap * 100)
				if (best !== undefined && best.confidence >= confidence) continue
				best = {
					slug: candidate.slug,
					existing_slug: row.slug,
					existing_name: row.name,
					matched_on: sameHost ? 'website' : 'name',
					confidence,
				}
			}
			if (best !== undefined) found.push(best)
		}
		return found as ReadonlyArray<PossibleDuplicate>
	})

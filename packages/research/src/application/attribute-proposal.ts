/**
 * A run that read attribute values for the company it was about hands them to
 * the CRM through a proposed update, like every other change. The model
 * proposes one only when a field on file is wrong or missing, so a run whose
 * only news is the attributes proposed nothing and the values never landed.
 * This adds the proposal the model left out: an update with no fields, on the
 * company on file, that the apply path fills from the attributes it carries.
 *
 * Asked once, on the findings the run finally reports — after the last gap
 * round has folded what it read into them — because an attribute is as often
 * read in a round as in the first pass, and a proposal made before the fold
 * for a value the fold brings in is a proposal the fold never keeps.
 */

import { ATTRIBUTES_FIELD } from './attribute-bag'
import { isPlainObject } from './guard-shapes'

export interface CompanyOnFile {
	readonly id: string
	readonly version: number | null
}

const PROPOSALS_FIELD = 'proposed_updates'

// Why the proposal exists, in the words a reviewer sees beside it.
export const ATTRIBUTE_PROPOSAL_REASON =
	'Attribute values read from the pages, for the company on file.'

const proposesUpdateOf = (proposal: unknown, companyId: string): boolean =>
	isPlainObject(proposal) &&
	proposal['subject_table'] === 'companies' &&
	proposal['subject_id'] === companyId &&
	proposal['operation'] !== 'create'

/**
 * The findings with a proposal for the company on file when they carry
 * attribute values for it and no proposal already names it; unchanged
 * otherwise.
 */
export const withAttributeProposal = (
	findings: unknown,
	company: CompanyOnFile | undefined,
	// The id a person later resolves it by. Given, not made here: the run
	// stamps every other proposal before this step, so this one stamps itself.
	id: string,
): unknown => {
	if (company === undefined || !isPlainObject(findings)) return findings
	const attributes = findings[ATTRIBUTES_FIELD]
	if (!isPlainObject(attributes) || Object.keys(attributes).length === 0)
		return findings
	const held = findings[PROPOSALS_FIELD]
	const proposals: ReadonlyArray<unknown> = Array.isArray(held) ? held : []
	if (proposals.some(proposal => proposesUpdateOf(proposal, company.id)))
		return findings
	return {
		...findings,
		[PROPOSALS_FIELD]: [
			...proposals,
			{
				id,
				status: 'pending',
				subject_table: 'companies',
				operation: 'update',
				subject_id: company.id,
				expected_version: company.version,
				// An object, as every proposal holds once decoded: the apply path
				// reads the findings as stored, after the JSON-string form is gone.
				fields: {},
				reason: ATTRIBUTE_PROPOSAL_REASON,
				citations: [],
			},
		],
	}
}

// The one classification field research still rewrites to a fixed code. A trade
// is no longer among them: each organisation keeps its own list, so the words a
// page uses are stored as written and only the size bands are folded.
//
// Read from the CRM's own list rather than copied. This used to be a copy kept in
// step by a test, which could only ever prove the two were equal — never that
// they were right — and left a window in which a band added to one silently did
// not exist in the other.

import { COMPANY_SIZE_RANGES } from '@batuda/domain'

export const CRM_SIZE_RANGES = COMPANY_SIZE_RANGES
export type CrmSizeRange = (typeof CRM_SIZE_RANGES)[number]

// What a research run is shown of a company or contact it already holds, so it can
// spot a value the evidence contradicts and propose a correction. Deliberately
// narrower than everything stored: the pipeline stage, who owns the lead, when
// it was last contacted, and the pains someone wrote down after a call are the
// sales team's own working notes, not something the research should read back.
// Keys are the camelCase names the row arrives with.
// Every name here must be one the apply path can write; the sync test in apps/server
// (the one place that sees both this and the write allowlist) fails otherwise.
export const SNAPSHOT_COMPANY_FIELDS = [
	'name',
	// Shown so a run that finds the registration number can see we already hold
	// it and say nothing, and so a run that finds a different one can say so.
	// Left out, the number could only ever be written by the first run to find it
	// and never corrected by any run after.
	'taxId',
	'industry',
	'sizeRange',
	'location',
	'currentTools',
	'productsFit',
	'tags',
] as const

export const SNAPSHOT_CONTACT_FIELDS = ['name', 'role', 'buyingRole'] as const

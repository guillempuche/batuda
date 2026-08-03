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

// The CRM's fixed vocabulary for the classification fields research writes back —
// a local mirror of @batuda/domain's Company schema (industry / size_range).
// Kept as a copy so this package keeps its zero-workspace-dependency boundary; a
// sync test in apps/server (which sees both packages) fails if the two ever drift
// apart.

export const CRM_INDUSTRIES = [
	'restaurants',
	'construction',
	'retail',
	'manufacturing',
	'services',
	'hospitality',
	'distribution',
	'transport',
	'other',
] as const
export type CrmIndustry = (typeof CRM_INDUSTRIES)[number]

export const CRM_SIZE_RANGES = [
	'1-5',
	'6-10',
	'11-25',
	'26-50',
	'51-200',
	'201-500',
	'501-1000',
	'1001-5000',
	'5001+',
] as const
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
	'website',
	'email',
	'phone',
	'linkedin',
	'instagram',
	'industry',
	'sizeRange',
	'location',
	'currentTools',
	'productsFit',
	'tags',
] as const

export const SNAPSHOT_CONTACT_FIELDS = [
	'name',
	'role',
	'isDecisionMaker',
] as const

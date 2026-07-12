// The CRM's fixed vocabulary for the classification fields research writes back —
// a local mirror of @batuda/domain's Company schema (industry / size_range).
// Kept as a copy so this package keeps its zero-workspace-dependency boundary; a
// sync test in apps/server (which sees both packages) fails if the two ever drift
// apart.

export const CRM_INDUSTRIES = [
	'restauració',
	'construcció',
	'retail',
	'manufactura',
	'serveis',
	'hostaleria',
	'distribució',
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
] as const
export type CrmSizeRange = (typeof CRM_SIZE_RANGES)[number]

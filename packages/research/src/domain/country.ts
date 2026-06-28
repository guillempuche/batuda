import { Schema } from 'effect'

export const SUPPORTED_COUNTRIES = ['ES', 'GB'] as const

export const Country = Schema.Literals(SUPPORTED_COUNTRIES)
export type Country = (typeof SUPPORTED_COUNTRIES)[number]

export const REGISTRY_VENDORS_BY_COUNTRY = {
	ES: ['stub', 'librebor', 'none'] as const,
	GB: ['stub', 'companies-house', 'none'] as const,
} satisfies Record<Country, ReadonlyArray<string>>

export const REPORT_VENDORS_BY_COUNTRY = {
	ES: ['stub', 'einforma', 'none'] as const,
	GB: ['none'] as const,
} satisfies Record<Country, ReadonlyArray<string>>

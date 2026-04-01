import { ca } from './ca'
import { en } from './en'
import { es } from './es'

export type { Locale } from './ca'

export const locales = { ca, es, en } as const
export type LangCode = keyof typeof locales
export const defaultLang: LangCode = 'ca'
export const langCodes = ['ca', 'es', 'en'] as const

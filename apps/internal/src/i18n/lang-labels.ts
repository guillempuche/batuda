import { LANG_CODES, type LangCode } from '@batuda/domain'

/* Native endonyms so each option is self-describing regardless of which
 * language is currently active — `Català` reads as Catalan whether the
 * surrounding UI is English or Catalan. Deliberately not translated. */
export const LANG_LABELS: Record<LangCode, string> = {
	en: 'English',
	ca: 'Català',
}

/* Shared by the profile switcher and the add-member form so adding a language
 * to the domain list surfaces it in both without touching either screen. */
export const langSelectItems = LANG_CODES.map(code => ({
	value: code,
	label: LANG_LABELS[code],
}))

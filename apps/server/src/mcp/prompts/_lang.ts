import { Schema } from 'effect'

// The languages the synthesis prompts write in.
export const LANGS = ['ca', 'es', 'en'] as const

export const LangParam = Schema.optional(Schema.Literals(LANGS))

export const langDirective = (lang?: 'ca' | 'es' | 'en') => {
	const l = lang ?? 'en'
	const directives = {
		ca: 'Respon en català.',
		es: 'Responde en español.',
		en: 'Respond in English.',
	} as const
	return directives[l]
}

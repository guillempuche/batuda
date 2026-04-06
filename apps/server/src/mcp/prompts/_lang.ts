import { Schema } from 'effect'

export const LangParam = Schema.optional(Schema.Literals(['ca', 'es', 'en']))

export const langDirective = (lang?: 'ca' | 'es' | 'en') => {
	const l = lang ?? 'en'
	const directives = {
		ca: 'Respon en català.',
		es: 'Responde en español.',
		en: 'Respond in English.',
	} as const
	return directives[l]
}

import {
	sanitizeHtmlToBlocks,
	sanitizeTextToBlocks,
} from '@batuda/email/sanitize'
import type { EmailBlock, EmailBlocks } from '@batuda/email/schema'

// Caller supplies the translated attribution templates so Lingui stays
// at the component boundary. {date} and {who} are literal placeholders.
export interface AttributionTemplates {
	readonly withDate: string
	readonly withoutDate: string
	readonly fallbackSender: string
}

export interface ParentToQuoteInput {
	readonly html?: string | undefined
	readonly text?: string | undefined
	readonly fromName?: string | null | undefined
	readonly fromEmail?: string | null | undefined
	readonly receivedAt?: Date | null | undefined
	readonly locale?: string | undefined
	readonly attribution: AttributionTemplates
}

export const parentToQuoteBlock = (input: ParentToQuoteInput): EmailBlocks => {
	const attribution = buildAttribution(input)
	const innerBlocks = parentBody(input)
	const quote: EmailBlock = { type: 'quote', children: innerBlocks }
	const emptyParagraph: EmailBlock = { type: 'paragraph', spans: [] }
	return [emptyParagraph, attribution, quote]
}

const parentBody = (input: ParentToQuoteInput): ReadonlyArray<EmailBlock> => {
	if (input.html && input.html.trim().length > 0) {
		return sanitizeHtmlToBlocks(input.html, { client: true })
	}
	if (input.text && input.text.length > 0) {
		return sanitizeTextToBlocks(input.text)
	}
	return []
}

const buildAttribution = (input: ParentToQuoteInput): EmailBlock => {
	const who = pickSenderLabel(input)
	const datePart = input.receivedAt
		? formatDate(input.receivedAt, input.locale)
		: null
	const template = datePart
		? input.attribution.withDate
		: input.attribution.withoutDate
	const text = fillTemplate(template, { who, date: datePart ?? '' })
	return {
		type: 'paragraph',
		spans: [{ kind: 'text', value: text, italic: true }],
	}
}

const pickSenderLabel = (input: ParentToQuoteInput): string => {
	const name =
		typeof input.fromName === 'string' && input.fromName.trim().length > 0
			? input.fromName.trim()
			: null
	if (name) return name
	const email =
		typeof input.fromEmail === 'string' && input.fromEmail.trim().length > 0
			? input.fromEmail.trim()
			: null
	if (email) return email
	return input.attribution.fallbackSender
}

const formatDate = (d: Date, locale: string | undefined): string => {
	try {
		return new Intl.DateTimeFormat(locale, {
			dateStyle: 'long',
			timeStyle: 'short',
		}).format(d)
	} catch {
		return d.toISOString()
	}
}

const fillTemplate = (
	template: string,
	vars: Readonly<Record<string, string>>,
): string =>
	template.replace(/\{(\w+)\}/g, (_m, key: string) => vars[key] ?? '')

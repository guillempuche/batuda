import { createServerFn } from '@tanstack/react-start'
import { Schema } from 'effect'

import { TiptapDocument } from '@engranatge/ui/blocks'

const SERVER_URL =
	import.meta.env['VITE_SERVER_URL'] ?? 'https://api.engranatge.localhost'

const PublicPage = Schema.Struct({
	id: Schema.String,
	slug: Schema.String,
	lang: Schema.String,
	title: Schema.String,
	template: Schema.NullOr(Schema.String),
	content: TiptapDocument,
	meta: Schema.NullOr(
		Schema.Struct({
			ogTitle: Schema.optional(Schema.String),
			ogDescription: Schema.optional(Schema.String),
			ogImage: Schema.optional(Schema.String),
		}),
	),
	publishedAt: Schema.NullOr(Schema.String),
})
export type PublicPage = Schema.Schema.Type<typeof PublicPage>

const decodePage = Schema.decodeUnknownSync(PublicPage)

export const fetchPublicPage = createServerFn({ method: 'GET' })
	.inputValidator((input: { slug: string; lang: string }) => input)
	.handler(async ({ data }) => {
		const url = new URL(`/pages/${encodeURIComponent(data.slug)}`, SERVER_URL)
		url.searchParams.set('lang', data.lang)
		const res = await fetch(url, { headers: { accept: 'application/json' } })
		if (res.status === 404) return null
		if (!res.ok) throw new Error(`fetchPublicPage failed: ${res.status}`)
		const json = await res.json()
		return decodePage(json)
	})

export const recordPageView = createServerFn({ method: 'POST' })
	.inputValidator((input: { slug: string; lang: string }) => input)
	.handler(async ({ data }) => {
		const url = new URL(
			`/pages/${encodeURIComponent(data.slug)}/view`,
			SERVER_URL,
		)
		url.searchParams.set('lang', data.lang)
		await fetch(url, { method: 'POST' }).catch(() => {
			/* fire-and-forget; never block render */
		})
	})

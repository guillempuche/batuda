import { createFileRoute, notFound } from '@tanstack/react-router'
import { useEffect } from 'react'
import styled from 'styled-components'

import { PageRenderer } from '#/components/blocks/renderer'
import { Section } from '#/components/layout/section'
import { isLangCode, type LangCode, locales } from '#/i18n'
import { useTranslations } from '#/i18n/lang-provider'
import {
	buildPublicPath,
	getAlternates,
	type PageId,
	resolveCanonicalSlug,
} from '#/i18n/slugs'
import {
	fetchPublicPage,
	type PublicPage,
	recordPageView,
} from '#/lib/pages-api'

type StaticLoader = { kind: 'static'; pageId: PageId }
type ProspectLoader = { kind: 'prospect'; page: PublicPage; slug: string }
type LoaderData = StaticLoader | ProspectLoader

export const Route = createFileRoute('/$lang/$')({
	loader: async ({ params }): Promise<LoaderData> => {
		const raw = params._splat ?? ''
		const pageId = resolveCanonicalSlug(raw)
		if (pageId) return { kind: 'static', pageId }
		const lang = isLangCode(params.lang) ? params.lang : 'en'
		const page = await fetchPublicPage({ data: { slug: raw, lang } })
		if (!page) throw notFound()
		return { kind: 'prospect', page, slug: raw }
	},
	component: SlugPage,
	head: ({ params, loaderData }) => {
		if (!loaderData) return {}
		const lang: LangCode = isLangCode(params.lang) ? params.lang : 'en'
		if (loaderData.kind === 'static') {
			const t = locales[lang]
			const pm = t.pageMeta[loaderData.pageId]
			const alternates = getAlternates(loaderData.pageId)
			const canonical = buildPublicPath(loaderData.pageId, lang)
			return {
				meta: [
					{ title: pm.title },
					{ name: 'description', content: pm.description },
					{ property: 'og:url', content: canonical },
					{ property: 'og:locale', content: lang },
				],
				links: [
					{ rel: 'canonical', href: canonical },
					...alternates.map(a => ({
						rel: 'alternate',
						hrefLang: a.hrefLang,
						href: a.href,
					})),
					{
						rel: 'alternate',
						hrefLang: 'x-default',
						href: buildPublicPath(loaderData.pageId, 'en'),
					},
				],
			}
		}
		const { page, slug } = loaderData
		const canonical = `/${lang}/${slug}`
		const meta = page.meta ?? {}
		return {
			meta: [
				{ title: page.title },
				...(meta.ogDescription
					? [{ name: 'description', content: meta.ogDescription }]
					: []),
				{ name: 'robots', content: 'noindex, nofollow' },
				{ property: 'og:title', content: meta.ogTitle ?? page.title },
				...(meta.ogDescription
					? [{ property: 'og:description', content: meta.ogDescription }]
					: []),
				...(meta.ogImage
					? [{ property: 'og:image', content: meta.ogImage }]
					: []),
				{ property: 'og:url', content: canonical },
				{ property: 'og:locale', content: lang },
			],
			links: [{ rel: 'canonical', href: canonical }],
		}
	},
})

const PlaceholderTitle = styled.h1`
	font-family: var(--font-display);
	font-size: var(--typescale-display-medium-size);
	line-height: var(--typescale-display-medium-line);
	color: var(--color-on-surface);
	margin-bottom: var(--space-md);
`

const PlaceholderBody = styled.p`
	font-size: var(--typescale-body-large-size);
	color: var(--color-on-surface-variant);
`

function humanise(pageId: PageId): string {
	return pageId
		.split('-')
		.map(w => w.charAt(0).toUpperCase() + w.slice(1))
		.join(' ')
}

function StaticPage({ pageId }: { pageId: PageId }) {
	const t = useTranslations()
	return (
		<Section title={humanise(pageId)}>
			<PlaceholderTitle>{humanise(pageId)}</PlaceholderTitle>
			<PlaceholderBody>{t.meta.description}</PlaceholderBody>
		</Section>
	)
}

function ProspectPage({ page, lang }: { page: PublicPage; lang: LangCode }) {
	useEffect(() => {
		recordPageView({ data: { slug: page.slug, lang } })
	}, [page.slug, lang])
	return <PageRenderer doc={page.content} />
}

function SlugPage() {
	const loaderData = Route.useLoaderData()
	const params = Route.useParams()
	const lang: LangCode = isLangCode(params.lang) ? params.lang : 'en'
	if (loaderData.kind === 'static')
		return <StaticPage pageId={loaderData.pageId} />
	return <ProspectPage page={loaderData.page} lang={lang} />
}

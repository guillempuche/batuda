import { createFileRoute, notFound } from '@tanstack/react-router'
import styled from 'styled-components'

import { Section } from '#/components/layout/section'
import { isLangCode, type LangCode, locales } from '#/i18n'
import { useTranslations } from '#/i18n/lang-provider'
import {
	buildPublicPath,
	getAlternates,
	type PageId,
	resolveCanonicalSlug,
} from '#/i18n/slugs'

export const Route = createFileRoute('/$lang/$')({
	loader: ({ params }) => {
		const pageId = resolveCanonicalSlug(params._splat ?? '')
		if (!pageId) throw notFound()
		return { pageId }
	},
	component: SlugPage,
	head: ({ params, loaderData }) => {
		if (!loaderData) return {}
		const lang: LangCode = isLangCode(params.lang) ? params.lang : 'en'
		const { pageId } = loaderData
		const t = locales[lang]
		const alternates = getAlternates(pageId)
		const canonical = buildPublicPath(pageId, lang)
		/* Placeholder pages are not yet written; keep them out of the index
		 * until their real copy lands so they don't compete with the built
		 * pages for rankings. */
		return {
			meta: [
				{ title: t.meta.title },
				{ name: 'description', content: t.meta.description },
				{ name: 'robots', content: 'noindex, nofollow' },
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
					href: buildPublicPath(pageId, 'en'),
				},
			],
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

/* Humanises an enum-style identifier like 'dept-finance' into a display
 * label ('Dept Finance') for placeholder rendering until each page has
 * written copy in the locale files. */
function humanise(pageId: PageId): string {
	return pageId
		.split('-')
		.map(w => w.charAt(0).toUpperCase() + w.slice(1))
		.join(' ')
}

function SlugPage() {
	const { pageId } = Route.useLoaderData()
	const t = useTranslations()
	return (
		<Section title={humanise(pageId)}>
			<PlaceholderTitle>{humanise(pageId)}</PlaceholderTitle>
			<PlaceholderBody>{t.meta.description}</PlaceholderBody>
		</Section>
	)
}

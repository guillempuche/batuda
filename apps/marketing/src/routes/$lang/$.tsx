import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import { Trans } from '@lingui/react/macro'
import { createFileRoute, notFound } from '@tanstack/react-router'
import { useEffect } from 'react'
import styled from 'styled-components'

import { PageRenderer } from '#/components/blocks/renderer'
import { Section } from '#/components/layout/section'
import { isLangCode, type LangCode } from '#/i18n'
import { makeI18n } from '#/i18n/lingui'
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

type StaticLoader = {
	kind: 'static'
	pageId: PageId
	title: string
	description: string
}
type ProspectLoader = { kind: 'prospect'; page: PublicPage; slug: string }
type LoaderData = StaticLoader | ProspectLoader

/* Per-page title/description for static routes (the 16 hand-authored pages
 * registered in `#/i18n/slugs`). Wrapped in `msg` so extract pulls msgids
 * into the Lingui catalogs and translators fill `ca`/`es` msgstrs without
 * having to touch the source. Prospect pages carry their own
 * already-localized metadata from the DB. */
const PAGE_META: Record<
	PageId,
	{ title: MessageDescriptor; description: MessageDescriptor }
> = {
	home: {
		title: msg`Engranatge — Machines do the work`,
		description: msg`We build automations, AI and micro-apps so your business runs itself.`,
	},
	automations: {
		title: msg`Automations — Engranatge`,
		description: msg`We connect your systems so repetitive work does itself.`,
	},
	'ai-agents': {
		title: msg`AI Agents — Engranatge`,
		description: msg`Intelligent agents that work 24/7 for your business.`,
	},
	about: {
		title: msg`The Workshop — Engranatge`,
		description: msg`Who I am and why I build tools that work on their own.`,
	},
	'discovery-call': {
		title: msg`Let's talk — Engranatge`,
		description: msg`Tell me about your case and we will see how I can help.`,
	},
	'dept-finance': {
		title: msg`Finance — Engranatge`,
		description: msg`Automations for finance departments.`,
	},
	'dept-operations': {
		title: msg`Operations — Engranatge`,
		description: msg`Tools to optimise day-to-day operations.`,
	},
	'dept-sales': {
		title: msg`Sales — Engranatge`,
		description: msg`Automations to accelerate your sales cycle.`,
	},
	'dept-admin': {
		title: msg`Administration — Engranatge`,
		description: msg`Tools for paperwork-free admin management.`,
	},
	'dept-customer-service': {
		title: msg`Customer Service — Engranatge`,
		description: msg`Respond faster with less effort.`,
	},
	'dept-procurement': {
		title: msg`Procurement — Engranatge`,
		description: msg`Automate purchase orders and supplier tracking.`,
	},
	'dept-hr': {
		title: msg`HR — Engranatge`,
		description: msg`Tools for HR: onboarding, payroll, time tracking.`,
	},
	'dept-legal': {
		title: msg`Legal — Engranatge`,
		description: msg`Automate contract review and compliance tracking.`,
	},
	'dept-marketing': {
		title: msg`Marketing — Engranatge`,
		description: msg`Automations for campaigns, content and analytics.`,
	},
	'dept-management': {
		title: msg`Management — Engranatge`,
		description: msg`Dashboards and alerts so nothing slips through.`,
	},
	'cases-index': {
		title: msg`Cases — Engranatge`,
		description: msg`Real examples of automations in production.`,
	},
}

export const Route = createFileRoute('/$lang/$')({
	loader: async ({ params }): Promise<LoaderData> => {
		const raw = params._splat ?? ''
		const lang: LangCode = isLangCode(params.lang) ? params.lang : 'en'
		const pageId = resolveCanonicalSlug(raw)
		if (pageId) {
			const i18n = makeI18n(lang)
			const meta = PAGE_META[pageId]
			return {
				kind: 'static',
				pageId,
				title: i18n._(meta.title),
				description: i18n._(meta.description),
			}
		}
		const page = await fetchPublicPage({ data: { slug: raw, lang } })
		if (!page) throw notFound()
		return { kind: 'prospect', page, slug: raw }
	},
	component: SlugPage,
	head: ({ params, loaderData }) => {
		if (!loaderData) return {}
		const lang: LangCode = isLangCode(params.lang) ? params.lang : 'en'
		if (loaderData.kind === 'static') {
			const { pageId, title, description } = loaderData
			const alternates = getAlternates(pageId)
			const canonical = buildPublicPath(pageId, lang)
			return {
				meta: [
					{ title },
					{ name: 'description', content: description },
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
	return (
		<Section title={humanise(pageId)}>
			<PlaceholderTitle>{humanise(pageId)}</PlaceholderTitle>
			<PlaceholderBody>
				<Trans>
					We build automations, AI and micro-apps so your business runs itself.
				</Trans>
			</PlaceholderBody>
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

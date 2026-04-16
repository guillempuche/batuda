import { createFileRoute } from '@tanstack/react-router'

import { buildPublicPath, getAlternates, type PageId } from '#/i18n/slugs'

const PUBLIC_URL =
	import.meta.env['VITE_PUBLIC_URL'] ?? 'https://engranatge.com'

const PAGE_IDS: ReadonlyArray<PageId> = [
	'home',
	'automations',
	'ai-agents',
	'about',
	'discovery-call',
	'dept-finance',
	'dept-operations',
	'dept-sales',
	'dept-admin',
	'dept-customer-service',
	'dept-procurement',
	'dept-hr',
	'dept-legal',
	'dept-marketing',
	'dept-management',
	'cases-index',
]

export const Route = createFileRoute('/sitemap.xml')({
	server: {
		handlers: {
			GET: async () => {
				const urls: string[] = []
				for (const pageId of PAGE_IDS) {
					const canonical = `${PUBLIC_URL}${buildPublicPath(pageId, 'en')}`
					const alternates = getAlternates(pageId)
					const xhtmlLinks = [
						...alternates.map(
							a =>
								`      <xhtml:link rel="alternate" hreflang="${a.hrefLang}" href="${PUBLIC_URL}${a.href}" />`,
						),
						`      <xhtml:link rel="alternate" hreflang="x-default" href="${PUBLIC_URL}${buildPublicPath(pageId, 'en')}" />`,
					].join('\n')

					urls.push(
						`  <url>\n    <loc>${canonical}</loc>\n${xhtmlLinks}\n  </url>`,
					)
				}

				const xml = [
					'<?xml version="1.0" encoding="UTF-8"?>',
					'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
					...urls,
					'</urlset>',
				].join('\n')

				return new Response(xml, {
					headers: {
						'content-type': 'application/xml; charset=utf-8',
						'cache-control': 'public, max-age=3600',
					},
				})
			},
		},
	},
})

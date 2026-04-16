import {
	createRootRoute,
	HeadContent,
	Outlet,
	Scripts,
	useRouterState,
} from '@tanstack/react-router'

import { defaultLang, htmlLang, isLangCode } from '#/i18n'
import appCss from '../styles.css?url'

/* Root `head()` runs for routes that don't match under `$lang/*` (the bare
 * `/` redirect, `/sitemap.xml`, error boundaries). Child routes always
 * override title + description, so these defaults are only visible in edge
 * cases — hardcoded English is fine, and the same strings already exist in
 * ca/es catalogs through the matching macros in `$lang/index.tsx`. */
export const Route = createRootRoute({
	head: () => ({
		meta: [
			{ charSet: 'utf-8' },
			{ name: 'viewport', content: 'width=device-width, initial-scale=1' },
			{ title: 'Engranatge — Machines do the work' },
			{
				name: 'description',
				content:
					'We build automations, AI and micro-apps so your business runs itself.',
			},
		],
		links: [
			{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
			{
				rel: 'icon',
				type: 'image/png',
				sizes: '32x32',
				href: '/favicon-32x32.png',
			},
			{
				rel: 'icon',
				type: 'image/png',
				sizes: '16x16',
				href: '/favicon-16x16.png',
			},
			{
				rel: 'apple-touch-icon',
				sizes: '180x180',
				href: '/apple-touch-icon.png',
			},
			{ rel: 'stylesheet', href: appCss },
			{
				rel: 'preconnect',
				href: 'https://fonts.googleapis.com',
			},
			{
				rel: 'preconnect',
				href: 'https://fonts.gstatic.com',
				crossOrigin: 'anonymous',
			},
			{
				rel: 'stylesheet',
				href: 'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;500;700&family=Barlow:wght@400;500&display=swap',
			},
		],
	}),
	component: RootComponent,
})

function RootComponent() {
	return (
		<RootDocument>
			<Outlet />
		</RootDocument>
	)
}

function RootDocument({ children }: { children: React.ReactNode }) {
	/* The URL owns the language, so `<html lang>` is derived from the path's
	 * first segment. Reading this from router state keeps the SSR attribute
	 * consistent with what `$lang/route.tsx` validates for the rest of the
	 * tree, without relying on child route params (which aren't accessible
	 * from the root above the match). */
	const pathname = useRouterState({ select: s => s.location.pathname })
	const firstSeg = pathname.split('/').filter(Boolean)[0]
	const lang = isLangCode(firstSeg) ? htmlLang[firstSeg] : htmlLang[defaultLang]
	return (
		<html lang={lang}>
			<head>
				<HeadContent />
			</head>
			<body>
				{children}
				<Scripts />
			</body>
		</html>
	)
}

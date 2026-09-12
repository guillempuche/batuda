import { HydrationBoundary, RegistryProvider } from '@effect/atom-react'
import { useLingui } from '@lingui/react/macro'
import {
	createRootRoute,
	HeadContent,
	Outlet,
	ScriptOnce,
	Scripts,
	useMatches,
} from '@tanstack/react-router'
import { useMemo, useState } from 'react'

import { PriToast } from '@batuda/ui/pri'

import barlowCondensedMedium from '#/fonts/barlow/barlow-condensed-latin-500-normal.woff2?url'
import barlowCondensedBold from '#/fonts/barlow/barlow-condensed-latin-700-normal.woff2?url'
import barlowRegular from '#/fonts/barlow/barlow-latin-400-normal.woff2?url'
import barlowMedium from '#/fonts/barlow/barlow-latin-500-normal.woff2?url'
import barlowBold from '#/fonts/barlow/barlow-latin-700-normal.woff2?url'
import { readLangCookieFromHeader } from '#/i18n/cookie'
import { defaultLang, htmlLang, type LangCode } from '#/i18n/index'
import { LangProvider } from '#/i18n/lang-provider'
import { translatedHead } from '#/i18n/lingui'
import type { DehydratedAtomValue } from '#/lib/atom-hydration'
import { ServerIdentityProvider } from '#/lib/identity'
import { getServerCookieHeader } from '#/lib/server-cookie'
import { fetchServerOrganizations } from '#/lib/server-identity'
import { fetchSession, hasSessionCookie } from '#/lib/session-check'
import { readThemeCookieFromHeader } from '#/theme/cookie'
import {
	defaultTheme,
	defaultThemePreference,
	type ThemeCode,
	type ThemePreference,
} from '#/theme/index'
import { ThemeProvider } from '#/theme/theme-provider'
import appCss from '../styles.css?url'

/**
 * Serializable dehydrated-atom shape emitted by route loaders. Each
 * loader may return `{ dehydrated: [dehydrateAtom(atom, value), ...] }`
 * — plain JSON with a string key + encoded value. The root component
 * collects every matched route's array and feeds it to
 * `<HydrationBoundary>` from `@effect/atom-react`, which pre-loads the
 * registry by key so `useAtomValue` returns `Success` on first render
 * instead of `Initial`. See `#/lib/atom-hydration.ts` for the encoding
 * helper and the rationale for not returning atom instances directly.
 */
export type { DehydratedAtomValue }

/**
 * The faces every page paints with above the fold, fetched alongside the
 * stylesheet. `@font-face` declares them `optional`, so a face that has not
 * arrived by first paint sits out the rest of the visit — preloading is what
 * decides whether the brand fonts show at all. Font requests are anonymous,
 * so `crossOrigin` has to say so here too or each face is fetched twice.
 */
const fontPreloadLinks = [
	barlowRegular,
	barlowMedium,
	barlowBold,
	barlowCondensedMedium,
	barlowCondensedBold,
].map(href => ({
	rel: 'preload' as const,
	as: 'font' as const,
	type: 'font/woff2',
	href,
	crossOrigin: 'anonymous' as const,
}))

/**
 * Session check for the whole app. Runs on SSR (initial HTML render) and on
 * client navigations, and hands the answer down as `signedIn` in the route
 * context. The `_authed` layout route and the OAuth consent screen turn a
 * "no" into a redirect to `/login` carrying the page that was asked for.
 *
 * Public sign-up is disabled on the server (see
 * `docs/backend.md#invite-only-signup`), so the only way into the app
 * is a pre-provisioned account — that redirect is what keeps the rest of
 * the routes unreachable to anonymous visitors.
 */
export const Route = createRootRoute({
	beforeLoad: async () => {
		let cookieHeader: string | null | undefined
		if (import.meta.env.SSR) {
			cookieHeader = await getServerCookieHeader()
		} else if (typeof document !== 'undefined') {
			cookieHeader = document.cookie
		}
		// An explicit choice from the language switcher, if one was ever made.
		// It outranks the account's language: someone who switches is telling us
		// what they want right now.
		const chosenLang = readLangCookieFromHeader(cookieHeader)

		// The appearance is cookie-only — it belongs to the device, not the
		// account, so a dark-at-night laptop does not follow you to a bright
		// office machine. Resolved before the sign-in branch so the sign-in
		// pages are themed too.
		const themePreference: ThemePreference =
			readThemeCookieFromHeader(cookieHeader) ?? defaultThemePreference
		/* The server cannot know what the operating system wants, so a
		 * "system" preference renders light and the script below corrects it
		 * before anything is painted. */
		const theme: ThemeCode =
			themePreference === 'system' ? defaultTheme : themePreference

		// A visit without a session cookie cannot be signed in, so the sign-in
		// pages skip the round trip to the API. The browser hides that cookie
		// from scripts, so only the server can make that call; a client
		// navigation always asks.
		const user =
			import.meta.env.SSR && !hasSessionCookie(cookieHeader)
				? null
				: await fetchSession(cookieHeader ?? undefined)
		// Falls back to the account's language so someone an admin just added
		// lands in their own language on the very first page, before they have
		// touched any setting. Route context is serialized across SSR, so what
		// crosses is the plain language code, a yes/no, and the person's id,
		// name and email — never the session itself. The routes that need a
		// signed-in person read `signedIn` in their own `beforeLoad`; the sign-in
		// pages are reachable either way.
		return {
			lang: chosenLang ?? user?.locale ?? defaultLang,
			themePreference,
			theme,
			signedIn: user !== null,
			person:
				user === null
					? null
					: { id: user.id, email: user.email, name: user.name },
		}
	},
	// On the server, the organisation the person is in is read here rather than
	// in `beforeLoad`, so the pages' own loaders run alongside it instead of
	// waiting for it. The browser's store takes over once it has asked for the
	// same; a page the browser renders for itself gets no handover.
	loader: async ({ context }) => {
		const identity =
			import.meta.env.SSR && context.person !== null
				? {
						person: context.person,
						...(await fetchServerOrganizations(
							(await getServerCookieHeader()) ?? '',
						)),
					}
				: undefined
		return {
			lang: context.lang,
			themePreference: context.themePreference,
			theme: context.theme,
			identity,
		}
	},
	head: ({ loaderData }) => {
		const lang: LangCode = loaderData?.lang ?? defaultLang
		const { title, description } = translatedHead[lang]
		/* Tints the browser chrome on mobile, and the one place a colour is
		 * written outside the stylesheet: the server has to name it before any
		 * CSS is parsed. Each value is the theme's own --color-surface, and the
		 * contrast check fails the build if they stop matching. Once the page is
		 * live the provider re-reads the real value, so this only has to be
		 * right for the first paint. */
		const themeColor =
			loaderData?.theme === 'dark-hc'
				? '#0a0908'
				: loaderData?.theme === 'dark'
					? '#17140f'
					: '#f5f0e8'
		return {
			meta: [
				{ charSet: 'utf-8' },
				{ name: 'viewport', content: 'width=device-width, initial-scale=1' },
				{ name: 'theme-color', content: themeColor },
				{ title },
				{
					name: 'description',
					content: description,
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
				...fontPreloadLinks,
			],
		}
	},
	component: RootComponent,
})

function RootComponent() {
	// Collect the page-load data snapshots from every matched route's loader
	// data. Routes without loaders (or without a `dehydrated` field) contribute
	// nothing. Order matches the route hierarchy top-down.
	const matches = useMatches()
	const loaderData = Route.useLoaderData()
	const { lang, themePreference, theme } = loaderData
	// The server's answer arrives with the first page and is kept for the
	// visit: a later navigation is rendered by the browser, whose store is live
	// by then, and the handover only ever stands in until that store answers.
	const [identity] = useState(loaderData.identity)
	const collected = matches.flatMap(m => {
		const data = m.loaderData as
			| { dehydrated?: ReadonlyArray<DehydratedAtomValue> }
			| undefined
		return data?.dehydrated ?? []
	})
	// A snapshot is where a screen starts, not what it currently holds. Handing
	// the same one over again on a later render puts the page back to how it
	// looked on load — a change the reader had already approved would reappear
	// waiting for them, and re-approving it fails as a duplicate. So the list is
	// held to one identity per set of snapshots, and only a loader that actually
	// ran again (which stamps a new time) produces a new one worth applying.
	// Deliberately keyed on the snapshots themselves rather than the matches:
	// opening a dialog changes the matches without changing the data.
	const signature = collected.map(d => `${d.key}@${d.dehydratedAt}`).join('|')
	// biome-ignore lint/correctness/useExhaustiveDependencies: the signature is the identity of `collected`; depending on the array itself would defeat the point.
	const dehydrated = useMemo(() => collected, [signature])

	// Only what every page needs sits here. The signed-in chrome (sidebar, top
	// bar, Quick Capture, compose dock) is the `_authed` layout route's, so the
	// sign-in pages never download it.
	return (
		<RootDocument lang={lang} theme={theme} preference={themePreference}>
			<ThemeProvider initialPreference={themePreference} initialTheme={theme}>
				<LangProvider initialLang={lang}>
					<RegistryProvider>
						<HydrationBoundary state={dehydrated}>
							<ServerIdentityProvider value={identity}>
								<PriToast.Provider>
									<Outlet />
									<ToastChrome />
								</PriToast.Provider>
							</ServerIdentityProvider>
						</HydrationBoundary>
					</RegistryProvider>
				</LangProvider>
			</ThemeProvider>
		</RootDocument>
	)
}

/* Runs while the browser is still parsing the page, before anything is drawn.
 * Only needed when the stored choice is "follow the system": the server has no
 * way to know what the system wants, so it renders the light theme and this
 * corrects the attribute in place. Without it, every such visit would flash
 * light before settling. It re-tints the browser chrome from the stylesheet at
 * the same time, so the address bar does not stay light on a dark page. */
const followSystemScript = `(function(){try{
if(!(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches))return
var r=document.documentElement
r.setAttribute('data-theme','dark')
var m=document.querySelector('meta[name="theme-color"]')
var s=getComputedStyle(r).getPropertyValue('--color-surface').trim()
if(m&&s)m.setAttribute('content',s)
}catch(e){}})()`

// The raised toasts, and the two labels Base UI would otherwise write in English
// on its own. It is a component rather than markup inline above because the
// translations only exist inside the language provider, which the root renders
// below itself — reading them any higher gets a hook with no provider.
function ToastChrome() {
	const { t } = useLingui()
	return (
		<PriToast.Viewport aria-label={t`Notifications`}>
			<PriToast.List closeLabel={t`Close`} />
		</PriToast.Viewport>
	)
}

function RootDocument({
	lang,
	theme,
	preference,
	children,
}: {
	lang: LangCode
	theme: ThemeCode
	preference: ThemePreference
	children: React.ReactNode
}) {
	return (
		/* The script above may change this attribute before React hydrates, which
		 * React would otherwise report as a mismatch. */
		<html lang={htmlLang[lang]} data-theme={theme} suppressHydrationWarning>
			<head>
				<HeadContent />
				{preference === 'system' ? (
					<ScriptOnce>{followSystemScript}</ScriptOnce>
				) : null}
			</head>
			<body>
				{children}
				<Scripts />
			</body>
		</html>
	)
}

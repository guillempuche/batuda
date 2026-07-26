import { HydrationBoundary, RegistryProvider } from '@effect/atom-react'
import {
	createRootRoute,
	HeadContent,
	Outlet,
	redirect,
	ScriptOnce,
	Scripts,
	useLocation,
	useMatches,
} from '@tanstack/react-router'
import { LayoutGroup } from 'motion/react'
import { useEffect, useMemo } from 'react'

import { PriToast } from '@batuda/ui/pri'

import { ComposeDock } from '#/components/emails/compose-dock'
import { QuickCaptureDialog } from '#/components/interactions/quick-capture-dialog'
import { AppShell } from '#/components/layout/app-shell'
import { BatudaMotionConfig } from '#/components/layout/motion-config'
import { ComposeEmailProvider } from '#/context/compose-email-context'
import { QuickCaptureProvider } from '#/context/quick-capture-context'
import { readLangCookieFromHeader } from '#/i18n/cookie'
import { defaultLang, htmlLang, type LangCode } from '#/i18n/index'
import { LangProvider } from '#/i18n/lang-provider'
import { translatedHead } from '#/i18n/lingui'
import type { DehydratedAtomValue } from '#/lib/atom-hydration'
import { getServerCookieHeader } from '#/lib/server-cookie'
import { fetchSession } from '#/lib/session-check'
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
 * Session gate for the whole app. Runs on SSR (initial HTML render)
 * and on client navigations. If there's no session and the user isn't
 * already on `/login`, throw a redirect carrying the full current URL
 * as `returnTo` so the login page can send them back after signing in.
 *
 * Public sign-up is disabled on the server (see
 * `docs/backend.md#invite-only-signup`), so the only way into the app
 * is a pre-provisioned account — this gate is what keeps the rest of
 * the routes unreachable to anonymous visitors.
 */
export const Route = createRootRoute({
	beforeLoad: async ({ location }) => {
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

		const isPublicPath =
			location.pathname === '/login' ||
			location.pathname === '/forgot-password' ||
			location.pathname === '/reset-password'

		// Sign-in pages have no session to read a language from, so they keep
		// the cookie-or-default path.
		if (isPublicPath)
			return { lang: chosenLang ?? defaultLang, themePreference, theme }

		const user = await fetchSession(cookieHeader ?? undefined)
		if (!user) {
			throw redirect({
				to: '/login',
				search: { returnTo: location.href },
			})
		}
		// Falls back to the account's language so someone an admin just added
		// lands in their own language on the very first page, before they have
		// touched any setting. Route context is serialized across SSR, so only
		// the plain language code crosses — never the session itself.
		return {
			lang: chosenLang ?? user.locale ?? defaultLang,
			themePreference,
			theme,
		}
	},
	loader: ({ context }) => ({
		lang: context.lang,
		themePreference: context.themePreference,
		theme: context.theme,
	}),
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
				{ rel: 'preconnect', href: 'https://fonts.googleapis.com' },
				{
					rel: 'preconnect',
					href: 'https://fonts.gstatic.com',
					crossOrigin: 'anonymous',
				},
				{
					rel: 'stylesheet',
					href: 'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;500;700&family=Barlow:wght@400;500;700&display=swap',
				},
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
	const location = useLocation()
	const { lang, themePreference, theme } = Route.useLoaderData()
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

	// The sign-in pages render standalone — no sidebar, no top bar, no Quick
	// Capture dialog — because they run before there is an account or an
	// active org for that chrome to describe. Everything else runs inside the
	// full authenticated shell.
	const isAuthChrome =
		location.pathname === '/login' ||
		location.pathname === '/forgot-password' ||
		location.pathname === '/reset-password' ||
		// The OAuth consent screen runs mid-flow (authed, but handing access to
		// an MCP client) — render it focused, without the org-aware chrome.
		location.pathname === '/oauth/consent'

	// Tell any stale `/login` tab (left on the "Check your inbox" panel
	// after a cross-tab magic-link verify) to navigate off. Listener lives
	// in login.tsx; firing on every authed-shell mount covers all sign-in
	// paths uniformly.
	useEffect(() => {
		if (isAuthChrome) return
		if (typeof BroadcastChannel === 'undefined') return
		const channel = new BroadcastChannel('batuda-auth')
		channel.postMessage({ kind: 'signed-in' })
		channel.close()
	}, [isAuthChrome])

	return (
		<RootDocument lang={lang} theme={theme} preference={themePreference}>
			<ThemeProvider initialPreference={themePreference} initialTheme={theme}>
				<LangProvider initialLang={lang}>
					<RegistryProvider>
						<HydrationBoundary state={dehydrated}>
							<BatudaMotionConfig>
								<LayoutGroup>
									<PriToast.Provider>
										{isAuthChrome ? (
											<Outlet />
										) : (
											<QuickCaptureProvider>
												<ComposeEmailProvider>
													<AppShell>
														<Outlet />
													</AppShell>
													<QuickCaptureDialog />
													<ComposeDock />
												</ComposeEmailProvider>
											</QuickCaptureProvider>
										)}
										<PriToast.Viewport />
									</PriToast.Provider>
								</LayoutGroup>
							</BatudaMotionConfig>
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

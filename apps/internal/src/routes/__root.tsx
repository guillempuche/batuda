import { HydrationBoundary, RegistryProvider } from '@effect/atom-react'
import {
	createRootRoute,
	HeadContent,
	Outlet,
	redirect,
	retainSearchParams,
	Scripts,
	useLocation,
	useMatches,
} from '@tanstack/react-router'
import leafletCss from 'leaflet/dist/leaflet.css?url'
import { LayoutGroup } from 'motion/react'

import { PriToast } from '@engranatge/ui/pri'

import { ComposeDock } from '#/components/emails/compose-dock'
import { QuickCaptureDialog } from '#/components/interactions/quick-capture-dialog'
import { AppShell } from '#/components/layout/app-shell'
import { ForjaMotionConfig } from '#/components/layout/motion-config'
import { ComposeEmailProvider } from '#/context/compose-email-context'
import { QuickCaptureProvider } from '#/context/quick-capture-context'
import { readLangCookieFromHeader } from '#/i18n/cookie'
import { defaultLang, htmlLang, type LangCode } from '#/i18n/index'
import { LangProvider } from '#/i18n/lang-provider'
import { translatedHead } from '#/i18n/lingui'
import type { DehydratedAtomValue } from '#/lib/atom-hydration'
import { getServerCookieHeader } from '#/lib/server-cookie'
import { fetchSession } from '#/lib/session-check'
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
type RootSearch = { readonly tab?: string }

export const Route = createRootRoute({
	validateSearch: (raw: Record<string, unknown>): RootSearch =>
		typeof raw['tab'] === 'string' ? { tab: raw['tab'] } : {},
	search: { middlewares: [retainSearchParams(['tab'])] },
	beforeLoad: async ({ location }) => {
		let cookieHeader: string | null | undefined
		if (import.meta.env.SSR) {
			cookieHeader = await getServerCookieHeader()
		} else if (typeof document !== 'undefined') {
			cookieHeader = document.cookie
		}
		const lang: LangCode = readLangCookieFromHeader(cookieHeader) ?? defaultLang

		if (location.pathname !== '/login') {
			const user = await fetchSession(cookieHeader ?? undefined)
			if (!user) {
				throw redirect({
					to: '/login',
					search: { returnTo: location.href },
				})
			}
		}
		return { lang }
	},
	loader: ({ context }) => ({ lang: context.lang }),
	head: ({ loaderData }) => {
		const lang: LangCode = loaderData?.lang ?? defaultLang
		const { title, description } = translatedHead[lang]
		return {
			meta: [
				{ charSet: 'utf-8' },
				{ name: 'viewport', content: 'width=device-width, initial-scale=1' },
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
				{ rel: 'stylesheet', href: leafletCss },
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
	// Collect dehydrated atom values from every matched route's loader
	// data. Routes without loaders (or without a `dehydrated` field)
	// contribute nothing. Order matches the route hierarchy top-down;
	// HydrationBoundary is idempotent so duplicates from nested routes are
	// harmless.
	const matches = useMatches()
	const location = useLocation()
	const { lang } = Route.useLoaderData()
	const dehydrated = matches.flatMap(m => {
		const data = m.loaderData as
			| { dehydrated?: ReadonlyArray<DehydratedAtomValue> }
			| undefined
		return data?.dehydrated ?? []
	})

	// The login page renders standalone — no sidebar, no top bar, no
	// Quick Capture dialog (there's no authenticated user yet, so the
	// dialog would have nothing to do). Everything else runs inside the
	// full authenticated shell.
	const isAuthChrome = location.pathname === '/login'

	return (
		<RootDocument lang={lang}>
			<LangProvider initialLang={lang}>
				<RegistryProvider>
					<HydrationBoundary state={dehydrated}>
						<ForjaMotionConfig>
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
						</ForjaMotionConfig>
					</HydrationBoundary>
				</RegistryProvider>
			</LangProvider>
		</RootDocument>
	)
}

function RootDocument({
	lang,
	children,
}: {
	lang: LangCode
	children: React.ReactNode
}) {
	return (
		<html lang={htmlLang[lang]}>
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

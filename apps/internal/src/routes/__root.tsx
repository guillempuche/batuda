import { HydrationBoundary, RegistryProvider } from '@effect/atom-react'
import { I18nProvider } from '@lingui/react'
import {
	createRootRoute,
	HeadContent,
	Outlet,
	redirect,
	Scripts,
	useLocation,
	useMatches,
} from '@tanstack/react-router'
import { LayoutGroup } from 'motion/react'

import { PriToast } from '@engranatge/ui/pri'

import { QuickCaptureDialog } from '#/components/interactions/quick-capture-dialog'
import { AppShell } from '#/components/layout/app-shell'
import { ForjaMotionConfig } from '#/components/layout/motion-config'
import { QuickCaptureProvider } from '#/context/quick-capture-context'
import { i18n } from '#/i18n'
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
export const Route = createRootRoute({
	beforeLoad: async ({ location }) => {
		// `/login` is the one public surface. Don't gate it or we'll
		// bounce forever.
		if (location.pathname === '/login') return
		let cookieHeader: string | undefined
		if (import.meta.env.SSR) {
			cookieHeader = (await getServerCookieHeader()) ?? undefined
		}
		const user = await fetchSession(cookieHeader)
		if (!user) {
			throw redirect({
				to: '/login',
				search: { returnTo: location.href },
			})
		}
	},
	head: () => ({
		meta: [
			{ charSet: 'utf-8' },
			{ name: 'viewport', content: 'width=device-width, initial-scale=1' },
			{ title: 'Forja — Engranatge CRM' },
			{
				name: 'description',
				content: "Forja — Engranatge's internal sales CRM.",
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
	}),
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
		<RootDocument>
			<I18nProvider i18n={i18n}>
				<RegistryProvider>
					<HydrationBoundary state={dehydrated}>
						<ForjaMotionConfig>
							<LayoutGroup>
								<PriToast.Provider>
									{isAuthChrome ? (
										<Outlet />
									) : (
										<QuickCaptureProvider>
											<AppShell>
												<Outlet />
											</AppShell>
											<QuickCaptureDialog />
										</QuickCaptureProvider>
									)}
									<PriToast.Viewport />
								</PriToast.Provider>
							</LayoutGroup>
						</ForjaMotionConfig>
					</HydrationBoundary>
				</RegistryProvider>
			</I18nProvider>
		</RootDocument>
	)
}

function RootDocument({ children }: { children: React.ReactNode }) {
	return (
		<html lang='en'>
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

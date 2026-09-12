import { createFileRoute, Outlet } from '@tanstack/react-router'
import { AsyncResult } from 'effect/unstable/reactivity'
import { LayoutGroup } from 'motion/react'
import { useEffect } from 'react'

import { companyIndustriesAtom } from '#/atoms/company-industries-atoms'
import { ComposeDock } from '#/components/emails/compose-dock'
import { QuickCaptureDialog } from '#/components/interactions/quick-capture-dialog'
import { AppShell } from '#/components/layout/app-shell'
import { BatudaMotionConfig } from '#/components/layout/motion-config'
import { ComposeEmailProvider } from '#/context/compose-email-context'
import { QuickCaptureProvider } from '#/context/quick-capture-context'
import { dehydrateAtom, handOverFromServer } from '#/lib/atom-hydration'
import type { BatudaApiServerClient } from '#/lib/batuda-api-server'
import { redirectToLogin } from '#/lib/session-check'

/**
 * Everything a signed-in person sees runs inside this layout: the sidebar, the
 * top bar, Quick Capture and the email compose dock. The sign-in pages and the
 * OAuth consent screen sit outside it, because they run before there is an
 * account or an active org for that chrome to describe.
 *
 * It is a layout route rather than a branch in the root component so that
 * this chrome, and everything it imports, is only sent to the browser for the
 * pages that use it. The root route cannot be code-split, so an import there
 * ships on the sign-in page too.
 */
export const Route = createFileRoute('/_authed')({
	// The root route has already asked the API whether there is a session; this
	// only turns "no" into a trip to the sign-in page.
	beforeLoad: ({ context, location }) => {
		if (!context.signedIn) throw redirectToLogin(location.href)
	},
	// The organisation's trades are read by company cards on nearly every
	// screen, so they are fetched once here, on the server, and handed to the
	// browser with the page. Fetched here rather than in each page's loader
	// because whichever page renders a card needs them, and in the browser the
	// atom fetches for itself on a later navigation.
	loader: () =>
		handOverFromServer({
			label: 'AuthedLayoutLoader',
			empty: { dehydrated: [] },
			fetch: loadIndustriesOnServer,
			handOver: industries => ({
				dehydrated: [
					dehydrateAtom(companyIndustriesAtom, AsyncResult.success(industries)),
				],
			}),
		}),
	component: AuthedLayout,
})

function loadIndustriesOnServer(client: BatudaApiServerClient) {
	// Has to match `companyIndustriesAtom` exactly: the browser picks up what
	// the server fetched by the shape of the question.
	return client.companyIndustries.list()
}

function AuthedLayout() {
	// Tell any stale `/login` tab (left on the "Check your inbox" panel after a
	// cross-tab magic-link verify) to navigate off. The listener lives in
	// login.tsx; firing whenever this layout mounts covers every sign-in path.
	useEffect(() => {
		if (typeof BroadcastChannel === 'undefined') return
		const channel = new BroadcastChannel('batuda-auth')
		channel.postMessage({ kind: 'signed-in' })
		channel.close()
	}, [])

	return (
		<BatudaMotionConfig>
			<LayoutGroup>
				<QuickCaptureProvider>
					<ComposeEmailProvider>
						<AppShell>
							<Outlet />
						</AppShell>
						<QuickCaptureDialog />
						<ComposeDock />
					</ComposeEmailProvider>
				</QuickCaptureProvider>
			</LayoutGroup>
		</BatudaMotionConfig>
	)
}

import {
	createRootRoute,
	HeadContent,
	Outlet,
	Scripts,
} from '@tanstack/react-router'

import { WorkshopFooter } from '#/components/layout/WorkshopFooter'
import { WorkshopNav } from '#/components/layout/WorkshopNav'
import { LangProvider } from '#/i18n/LangProvider'
import appCss from '../styles.css?url'

export const Route = createRootRoute({
	head: () => ({
		meta: [
			{ charSet: 'utf-8' },
			{ name: 'viewport', content: 'width=device-width, initial-scale=1' },
			{ title: 'Engranatge — Les màquines fan la feina' },
		],
		links: [
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
				href: 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=Inter:wght@400;500&display=swap',
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
	return (
		<html lang='ca'>
			<head>
				<HeadContent />
			</head>
			<body>
				<LangProvider lang='ca'>
					<WorkshopNav />
					<main>{children}</main>
					<WorkshopFooter />
				</LangProvider>
				<Scripts />
			</body>
		</html>
	)
}

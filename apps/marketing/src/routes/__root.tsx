import {
	createRootRoute,
	HeadContent,
	Outlet,
	Scripts,
} from '@tanstack/react-router'
import styled from 'styled-components'

import { ActiveSectionProvider } from '#/components/layout/active-section-context'
import { ClipboardHeader } from '#/components/layout/clipboard-header'
import { ToolBelt } from '#/components/layout/tool-belt'
import { WorkshopDesktop } from '#/components/layout/workshop-desktop'
import { WorkshopFooter } from '#/components/layout/workshop-footer'
import { LangProvider } from '#/i18n/lang-provider'
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

const Shell = styled.div`
	display: flex;
	flex-direction: column;

	@media (min-width: 1024px) {
		height: 100dvh;
		/* Pegboard wall covers the entire viewport */
		background-color: #B8A88C;
		background-image: radial-gradient(
			circle,
			rgba(80, 65, 45, 0.5) 2px,
			transparent 2px
		);
		background-size: 24px 24px;
	}
`

function RootDocument({ children }: { children: React.ReactNode }) {
	return (
		<html lang='ca'>
			<head>
				<HeadContent />
			</head>
			<body>
				<LangProvider lang='ca'>
					<ActiveSectionProvider>
						<Shell>
							<ClipboardHeader />
							<WorkshopDesktop>{children}</WorkshopDesktop>
						</Shell>
						<WorkshopFooter />
						<ToolBelt />
					</ActiveSectionProvider>
				</LangProvider>
				<Scripts />
			</body>
		</html>
	)
}

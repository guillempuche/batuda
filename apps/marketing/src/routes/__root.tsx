import {
	createRootRoute,
	HeadContent,
	Outlet,
	Scripts,
} from '@tanstack/react-router'
import { useEffect } from 'react'
import styled from 'styled-components'

import { ActiveSectionProvider } from '#/components/layout/active-section-context'
import { ClipboardHeader } from '#/components/layout/clipboard-header'
import { ToolBelt } from '#/components/layout/tool-belt'
import { WorkshopDesktop } from '#/components/layout/workshop-desktop'
import { WorkshopFooter } from '#/components/layout/workshop-footer'
import { defaultLang, htmlLang, locales } from '#/i18n'
import { LangProvider, useTranslations } from '#/i18n/lang-provider'
import appCss from '../styles.css?url'

export const Route = createRootRoute({
	head: () => ({
		meta: [
			{ charSet: 'utf-8' },
			{ name: 'viewport', content: 'width=device-width, initial-scale=1' },
			{ title: locales[defaultLang].meta.title },
			{ name: 'description', content: locales[defaultLang].meta.description },
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

	/* Pegboard wall — always visible (phones see it through paper margins) */
	background-color: #B8A88C;
	background-image: radial-gradient(
		circle,
		rgba(80, 65, 45, 0.5) 2px,
		transparent 2px
	);
	background-size: 24px 24px;

	/* Viewport lock — tablet+ (desktop workshop layout) */
	@media (min-width: 768px) {
		height: 100dvh;
	}
`

/* Mirrors the active locale's title/description into <head>. Lives inside
 * LangProvider so it can react to runtime language changes — the static
 * head() options on the Route only run once during SSR. */
function LocalizedHead() {
	const t = useTranslations()
	useEffect(() => {
		document.title = t.meta.title
		const desc = document.querySelector<HTMLMetaElement>(
			'meta[name="description"]',
		)
		if (desc) {
			desc.content = t.meta.description
		} else {
			const next = document.createElement('meta')
			next.name = 'description'
			next.content = t.meta.description
			document.head.appendChild(next)
		}
	}, [t])
	return null
}

function RootDocument({ children }: { children: React.ReactNode }) {
	return (
		<html lang={htmlLang[defaultLang]}>
			<head>
				<HeadContent />
			</head>
			<body>
				<LangProvider lang={defaultLang}>
					<LocalizedHead />
					<ActiveSectionProvider>
						<Shell>
							<ClipboardHeader />
							<WorkshopDesktop>{children}</WorkshopDesktop>
							<WorkshopFooter />
						</Shell>
						<ToolBelt />
					</ActiveSectionProvider>
				</LangProvider>
				<Scripts />
			</body>
		</html>
	)
}

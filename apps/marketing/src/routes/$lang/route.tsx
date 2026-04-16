import {
	createFileRoute,
	notFound,
	Outlet,
	redirect,
} from '@tanstack/react-router'
import styled from 'styled-components'

import { ActiveSectionProvider } from '#/components/layout/active-section-context'
import { ClipboardHeader } from '#/components/layout/clipboard-header'
import { ToolBelt } from '#/components/layout/tool-belt'
import { WorkshopDesktop } from '#/components/layout/workshop-desktop'
import { WorkshopFooter } from '#/components/layout/workshop-footer'
import { isLangCode, type LangCode } from '#/i18n'
import { detectLang } from '#/i18n/detect-lang'
import { LangProvider } from '#/i18n/lang-provider'
import { LinguiProvider } from '#/i18n/lingui'
import { buildPublicPath, findPageByBareSlug } from '#/i18n/slugs'

export const Route = createFileRoute('/$lang')({
	beforeLoad: ({ params }) => {
		if (isLangCode(params.lang)) return
		/* A segment that isn't a language might still be a real page the user
		 * reached without a prefix (e.g. /guillem). Resolve it to its canonical
		 * URL under the detected language so the request keeps its intent. */
		const pageId = findPageByBareSlug(params.lang)
		if (pageId) {
			throw redirect({ href: buildPublicPath(pageId, detectLang()) })
		}
		throw notFound()
	},
	component: LangLayout,
})

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

function LangLayout() {
	const { lang } = Route.useParams()
	const langCode = lang as LangCode
	return (
		<LangProvider lang={langCode}>
			<LinguiProvider lang={langCode}>
				<ActiveSectionProvider>
					<Shell>
						<ClipboardHeader />
						<WorkshopDesktop>
							<Outlet />
						</WorkshopDesktop>
						<WorkshopFooter />
					</Shell>
					<ToolBelt />
				</ActiveSectionProvider>
			</LinguiProvider>
		</LangProvider>
	)
}

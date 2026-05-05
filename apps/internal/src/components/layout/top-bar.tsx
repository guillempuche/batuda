import { useLingui as useLinguiCore } from '@lingui/react'
import { Trans } from '@lingui/react/macro'
import { useRouterState } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { motion } from 'motion/react'
import styled from 'styled-components'

import { PriButton } from '@batuda/ui/pri'

import { ScrewDot } from '#/components/shared/workshop-decorations'
import { useQuickCapture } from '#/context/quick-capture-context'
import { brushedMetalPlate, stenciledTitle } from '#/lib/workshop-mixins'
import { navItems } from './nav-items'
import { OrgSwitcher } from './org-switcher'

/**
 * Sheet-metal label strip across the top of the content column. Renders
 * the current section name in stenciled display-font with an embossed
 * shadow, plus a stamped-metal "Log" CTA that opens the QuickCapture
 * dialog. The current user lives on the sidebar/bottom-nav Profile
 * entry — this bar intentionally stays focused on section title + Log.
 *
 * The title is the longest-prefix match in `navItems` (e.g. "Companies"
 * for both /companies and /companies/$slug). Deep page strings —
 * company name, thread subject, active tab — go to `document.title`
 * via `useSetDocumentTitle`, not here; the in-page header is where
 * those surface visually. On phones the heading hides under 480 px to
 * avoid duplicating the bottom-rail nav selection.
 */
export function TopBar() {
	const pathname = useRouterState({ select: state => state.location.pathname })
	const { open } = useQuickCapture()
	const { i18n } = useLinguiCore()
	const descriptor = deriveTitleDescriptor(pathname)
	const title = descriptor ? i18n._(descriptor) : 'Batuda'

	return (
		<Bar>
			<ScrewDot $position='top-left' aria-hidden />
			<ScrewDot $position='top-right' aria-hidden />
			<Title>{title}</Title>
			<Actions>
				<OrgSwitcher />
				<motion.div whileTap={{ scale: 0.96 }}>
					<PriButton
						type='button'
						$variant='filled'
						data-testid='topbar-log-trigger'
						onClick={() => open()}
					>
						<Plus size={18} />
						<span>
							<Trans>Log</Trans>
						</span>
					</PriButton>
				</motion.div>
			</Actions>
		</Bar>
	)
}

function deriveTitleDescriptor(pathname: string) {
	const exact = navItems.find(item => item.path === pathname)
	if (exact) return exact.label
	const matches = navItems.filter(
		item => item.path !== '/' && pathname.startsWith(item.path),
	)
	const longest = matches.reduce<(typeof matches)[number] | undefined>(
		(best, item) =>
			!best || item.path.length > best.path.length ? item : best,
		undefined,
	)
	return longest?.label ?? null
}

const Bar = styled.header.withConfig({ displayName: 'TopBar' })`
	${brushedMetalPlate}
	z-index: 5;
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--space-sm);
	min-height: var(--top-bar-height);
	padding: 0 var(--space-md);
	border: none;
	border-bottom: 1px solid rgba(0, 0, 0, 0.18);

	@media (min-width: 768px) {
		gap: var(--space-md);
		padding: 0 var(--space-lg);
	}
`

const Title = styled.h1.withConfig({ displayName: 'TopBarTitle' })`
	${stenciledTitle}
	font-size: var(--typescale-title-medium-size);
	line-height: var(--typescale-title-medium-line);
	margin: 0;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;

	/* On phones the section heading duplicates the bottom-rail nav
	 * selection and competes with the org chip + Log button for space.
	 * Hide it under 480 px so the row reads as: org · Log. */
	@media (max-width: 479px) {
		display: none;
	}

	@media (min-width: 768px) {
		font-size: var(--typescale-title-large-size);
		line-height: var(--typescale-title-large-line);
	}
`

const Actions = styled.div.withConfig({ displayName: 'TopBarActions' })`
	display: flex;
	flex-shrink: 0;
	align-items: center;
	gap: var(--space-sm);
`

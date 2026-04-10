import { useLingui as useLinguiCore } from '@lingui/react'
import { Trans, useLingui } from '@lingui/react/macro'
import { useRouterState } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import styled from 'styled-components'

import { useQuickCapture } from '#/context/quick-capture-context'
import { navItems } from './nav-items'

/**
 * Sticky header for the content column. On desktop it sits inside `<Main>`
 * as `position: sticky; top: 0` so the page title, Quick Capture button,
 * and user menu remain in reach while the body scrolls.
 *
 * Page title is derived from the longest-prefix match in `navItems` — if
 * no nav item matches (e.g. a sub-route like `/companies/$slug`), we fall
 * back to the parent's label so the header still reads coherently.
 *
 * The "+ Registra" button opens the global Quick Capture dialog via
 * `useQuickCapture()` (Phase 9b). It opens with no prefill from the top
 * bar — callers that want to pre-fill a company (list/detail views)
 * invoke `open({ companyId, companyName })` directly.
 */
export function TopBar() {
	const pathname = useRouterState({ select: state => state.location.pathname })
	const { open } = useQuickCapture()
	const { t } = useLingui()
	const { i18n } = useLinguiCore()
	const descriptor = deriveTitleDescriptor(pathname)
	const title = descriptor ? i18n._(descriptor) : 'Forja'

	return (
		<Bar>
			<Title>{title}</Title>
			<Actions>
				<QuickCapture type='button' onClick={() => open()}>
					<Plus size={18} />
					<span>
						<Trans>Log</Trans>
					</span>
				</QuickCapture>
				<UserMenuButton type='button' aria-label={t`User menu`}>
					<Avatar aria-hidden>U</Avatar>
				</UserMenuButton>
			</Actions>
		</Bar>
	)
}

/**
 * Longest-prefix match against `navItems`. Returns the matching nav item's
 * `MessageDescriptor` label, or `null` if no match (caller falls back to
 * "Forja"). Consumers render the descriptor with `i18n._(descriptor)`.
 */
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
	position: sticky;
	top: 0;
	z-index: 5;
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--space-md);
	min-height: var(--top-bar-height);
	padding: 0 var(--space-lg);
	background: var(--color-surface);
	border-bottom: 1px solid var(--color-outline-variant);
`

const Title = styled.h1.withConfig({ displayName: 'TopBarTitle' })`
	font-family: var(--font-display);
	font-size: var(--typescale-title-large-size);
	line-height: var(--typescale-title-large-line);
	font-weight: var(--font-weight-bold);
	color: var(--color-on-surface);
	letter-spacing: -0.005em;
	margin: 0;
`

const Actions = styled.div.withConfig({ displayName: 'TopBarActions' })`
	display: flex;
	align-items: center;
	gap: var(--space-sm);
`

const QuickCapture = styled.button.withConfig({
	displayName: 'TopBarQuickCapture',
})`
	display: inline-flex;
	align-items: center;
	gap: var(--space-2xs);
	padding: var(--space-2xs) var(--space-md);
	border-radius: var(--shape-full);
	border: none;
	cursor: pointer;
	background: var(--color-primary);
	color: var(--color-on-primary);
	font-family: var(--font-body);
	font-size: var(--typescale-label-large-size);
	line-height: var(--typescale-label-large-line);
	letter-spacing: var(--typescale-label-large-tracking);
	font-weight: var(--typescale-label-large-weight);
	transition:
		background 120ms ease,
		transform 120ms ease;

	&:hover {
		background: color-mix(in oklab, var(--color-primary) 90%, black);
	}

	&:active {
		transform: translateY(1px);
	}

	&:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 2px;
	}

	span {
		display: none;
	}

	@media (min-width: 768px) {
		span {
			display: inline;
		}
	}
`

const UserMenuButton = styled.button.withConfig({
	displayName: 'TopBarUserMenu',
})`
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 2.25rem;
	height: 2.25rem;
	padding: 0;
	border: none;
	background: transparent;
	border-radius: var(--shape-full);
	cursor: pointer;

	&:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 2px;
	}
`

const Avatar = styled.span.withConfig({ displayName: 'TopBarAvatar' })`
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 2.25rem;
	height: 2.25rem;
	border-radius: var(--shape-full);
	background: var(--color-secondary);
	color: var(--color-on-secondary);
	font-family: var(--font-display);
	font-weight: var(--font-weight-bold);
	font-size: var(--typescale-label-large-size);
`

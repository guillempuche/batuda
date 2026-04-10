import styled from 'styled-components'

import { BottomNav } from './bottom-nav'
import { SideNav } from './side-nav'
import { TopBar } from './top-bar'

/**
 * Responsive CRM shell:
 *  - Mobile (<1024px): document scroll with fixed bottom nav, padding-bottom
 *    on main so content clears the bar. TopBar is sticky inside Main.
 *  - Desktop (≥1024px): flex row, 240px fixed-width side nav on the left,
 *    scrolling main on the right with sticky TopBar pinned to the top.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
	return (
		<Shell>
			<SideNav />
			<Main>
				<TopBar />
				<Content>{children}</Content>
			</Main>
			<BottomNav />
		</Shell>
	)
}

const Shell = styled.div.withConfig({ displayName: 'AppShell' })`
	display: flex;
	flex-direction: column;
	min-height: 100dvh;

	@media (min-width: 1024px) {
		flex-direction: row;
		height: 100dvh;
		overflow: hidden;
	}
`

const Main = styled.main.withConfig({ displayName: 'AppShellMain' })`
	flex: 1;
	min-width: 0;
	padding-bottom: calc(
		var(--bottom-nav-height) + env(safe-area-inset-bottom, 0px)
	);

	@media (min-width: 1024px) {
		overflow-y: auto;
		padding-bottom: 0;
	}
`

const Content = styled.div.withConfig({ displayName: 'AppShellContent' })`
	padding: var(--space-lg) var(--space-md);

	@media (min-width: 768px) {
		padding: var(--space-xl) var(--space-lg);
	}
`

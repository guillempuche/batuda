import styled from 'styled-components'

import { BlueprintSheet } from './blueprint-sheet'
import { BottomNav } from './bottom-nav'
import { SideNav } from './side-nav'
import { TopBar } from './top-bar'
import { TopBarTitleProvider } from './top-bar-title'

/**
 * Responsive workshop shell. The body is locked at ≥768px (see styles.css)
 * so scrolling happens inside BlueprintSheet's PriScrollArea viewport —
 * this lets the sticky rulers, brushed-metal rail scrollbar, and tape
 * strips stay in place while content slides underneath.
 *
 *  - Mobile (<1024px): column layout, SideNav hidden, BottomNav visible.
 *    BlueprintSheet still owns scroll; on ≥768px the body lock kicks in.
 *  - Desktop (≥1024px): row layout, SideNav fixed to 240px on the left.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
	return (
		<TopBarTitleProvider>
			<Shell>
				<SideNav />
				<Main>
					<TopBar />
					<BlueprintSheet>{children}</BlueprintSheet>
				</Main>
				<BottomNav />
			</Shell>
		</TopBarTitleProvider>
	)
}

const Shell = styled.div.withConfig({ displayName: 'AppShell' })`
	/* Create a root stacking context for all app chrome so the PriDialog
	 * portal (appended to <body>, outside this subtree) can sit above
	 * z-indexed app elements like TopBar and BottomNav — matches the
	 * pattern Base UI recommends in its dialog docs. */
	isolation: isolate;

	display: flex;
	flex-direction: column;
	min-height: 100dvh;

	@media (min-width: 768px) {
		height: 100dvh;
		min-height: 0;
		overflow: hidden;
	}

	@media (min-width: 1024px) {
		flex-direction: row;
	}
`

const Main = styled.main.withConfig({ displayName: 'AppShellMain' })`
	flex: 1;
	min-width: 0;
	display: flex;
	flex-direction: column;

	@media (min-width: 768px) {
		min-height: 0;
	}
`

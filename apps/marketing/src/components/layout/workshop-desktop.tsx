import { Link } from '@tanstack/react-router'
import { Cog, Gauge, MessageCircle, Receipt, Wrench } from 'lucide-react'
import styled from 'styled-components'

import { useTranslations } from '#/i18n/lang-provider'
import { BlueprintSheet } from './blueprint-sheet'
import { FooterStampContent } from './footer-stamp'
import { LanguageSelect } from './language-select'
import { ShadowBoardTool } from './shadow-board-tool'

const Layout = styled.div.withConfig({ displayName: 'WorkshopDesktop' })`
	flex: 1;
	min-height: 0;
	position: relative;

	@media (min-width: 768px) {
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}
`

const Main = styled.div`
	@media (min-width: 768px) {
		flex: 1;
		display: flex;
		min-height: 0;
	}
`

const IconColumn = styled.div.withConfig({ displayName: 'IconColumn' })`
	display: none;

	@media (min-width: 768px) {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: var(--space-sm) var(--space-xs);
		width: 7rem;
		flex-shrink: 0;
		min-height: 0;
	}
`

/* Holds the machine buttons and lets them spread evenly down the pegboard
 * column so the tools look hung across the whole shadow board — not crammed
 * below the logo with empty wall underneath. */
const ToolsRack = styled.div.withConfig({ displayName: 'ToolsRack' })`
	flex: 1;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: space-around;
	width: 100%;
	min-height: 0;
	padding: var(--space-md) 0;
`

const WindowArea = styled.div`
	@media (min-width: 768px) {
		flex: 1;
		display: flex;
		padding: var(--space-sm) var(--space-xs);
		min-width: 0;
		/* Paper pinned slightly crooked */
		transform: rotate(0.15deg);
		transform-origin: top left;
	}
`

/* Small sheet-metal plate screwed to bottom-right of pegboard */
const FooterPlate = styled.div.withConfig({ displayName: 'FooterPlate' })`
	display: none;

	@media (min-width: 768px) {
		display: flex;
		align-items: center;
		align-self: flex-end;
		gap: var(--space-sm);
		margin: var(--space-xs) var(--space-md) var(--space-xs) auto;
		padding: var(--space-3xs) var(--space-sm);
		background:
			var(--texture-brushed-metal),
			linear-gradient(135deg, var(--color-metal-dark) 0%, var(--color-metal) 50%, var(--color-metal-dark) 100%);
		border: 1px solid rgba(0, 0, 0, 0.15);
		box-shadow: var(--elevation-workshop-sm);
		flex-shrink: 0;
		position: relative;

		/* Screw dots */
		&::before,
		&::after {
			content: '';
			width: 5px;
			height: 5px;
			border-radius: var(--shape-full);
			background: radial-gradient(circle at 35% 35%, var(--color-metal), var(--color-metal-deep));
			border: 1px solid rgba(0, 0, 0, 0.12);
			flex-shrink: 0;
		}
	}
`

/* Metal plate stamped onto the pegboard wall */
const LogoPlate = styled(Link).withConfig({ displayName: 'LogoPlate' })`
	display: none;

	@media (min-width: 768px) {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2xs);
		background: linear-gradient(135deg, var(--color-metal-dark) 0%, var(--color-metal-light) 50%, var(--color-metal-dark) 100%);
		border: 1px solid var(--color-outline);
		padding: var(--space-3xs) var(--space-xs);
		box-shadow: var(--elevation-workshop-md);
		font-family: var(--font-display);
		font-size: var(--typescale-label-small-size);
		font-weight: var(--font-weight-bold);
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--color-on-surface);
		text-shadow: var(--text-shadow-emboss);
		text-decoration: none;
		text-align: center;
		margin-bottom: var(--space-xs);

		&:focus-visible {
			outline: 2px solid var(--color-primary);
			outline-offset: 3px;
		}
	}
`

export function WorkshopDesktop({ children }: { children: React.ReactNode }) {
	const t = useTranslations()

	return (
		<Layout>
			<Main>
				<IconColumn>
					<LogoPlate to='/' hash='hero'>
						<Cog size={14} />
						Engranatge
					</LogoPlate>
					<ToolsRack>
						<ShadowBoardTool icon={Gauge} label={t.nav.home} scrollTo='hero' />
						<ShadowBoardTool
							icon={Wrench}
							label={t.nav.solution}
							scrollTo='solution'
						/>
						<ShadowBoardTool
							icon={Receipt}
							label={t.nav.quote}
							scrollTo='pricing'
						/>
						<ShadowBoardTool
							icon={MessageCircle}
							label={t.nav.contact}
							scrollTo='contact'
						/>
					</ToolsRack>
				</IconColumn>

				<WindowArea>
					<BlueprintSheet>
						<main>{children}</main>
					</BlueprintSheet>
				</WindowArea>
			</Main>

			<FooterPlate>
				<LanguageSelect />
				<FooterStampContent />
			</FooterPlate>
		</Layout>
	)
}

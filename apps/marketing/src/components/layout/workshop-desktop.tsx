import { Link } from '@tanstack/react-router'
import { Gauge, MessageCircle, Receipt, Wrench } from 'lucide-react'
import styled from 'styled-components'

import { useTranslations } from '#/i18n/lang-provider'
import { BlueprintSheet } from './blueprint-sheet'
import { ShadowBoardTool } from './shadow-board-tool'

const Layout = styled.div.attrs({ 'data-component': 'WorkshopDesktop' })`
	flex: 1;
	min-height: 0;
	position: relative;

	@media (min-width: 1024px) {
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}
`

const Main = styled.div`
	@media (min-width: 1024px) {
		flex: 1;
		display: flex;
		min-height: 0;
	}
`

const IconColumn = styled.div.attrs({ 'data-component': 'IconColumn' })`
	display: none;

	@media (min-width: 1024px) {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-lg);
		padding: var(--space-sm) var(--space-xs);
		width: 7rem;
		flex-shrink: 0;
		overflow-y: auto;
	}
`

const WindowArea = styled.div`
	@media (min-width: 1024px) {
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
const FooterPlate = styled.div.attrs({ 'data-component': 'FooterPlate' })`
	display: none;

	@media (min-width: 1024px) {
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

const FooterStamp = styled.span`
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	font-weight: 700;
	letter-spacing: 0.1em;
	text-transform: uppercase;
	color: #666058;
	text-shadow: var(--text-shadow-emboss);
`

/* Metal plate stamped onto the pegboard wall */
const LogoPlate = styled(Link).attrs({ 'data-component': 'LogoPlate' })`
	display: none;

	@media (min-width: 1024px) {
		display: block;
		background: linear-gradient(135deg, var(--color-metal-dark) 0%, var(--color-metal-light) 50%, var(--color-metal-dark) 100%);
		border: 1px solid var(--color-outline);
		padding: var(--space-3xs) var(--space-xs);
		box-shadow: var(--elevation-workshop-md);
		font-family: var(--font-display);
		font-size: var(--typescale-label-small-size);
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--color-on-surface);
		text-shadow: var(--text-shadow-emboss);
		text-decoration: none;
		text-align: center;
		margin-bottom: var(--space-xs);
	}
`

export function WorkshopDesktop({ children }: { children: React.ReactNode }) {
	const t = useTranslations()

	return (
		<Layout>
			<Main>
				<IconColumn>
					<LogoPlate to='/' hash='hero'>
						Engranatge
					</LogoPlate>
					<ShadowBoardTool icon={Gauge} label='Inici' scrollTo='hero' />
					<ShadowBoardTool icon={Wrench} label='Eines' scrollTo='solution' />
					<ShadowBoardTool icon={Receipt} label='Preus' scrollTo='pricing' />
					<ShadowBoardTool
						icon={MessageCircle}
						label='Parla'
						scrollTo='contact'
					/>
				</IconColumn>

				<WindowArea>
					<BlueprintSheet>
						<main>{children}</main>
					</BlueprintSheet>
				</WindowArea>
			</Main>

			<FooterPlate>
				<FooterStamp>{t.footer.madeIn}</FooterStamp>
				<FooterStamp>&middot;</FooterStamp>
				<FooterStamp>&copy; {new Date().getFullYear()} Engranatge</FooterStamp>
			</FooterPlate>
		</Layout>
	)
}

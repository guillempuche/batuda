import { Link } from '@tanstack/react-router'
import type { LucideIcon } from 'lucide-react'
import { Gauge, MessageCircle, Receipt, Wrench } from 'lucide-react'
import styled from 'styled-components'

const Belt = styled.nav.attrs({ 'data-component': 'ToolBelt' })`
	position: fixed;
	bottom: 0;
	left: 0;
	right: 0;
	z-index: 20;
	display: flex;
	background:
		var(--texture-brushed-metal),
		#3e2723;
	border-top: 2px solid rgba(255, 255, 255, 0.08);
	box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.2);
	padding-bottom: env(safe-area-inset-bottom, 0px);

	@media (min-width: 1024px) {
		display: none;
	}
`

const Tab = styled.button<{ $active?: boolean }>`
	flex: 1;
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 2px;
	padding: var(--space-sm) 0;
	color: ${p => (p.$active ? '#ffb68e' : 'rgba(255, 255, 255, 0.55)')};
	font-size: var(--typescale-label-small-size);
	font-weight: 700;
	letter-spacing: 0.04em;
	text-transform: uppercase;
	transition: color 0.15s;
	position: relative;
	background: none;
	border: none;
	cursor: pointer;

	/* Stitching divider on right edge */
	&:not(:last-child)::after {
		content: '';
		position: absolute;
		right: 0;
		top: 20%;
		height: 60%;
		width: 1px;
		background: repeating-linear-gradient(
			180deg,
			rgba(255, 255, 255, 0.12) 0,
			rgba(255, 255, 255, 0.12) 3px,
			transparent 3px,
			transparent 6px
		);
	}
`

interface TabDef {
	icon: LucideIcon
	label: string
	scrollTo?: string
	href?: string
}

const tabs: TabDef[] = [
	{ icon: Gauge, label: 'Inici', scrollTo: 'hero' },
	{ icon: Wrench, label: 'Eines', scrollTo: 'solution' },
	{ icon: Receipt, label: 'Preus', scrollTo: 'pricing' },
	{ icon: MessageCircle, label: 'Parla', scrollTo: 'contact' },
]

export function ToolBelt() {
	return (
		<Belt>
			{tabs.map(tab => {
				const Icon = tab.icon

				if (tab.href) {
					return (
						<a
							key={tab.label}
							href={tab.href}
							style={{ textDecoration: 'none', flex: 1 }}
						>
							<Tab as='div'>
								<Icon size={20} />
								<span>{tab.label}</span>
							</Tab>
						</a>
					)
				}

				if (tab.scrollTo) {
					return (
						<Link
							key={tab.label}
							to='/'
							hash={tab.scrollTo}
							style={{ textDecoration: 'none', flex: 1 }}
						>
							<Tab as='div'>
								<Icon size={20} />
								<span>{tab.label}</span>
							</Tab>
						</Link>
					)
				}

				return (
					<Tab key={tab.label}>
						<Icon size={20} />
						<span>{tab.label}</span>
					</Tab>
				)
			})}
		</Belt>
	)
}

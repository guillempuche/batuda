import { Trans } from '@lingui/react/macro'
import { Check, ChevronsUpDown, Globe } from 'lucide-react'
import styled from 'styled-components'

import { PriSelect } from '@engranatge/ui/pri'

import { type LangCode, langCodes } from '#/i18n'
import { useLang, useSetLang } from '#/i18n/lang-provider'

const LANG_LABELS: Record<LangCode, string> = {
	ca: 'Català',
	es: 'Español',
	en: 'English',
}

const items = langCodes.map(code => ({ value: code, label: LANG_LABELS[code] }))

const Field = styled.div`
	display: inline-flex;
	align-items: center;
	gap: var(--space-2xs);
`

const SrLabel = styled(PriSelect.Label)`
	position: absolute;
	width: 1px;
	height: 1px;
	padding: 0;
	margin: -1px;
	overflow: hidden;
	clip: rect(0, 0, 0, 0);
	white-space: nowrap;
	border: 0;
`

/* Metal-skin wrappers — workshop theatrical chrome on top of the neutral
 * PriSelect primitive. Only overrides what the workshop look needs:
 * brushed-metal gradient, sharp corners (no radius), embossed elevation,
 * uppercase stencil tracking. Everything else (focus ring, structural
 * spacing, typescale, color tokens) is inherited from PriSelect. */
const MetalTrigger = styled(PriSelect.Trigger)`
	background: linear-gradient(
		145deg,
		var(--color-metal-light) 0%,
		var(--color-metal) 50%,
		var(--color-metal-dark) 100%
	);
	border-radius: 0;
	box-shadow: var(--elevation-workshop-sm);
	font-weight: var(--font-weight-bold);
	letter-spacing: 0.08em;
	text-transform: uppercase;
`

const MetalPopup = styled(PriSelect.Popup)`
	background: linear-gradient(
		145deg,
		var(--color-metal-light) 0%,
		var(--color-metal) 100%
	);
	border-radius: 0;
	box-shadow: var(--elevation-workshop-md);
	min-width: 8rem;
`

const MetalItem = styled(PriSelect.Item)`
	font-weight: var(--font-weight-bold);
	letter-spacing: 0.06em;
	text-transform: uppercase;

	&[data-highlighted] {
		background: rgba(184, 90, 40, 0.18);
	}
`

export function LanguageSelect() {
	const lang = useLang()
	const setLang = useSetLang()

	return (
		<Field>
			<PriSelect.Root
				items={items}
				value={lang}
				onValueChange={value => {
					if (typeof value === 'string') setLang(value as LangCode)
				}}
			>
				<SrLabel>
					<Trans>Language</Trans>
				</SrLabel>
				<MetalTrigger>
					<Globe size={12} aria-hidden />
					<PriSelect.Value />
					<PriSelect.Icon>
						<ChevronsUpDown size={12} aria-hidden />
					</PriSelect.Icon>
				</MetalTrigger>
				<PriSelect.Portal>
					{/* Open upward in both layouts. On mobile, the fixed ToolBelt
					 * eats the space directly below this trigger; on desktop the
					 * FooterPlate sits flush with the bottom of a locked viewport
					 * (`html, body { height: 100dvh; overflow: hidden }`). Either
					 * way there is no room below.
					 *
					 * `alignItemWithTrigger={false}` opts out of the default
					 * overlap-the-selected-item algorithm, which only respects
					 * `side` as a fallback (and only on touch). With it disabled
					 * we get consistent popover-style positioning everywhere.
					 *
					 * `collisionPadding.bottom` reserves clearance for the
					 * ToolBelt (4.5rem ≈ 72px + safe-area) so the popup never
					 * overlaps it even on tight viewports. */}
					<PriSelect.Positioner
						alignItemWithTrigger={false}
						side='top'
						sideOffset={6}
						collisionPadding={{
							top: 8,
							right: 8,
							bottom: 96,
							left: 8,
						}}
					>
						<MetalPopup>
							<PriSelect.List>
								{items.map(item => (
									<MetalItem key={item.value} value={item.value}>
										<PriSelect.ItemIndicator>
											<Check size={12} />
										</PriSelect.ItemIndicator>
										<PriSelect.ItemText>{item.label}</PriSelect.ItemText>
									</MetalItem>
								))}
							</PriSelect.List>
						</MetalPopup>
					</PriSelect.Positioner>
				</PriSelect.Portal>
			</PriSelect.Root>
		</Field>
	)
}

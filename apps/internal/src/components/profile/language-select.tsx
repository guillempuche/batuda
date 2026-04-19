import { Trans } from '@lingui/react/macro'
import { Check, ChevronsUpDown, Globe } from 'lucide-react'
import styled from 'styled-components'

import { PriSelect } from '@batuda/ui/pri'

import { type LangCode, langCodes } from '#/i18n/index'
import { useLang, useSetLang } from '#/i18n/lang-provider'

/* Native endonyms so each option is self-describing regardless of which
 * locale is currently active — `Català` reads as Catalan whether the
 * surrounding UI is English or Catalan. */
const LANG_LABELS: Record<LangCode, string> = {
	en: 'English',
	ca: 'Català',
}

const items = langCodes.map(code => ({ value: code, label: LANG_LABELS[code] }))

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
					<PriSelect.Positioner alignItemWithTrigger={false} sideOffset={6}>
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

const Field = styled.div`
	display: inline-flex;
	align-items: center;
	gap: var(--space-2xs);
`

/* Visually hidden label preserved for screen readers even though the
 * trigger already shows the selected value — the <Trans>Language</Trans>
 * wording announces what the control is, not what it's set to. */
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

/* Workshop chrome on top of the neutral PriSelect primitive: brushed-metal
 * gradient, sharp corners, embossed shadow, uppercase stencil. Structural
 * spacing, focus ring, and color tokens come from PriSelect unchanged. */
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

import { Trans, useLingui } from '@lingui/react/macro'
import { Check, ChevronsUpDown, SunMoon } from 'lucide-react'
import styled from 'styled-components'

import { PriSelect } from '@batuda/ui/pri'

import { type ThemePreference, themePreferences } from '#/theme/index'
import {
	useSetThemePreference,
	useThemePreference,
} from '#/theme/theme-provider'

export function ThemeSelect() {
	const preference = useThemePreference()
	const setPreference = useSetThemePreference()
	const { t } = useLingui()

	/* Built on each render because the labels are translated — unlike the
	 * language names, which read the same whichever locale is active. Four
	 * strings is not worth memoising. */
	const labels: Record<ThemePreference, string> = {
		system: t`Match device`,
		light: t`Light`,
		dark: t`Dark`,
		'dark-hc': t`Dark, high contrast`,
	}
	const items = themePreferences.map(value => ({ value, label: labels[value] }))

	return (
		<Field>
			<PriSelect.Root
				items={items}
				value={preference}
				onValueChange={value => {
					if (typeof value === 'string') {
						setPreference(value as ThemePreference)
					}
				}}
			>
				<SrLabel>
					<Trans>Appearance</Trans>
				</SrLabel>
				<MetalTrigger>
					<SunMoon size={12} aria-hidden />
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

/* Visually hidden label preserved for screen readers even though the trigger
 * already shows the selection — the wording announces what the control is,
 * not what it is set to. */
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

/* Workshop chrome on top of the neutral PriSelect primitive, matching the
 * language selector it sits beside. */
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
	min-width: 11rem;
`

const MetalItem = styled(PriSelect.Item)`
	font-weight: var(--font-weight-bold);
	letter-spacing: 0.06em;
	text-transform: uppercase;

	&[data-highlighted] {
		background: color-mix(in oklab, var(--color-primary) 18%, transparent);
	}
`

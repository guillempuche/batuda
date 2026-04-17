import { useLingui } from '@lingui/react/macro'
import { Maximize2, Pencil } from 'lucide-react'
import { useCallback } from 'react'
import styled from 'styled-components'

import { ComposeWindow } from '#/components/emails/compose-window'
import { type Draft, useComposeEmail } from '#/context/compose-email-context'
import { brushedMetalPlate, stenciledTitle } from '#/lib/workshop-mixins'

/**
 * Single dock instance mounted at `__root.tsx`. Reads the draft list
 * from `ComposeEmailContext` and renders every `open` / `fullscreen`
 * draft as a floating window, plus minimized drafts as pill tabs.
 *
 * Desktop (≥1024px): windows stack right-to-left in a 480px column.
 * Tablet (640–1023px): one window at a time, pill tabs for the rest.
 * Mobile (<640px): one window at a time as a bottom sheet.
 */
export function ComposeDock() {
	const { drafts } = useComposeEmail()
	if (drafts.length === 0) return null
	const fullscreen = drafts.find(d => d.windowState === 'fullscreen')
	const open = drafts.filter(d => d.windowState === 'open')
	const minimized = drafts.filter(d => d.windowState === 'minimized')

	if (fullscreen !== undefined) {
		return <ComposeWindow draft={fullscreen} />
	}

	return (
		<DockLayer aria-label='Email drafts'>
			<OpenStack>
				{open.map(draft => (
					<ComposeWindow key={draft.id} draft={draft} />
				))}
			</OpenStack>
			{minimized.length > 0 && (
				<MinimizedTray role='list'>
					{minimized.map(draft => (
						<MinimizedPill key={draft.id} draft={draft} />
					))}
				</MinimizedTray>
			)}
		</DockLayer>
	)
}

function MinimizedPill({ draft }: { readonly draft: Draft }) {
	const { t } = useLingui()
	const { restore } = useComposeEmail()
	const handleRestore = useCallback(() => {
		restore(draft.id)
	}, [restore, draft.id])
	const label = pillLabel(draft, t)
	return (
		<PillButton
			type='button'
			role='listitem'
			onClick={handleRestore}
			title={label}
		>
			<Pencil size={12} aria-hidden />
			<PillText>{label}</PillText>
			<Maximize2 size={12} aria-hidden />
		</PillButton>
	)
}

function pillLabel(draft: Draft, t: ReturnType<typeof useLingui>['t']): string {
	if (draft.mode === 'reply') {
		const subject = draft.form.subject.trim()
		if (subject !== '') return t`Reply: ${subject}`
		return t`Reply`
	}
	const subject = draft.form.subject.trim()
	if (subject !== '') return subject
	return t`New message`
}

const DockLayer = styled.div.withConfig({ displayName: 'ComposeDock' })`
	position: fixed;
	right: var(--space-md);
	bottom: 0;
	z-index: 50;
	display: flex;
	flex-direction: column;
	align-items: flex-end;
	gap: var(--space-2xs);
	pointer-events: none;
`

const OpenStack = styled.div.withConfig({
	displayName: 'ComposeDockOpenStack',
})`
	display: flex;
	flex-direction: row-reverse;
	align-items: flex-end;
	gap: var(--space-sm);
	pointer-events: none;

	> * {
		pointer-events: auto;
	}

	@media (max-width: 767px) {
		flex-direction: column;
		align-items: stretch;
		gap: var(--space-2xs);

		> *:not(:first-child) {
			display: none;
		}
	}
`

const MinimizedTray = styled.div.withConfig({
	displayName: 'ComposeDockMinimizedTray',
})`
	display: flex;
	flex-wrap: wrap;
	gap: var(--space-2xs);
	pointer-events: auto;
	padding-bottom: var(--space-2xs);
`

const PillButton = styled.button.withConfig({
	displayName: 'ComposeDockPill',
})`
	${brushedMetalPlate}
	${stenciledTitle}
	display: inline-flex;
	align-items: center;
	gap: var(--space-2xs);
	padding: var(--space-2xs) var(--space-sm);
	border-radius: var(--shape-2xs);
	font-size: var(--typescale-label-small-size);
	letter-spacing: 0.08em;
	cursor: pointer;
	max-width: 220px;

	&:hover {
		filter: brightness(1.05);
	}

	&:focus-visible {
		outline: none;
		box-shadow: var(--glow-active);
	}
`

const PillText = styled.span.withConfig({
	displayName: 'ComposeDockPillText',
})`
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	max-width: 160px;
`

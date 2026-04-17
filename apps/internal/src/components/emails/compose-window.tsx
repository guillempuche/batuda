import { useLingui } from '@lingui/react/macro'
import { Maximize2, Minimize2, Minus, X } from 'lucide-react'
import { useCallback } from 'react'
import styled, { css } from 'styled-components'

import { ComposeForm } from '#/components/emails/compose-form'
import { type Draft, useComposeEmail } from '#/context/compose-email-context'
import {
	agedPaperSurface,
	brushedMetalPlate,
	maskingTapeCorner,
	stenciledTitle,
} from '#/lib/workshop-mixins'

/**
 * Floating clipboard that wraps one draft. The dock owns positioning
 * (bottom-right stack on desktop, bottom sheet on mobile); this component
 * owns the chrome and mounts the form body.
 */
export function ComposeWindow({ draft }: { readonly draft: Draft }) {
	const { t } = useLingui()
	const { minimize, toggleFullscreen, close, focus } = useComposeEmail()

	const handleMinimize = useCallback(() => {
		minimize(draft.id)
	}, [minimize, draft.id])

	const handleFullscreen = useCallback(() => {
		toggleFullscreen(draft.id)
	}, [toggleFullscreen, draft.id])

	const handleClose = useCallback(() => {
		close(draft.id)
	}, [close, draft.id])

	const handleFocus = useCallback(() => {
		focus(draft.id)
	}, [focus, draft.id])

	const titleText = titleFor(draft, t)
	const previewText = previewFor(draft)
	const isFullscreen = draft.windowState === 'fullscreen'

	return (
		<Shell
			$fullscreen={isFullscreen}
			onMouseDown={handleFocus}
			role='dialog'
			aria-label={titleText}
		>
			<Header>
				<TapeCorner aria-hidden />
				<HeaderTitle>
					<TitleText>{titleText}</TitleText>
					{previewText !== null && <Preview>{previewText}</Preview>}
				</HeaderTitle>
				<HeaderActions>
					<ChromeButton
						type='button'
						onClick={handleMinimize}
						aria-label={t`Minimize`}
					>
						<Minus size={14} aria-hidden />
					</ChromeButton>
					<ChromeButton
						type='button'
						onClick={handleFullscreen}
						aria-label={isFullscreen ? t`Exit full screen` : t`Full screen`}
					>
						{isFullscreen ? (
							<Minimize2 size={14} aria-hidden />
						) : (
							<Maximize2 size={14} aria-hidden />
						)}
					</ChromeButton>
					<ChromeButton
						type='button'
						onClick={handleClose}
						aria-label={t`Close draft`}
					>
						<X size={14} aria-hidden />
					</ChromeButton>
				</HeaderActions>
			</Header>
			<Body>
				<ComposeForm draft={draft} />
			</Body>
		</Shell>
	)
}

function titleFor(draft: Draft, t: ReturnType<typeof useLingui>['t']): string {
	if (draft.mode === 'reply') {
		const subject = draft.form.subject.trim()
		if (subject !== '') return t`Reply: ${subject}`
		return t`Reply`
	}
	const subject = draft.form.subject.trim()
	if (subject !== '') return subject
	return t`New message`
}

function previewFor(draft: Draft): string | null {
	if (draft.mode === 'reply') return null
	const to = draft.form.to.trim()
	if (to === '') return null
	return to
}

const Shell = styled.div.withConfig({
	displayName: 'ComposeWindowShell',
	shouldForwardProp: prop => prop !== '$fullscreen',
})<{ $fullscreen: boolean }>`
	${agedPaperSurface}
	display: flex;
	flex-direction: column;
	pointer-events: auto;
	border-radius: var(--shape-sm);
	overflow: hidden;
	box-shadow: var(--elevation-workshop-lg, 0 18px 40px rgba(0, 0, 0, 0.28));

	${p =>
		p.$fullscreen
			? css`
					position: fixed;
					inset: var(--space-md);
					width: auto;
					height: auto;
					z-index: 60;
				`
			: css`
					width: min(480px, 96vw);
					height: 560px;
					max-height: 80vh;

					@media (max-width: 767px) {
						width: 96vw;
						height: 84vh;
					}
				`}
`

const Header = styled.header.withConfig({
	displayName: 'ComposeWindowHeader',
})`
	${brushedMetalPlate}
	position: relative;
	display: flex;
	align-items: center;
	gap: var(--space-sm);
	padding: var(--space-2xs) var(--space-sm);
	padding-top: var(--space-sm);
	flex: 0 0 auto;
`

const TapeCorner = styled.span.withConfig({
	displayName: 'ComposeWindowTape',
})`
	${maskingTapeCorner}
	top: -10px;
	left: 20px;
	width: 56px;
	height: 18px;
`

const HeaderTitle = styled.div.withConfig({
	displayName: 'ComposeWindowHeaderTitle',
})`
	display: flex;
	flex-direction: column;
	gap: 2px;
	min-width: 0;
	flex: 1 1 auto;
`

const TitleText = styled.span.withConfig({
	displayName: 'ComposeWindowTitleText',
})`
	${stenciledTitle}
	font-size: var(--typescale-label-medium-size);
	letter-spacing: 0.1em;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
`

const Preview = styled.span.withConfig({
	displayName: 'ComposeWindowPreview',
})`
	font-family: var(--font-body);
	font-size: var(--typescale-label-small-size);
	color: var(--color-on-surface-variant);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
`

const HeaderActions = styled.div.withConfig({
	displayName: 'ComposeWindowActions',
})`
	display: inline-flex;
	gap: var(--space-3xs);
	flex: 0 0 auto;
`

const ChromeButton = styled.button.withConfig({
	displayName: 'ComposeWindowChromeButton',
})`
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 1.75rem;
	height: 1.75rem;
	padding: 0;
	background: transparent;
	border: 1px solid transparent;
	border-radius: var(--shape-2xs);
	color: var(--color-on-surface);
	cursor: pointer;
	transition:
		background 120ms ease,
		border-color 120ms ease;

	&:hover {
		background: color-mix(in oklab, var(--color-on-surface) 12%, transparent);
		border-color: rgba(0, 0, 0, 0.25);
	}

	&:focus-visible {
		outline: none;
		box-shadow: var(--glow-active);
	}
`

const Body = styled.div.withConfig({
	displayName: 'ComposeWindowBody',
})`
	display: flex;
	flex-direction: column;
	flex: 1 1 auto;
	min-height: 0;
`

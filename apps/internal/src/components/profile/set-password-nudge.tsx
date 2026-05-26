import { Trans } from '@lingui/react/macro'
import { useNavigate } from '@tanstack/react-router'
import { KeyRound, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import styled from 'styled-components'

import { PriButton } from '@batuda/ui/pri'

import {
	fetchSecurityState,
	type SecurityState,
	setPasswordOptOut,
} from '#/lib/security-state'
import {
	agedPaperSurface,
	brushedMetalBezel,
	maskingTapeCorner,
	stenciledTitle,
} from '#/lib/workshop-mixins'

const DISMISS_STORAGE_KEY = 'batuda.set-password-nudge-dismissed'

interface DismissEntry {
	readonly userKey: string
	readonly until: number
}

/**
 * Reminds passwordless users they can bind a password without forcing it.
 * Three escape paths so the prompt never overstays its welcome:
 *   - "Set password" routes to /settings/profile (where the form lives).
 *   - "I prefer passwordless" persists a server-side opt-out — silences
 *     the nudge on every device.
 *   - "Maybe later" stores a local 24h dismissal — quieter, auto-expires.
 *
 * Renders nothing during SSR so the localStorage read can't trigger a
 * hydration mismatch.
 */
export function SetPasswordNudge() {
	const navigate = useNavigate()
	const [state, setState] = useState<SecurityState | null>(null)
	const [dismissedLocally, setDismissedLocally] = useState(false)
	const [busy, setBusy] = useState(false)

	useEffect(() => {
		let active = true
		void (async () => {
			const result = await fetchSecurityState(undefined)
			if (!active) return
			setState(result)
			if (result && !result.hasPassword && !result.passwordOptOut) {
				setDismissedLocally(isLocallyDismissed())
			}
		})()
		return () => {
			active = false
		}
	}, [])

	if (!state) return null
	if (state.hasPassword || state.passwordOptOut) return null
	if (dismissedLocally) return null

	const handleSetPassword = async () => {
		await navigate({ to: '/settings/profile' })
	}

	const handleOptOut = async () => {
		setBusy(true)
		const ok = await setPasswordOptOut(true)
		setBusy(false)
		if (ok) {
			setState({ ...state, passwordOptOut: true })
		}
	}

	const handleDismiss = () => {
		persistLocalDismiss()
		setDismissedLocally(true)
	}

	return (
		<Banner role='status' data-testid='set-password-nudge'>
			<Tape aria-hidden />
			<Bezel aria-hidden>
				<KeyRound size={18} />
			</Bezel>
			<BannerCopy>
				<BannerTitle>
					<Trans>You got in from a link in your email.</Trans>
				</BannerTitle>
				<BannerBody>
					<Trans>
						Set a password so you don't have to check your email next time.
					</Trans>
				</BannerBody>
			</BannerCopy>
			<BannerActions>
				<PriButton
					type='button'
					$variant='filled'
					onClick={handleSetPassword}
					disabled={busy}
					data-testid='set-password-nudge-go'
				>
					<Trans>Set password</Trans>
				</PriButton>
				<TextButton
					type='button'
					onClick={handleOptOut}
					disabled={busy}
					data-testid='set-password-nudge-opt-out'
				>
					<Trans>I prefer passwordless</Trans>
				</TextButton>
				<DismissButton
					type='button'
					onClick={handleDismiss}
					aria-label='Dismiss'
					data-testid='set-password-nudge-dismiss'
				>
					<X size={16} />
				</DismissButton>
			</BannerActions>
		</Banner>
	)
}

function isLocallyDismissed(): boolean {
	if (typeof window === 'undefined') return false
	try {
		const raw = window.localStorage.getItem(DISMISS_STORAGE_KEY)
		if (!raw) return false
		const parsed = JSON.parse(raw) as Partial<DismissEntry>
		if (typeof parsed.until !== 'number') return false
		return parsed.until > Date.now()
	} catch {
		return false
	}
}

function persistLocalDismiss(): void {
	if (typeof window === 'undefined') return
	const entry: DismissEntry = {
		userKey: 'current',
		until: Date.now() + 24 * 60 * 60 * 1000,
	}
	try {
		window.localStorage.setItem(DISMISS_STORAGE_KEY, JSON.stringify(entry))
	} catch {
		// Ignore quota or privacy-mode errors; nudge will reappear after reload.
	}
}

const Banner = styled.section.withConfig({
	displayName: 'SetPasswordNudge',
})`
	${agedPaperSurface}
	position: relative;
	display: flex;
	align-items: center;
	gap: var(--space-md);
	padding: var(--space-md) var(--space-lg);
	flex-wrap: wrap;
	color: var(--color-on-surface);
`

const Tape = styled.span.withConfig({ displayName: 'SetPasswordNudgeTape' })`
	${maskingTapeCorner}
`

const Bezel = styled.span.withConfig({ displayName: 'SetPasswordNudgeBezel' })`
	${brushedMetalBezel}
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 2.5rem;
	height: 2.5rem;
	border-radius: 50%;
	color: var(--color-on-surface);
	flex-shrink: 0;
`

const BannerCopy = styled.div.withConfig({
	displayName: 'SetPasswordNudgeCopy',
})`
	display: flex;
	flex-direction: column;
	gap: var(--space-3xs);
	flex: 1 1 240px;
	min-width: 240px;
`

const BannerTitle = styled.p.withConfig({
	displayName: 'SetPasswordNudgeTitle',
})`
	${stenciledTitle}
	margin: 0;
	font-size: var(--typescale-title-small-size);
	line-height: var(--typescale-title-small-line);
`

const BannerBody = styled.p.withConfig({
	displayName: 'SetPasswordNudgeBody',
})`
	margin: 0;
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	line-height: var(--typescale-body-medium-line);
	color: var(--color-on-surface-variant);
	font-style: italic;
`

const BannerActions = styled.div.withConfig({
	displayName: 'SetPasswordNudgeActions',
})`
	display: flex;
	align-items: center;
	gap: var(--space-sm);
	flex-wrap: wrap;
`

const TextButton = styled.button.withConfig({
	displayName: 'SetPasswordNudgeTextButton',
})`
	background: none;
	border: none;
	padding: var(--space-2xs) 0;
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface-variant);
	cursor: pointer;
	text-decoration: underline;

	&:hover:not(:disabled) {
		color: var(--color-on-surface);
	}

	&:disabled {
		cursor: not-allowed;
		opacity: 0.6;
	}
`

const DismissButton = styled.button.withConfig({
	displayName: 'SetPasswordNudgeDismissButton',
})`
	background: none;
	border: none;
	padding: var(--space-2xs);
	display: inline-flex;
	align-items: center;
	justify-content: center;
	color: var(--color-on-surface-variant);
	cursor: pointer;
	border-radius: var(--shape-2xs);

	&:hover {
		color: var(--color-on-surface);
		background: color-mix(in srgb, var(--color-on-surface) 8%, transparent);
	}
`

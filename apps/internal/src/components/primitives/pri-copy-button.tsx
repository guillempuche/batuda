import { useLingui } from '@lingui/react/macro'
import { Check, Copy } from 'lucide-react'
import { useState } from 'react'
import styled from 'styled-components'

import { usePriToast } from '@batuda/ui/pri'

export function PriCopyButton({
	text,
	label,
	className,
	testId,
}: {
	readonly text: string
	readonly label: string
	readonly className?: string
	readonly testId?: string
}) {
	const { t } = useLingui()
	const toastManager = usePriToast()
	const [copied, setCopied] = useState(false)

	const onCopy = async () => {
		try {
			await navigator.clipboard.writeText(text)
			setCopied(true)
			// Revert the check icon back to the copy icon shortly after.
			setTimeout(() => setCopied(false), 1500)
		} catch {
			toastManager.add({
				title: t`Couldn't copy`,
				description: t`Select the text and copy it manually.`,
				type: 'error',
			})
		}
	}

	return (
		<>
			<Button
				type='button'
				className={className}
				data-testid={testId}
				aria-label={t`Copy ${label}`}
				onClick={() => void onCopy()}
			>
				{copied ? (
					<Check size={14} aria-hidden />
				) : (
					<Copy size={14} aria-hidden />
				)}
			</Button>
			{/* Announces the copy to screen readers; the icon swap is silent to them. */}
			<SrOnly role='status' aria-live='polite'>
				{copied ? t`Copied ${label}` : ''}
			</SrOnly>
		</>
	)
}

const Button = styled.button.withConfig({ displayName: 'PriCopyButton' })`
	display: inline-flex;
	align-items: center;
	justify-content: center;
	cursor: pointer;
	color: var(--color-on-surface-variant);

	&:hover {
		color: var(--color-primary);
	}

	&:focus-visible {
		outline: none;
		box-shadow: var(--glow-active);
	}
`

const SrOnly = styled.span.withConfig({ displayName: 'PriCopySrOnly' })`
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

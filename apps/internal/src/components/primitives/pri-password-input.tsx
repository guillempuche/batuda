import { useLingui } from '@lingui/react/macro'
import { Eye, EyeOff } from 'lucide-react'
import {
	type ComponentProps,
	forwardRef,
	useCallback,
	useRef,
	useState,
} from 'react'
import styled from 'styled-components'

import { PriInput } from '@batuda/ui/pri'

type InputElement = HTMLInputElement

interface PriPasswordInputProps
	extends Omit<ComponentProps<typeof PriInput>, 'type'> {
	/**
	 * Optional override for the toggle's `aria-label`. Defaults to a
	 * localized "Show password" / "Hide password" pair so screen readers
	 * announce the action and state.
	 */
	readonly showToggleAriaLabel?: {
		readonly show: string
		readonly hide: string
	}
	/**
	 * Optional `data-testid` for the toggle button. The text input itself
	 * keeps whatever testid the caller passes via `data-testid` on the
	 * component. If omitted, the toggle's testid is the input's testid plus
	 * `-show-toggle` when the input testid is present.
	 */
	readonly toggleTestId?: string
}

/**
 * Password input with a per-instance show/hide toggle. Toggling reveals the
 * password only inside this field — sibling password inputs (e.g. confirm
 * or current-password) keep their own state so a reveal never cascades.
 */
export const PriPasswordInput = forwardRef<InputElement, PriPasswordInputProps>(
	function PriPasswordInput(
		{ showToggleAriaLabel, toggleTestId, ...inputProps },
		forwardedRef,
	) {
		const { t } = useLingui()
		const [shown, setShown] = useState(false)
		const innerRef = useRef<InputElement | null>(null)

		const setRef = useCallback(
			(node: InputElement | null) => {
				innerRef.current = node
				if (typeof forwardedRef === 'function') {
					forwardedRef(node)
				} else if (forwardedRef) {
					forwardedRef.current = node
				}
			},
			[forwardedRef],
		)

		const handleToggle = useCallback(() => {
			// Snapshot the caret + focus before swapping `type` because some
			// browsers reset selection when an input's type changes underneath
			// it. Restore on the next tick.
			const input = innerRef.current
			const hadFocus = input === document.activeElement
			const selectionStart = input?.selectionStart ?? null
			const selectionEnd = input?.selectionEnd ?? null

			setShown(previous => !previous)

			if (!input) return
			requestAnimationFrame(() => {
				if (hadFocus) {
					input.focus()
				}
				if (selectionStart !== null && selectionEnd !== null) {
					try {
						input.setSelectionRange(selectionStart, selectionEnd)
					} catch {
						// setSelectionRange throws on some input types in older
						// browsers; the focus is enough so the user is not lost.
					}
				}
			})
		}, [])

		const inputTestId =
			'data-testid' in inputProps
				? (inputProps['data-testid'] as string | undefined)
				: undefined
		const computedToggleTestId =
			toggleTestId ?? (inputTestId ? `${inputTestId}-show-toggle` : undefined)

		const ariaShow = showToggleAriaLabel?.show ?? t`Show password`
		const ariaHide = showToggleAriaLabel?.hide ?? t`Hide password`

		return (
			<Wrapper>
				<PriInput
					{...inputProps}
					ref={setRef}
					type={shown ? 'text' : 'password'}
				/>
				<ToggleButton
					type='button'
					aria-pressed={shown}
					aria-label={shown ? ariaHide : ariaShow}
					onClick={handleToggle}
					tabIndex={0}
					{...(computedToggleTestId
						? { 'data-testid': computedToggleTestId }
						: {})}
				>
					{shown ? <EyeOff size={16} /> : <Eye size={16} />}
				</ToggleButton>
			</Wrapper>
		)
	},
)

const Wrapper = styled.div.withConfig({ displayName: 'PriPasswordInputWrap' })`
	position: relative;
	display: flex;
	align-items: stretch;

	/* Reserve room on the right so the typed value never sits underneath
	   the eye icon, even at the longest realistic password length. */
	> input {
		padding-right: calc(var(--space-md) + 24px);
	}
`

const ToggleButton = styled.button.withConfig({
	displayName: 'PriPasswordToggle',
})`
	position: absolute;
	top: 50%;
	right: var(--space-2xs);
	transform: translateY(-50%);
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 28px;
	height: 28px;
	padding: 0;
	background: transparent;
	border: none;
	border-radius: var(--shape-2xs);
	color: var(--color-on-surface-variant);
	cursor: pointer;
	transition:
		color 120ms ease,
		background 120ms ease;

	&:hover {
		color: var(--color-on-surface);
		background: color-mix(in srgb, var(--color-on-surface) 8%, transparent);
	}

	&:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 2px;
	}

	&[aria-pressed='true'] {
		color: var(--color-primary);
	}
`

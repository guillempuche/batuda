import { Dialog } from '@base-ui/react/dialog'
import { type ComponentProps, type RefObject, useEffect, useRef } from 'react'
import styled from 'styled-components'

/**
 * Workshop dialog — clipboard work order: aged cream paper + cross-hatch
 * desk bg, tape strips top corners, brushed-metal binder clip top-center.
 * Backdrop is warm graphite.
 */
const PriBackdrop = styled(Dialog.Backdrop).withConfig({
	displayName: 'PriDialogBackdrop',
})`
	position: fixed;
	inset: 0;
	background: var(--color-scrim);
	backdrop-filter: blur(2px);
	transition: opacity 240ms ease;

	&[data-starting-style],
	&[data-ending-style] {
		opacity: 0;
	}
`

const StyledPopup = styled(Dialog.Popup).withConfig({
	displayName: 'PriDialogPopup',
})`
	position: fixed;
	top: 50%;
	left: 50%;
	transform: translate(-50%, -50%);
	max-width: min(34rem, calc(100vw - var(--space-xl)));
	width: 100%;
	max-height: calc(100dvh - var(--space-3xl));
	overflow-y: auto;
	background:
		linear-gradient(
			180deg,
			var(--shadow-color-subtle) 0%,
			transparent 24px,
			transparent 100%
		),
		repeating-linear-gradient(
			45deg,
			color-mix(in oklab, var(--color-primary) 3%, transparent) 0 1px,
			transparent 1px 12px
		),
		repeating-linear-gradient(
			-45deg,
			color-mix(in oklab, var(--color-secondary) 3%, transparent) 0 1px,
			transparent 1px 12px
		),
		var(--color-paper-aged);
	color: var(--color-on-surface);
	border: 1px solid color-mix(in oklab, var(--color-outline) 50%, transparent);
	border-radius: 2px;
	padding: calc(var(--space-2xl) + 0.25rem) var(--space-xl) var(--space-xl);
	display: flex;
	flex-direction: column;
	gap: var(--space-md);
	box-shadow:
		0 2px 0 var(--highlight-inset-strong) inset,
		0 6px 18px var(--shadow-color-deep),
		0 24px 60px var(--shadow-color-deep);
	transform-origin: top center;
	transition:
		transform 260ms cubic-bezier(0.22, 1.2, 0.4, 1),
		opacity 200ms ease;

	&::before {
		content: '';
		position: absolute;
		top: -10px;
		left: 50%;
		transform: translateX(-50%);
		width: 64px;
		height: 22px;
		background: linear-gradient(
			145deg,
			var(--color-metal-light) 0%,
			var(--color-metal) 50%,
			var(--color-metal-dark) 100%
		);
		border: 1px solid var(--color-metal-edge);
		border-radius: 3px;
		box-shadow:
			inset 0 1px 0 var(--highlight-inset-bright),
			0 2px 4px var(--shadow-color-deep);
	}

	&::after {
		content: '';
		position: absolute;
		top: -1px;
		left: 50%;
		transform: translateX(-50%);
		width: 18px;
		height: 8px;
		background: var(--color-metal-deep);
		border-radius: 0 0 3px 3px;
		box-shadow: inset 0 -1px 0 var(--shadow-color-deep);
	}

	&[data-starting-style],
	&[data-ending-style] {
		opacity: 0;
		transform: translate(-50%, calc(-50% - 18px)) rotate(-0.6deg);
	}

	/*
	 * Opt-in full-screen sheet for phones (mobile="sheet"). The dialog fills the
	 * screen so the content — not the chrome — owns the viewport, and its height
	 * tracks the visual viewport (--pri-dialog-vh, set from window.visualViewport)
	 * so the on-screen keyboard shrinks the sheet instead of hiding the footer.
	 * 40rem is the app's phone breakpoint.
	 *
	 * The sheet is a fixed height, so anything taller has to scroll somewhere.
	 * A dialog that wants a footer standing still while the fields move builds
	 * its own scrolling area inside; this scrolls whatever is left over, so a
	 * form can never grow past the bottom edge and strand its buttons.
	 */
	&[data-mobile='sheet'] {
		@media (max-width: 40rem) {
			top: 0;
			left: 0;
			transform: none;
			width: 100%;
			max-width: none;
			height: var(--pri-dialog-vh, 100dvh);
			max-height: var(--pri-dialog-vh, 100dvh);
			border-radius: 0;
			/* Sideways is still clipped — a stray wide element should not turn the
			 * whole sheet into something that slides left and right under a thumb. */
			overflow-x: hidden;
			overflow-y: auto;
			overscroll-behavior: contain;
			padding: calc(env(safe-area-inset-top, 0px) + var(--space-lg))
				var(--space-lg)
				calc(env(safe-area-inset-bottom, 0px) + var(--space-md));

			/* No binder-clip on a full-bleed sheet. */
			&::before,
			&::after {
				display: none;
			}

			&[data-starting-style],
			&[data-ending-style] {
				opacity: 0;
				transform: translateY(2rem);
			}
		}
	}

	/*
	 * Opt-in bottom action sheet for phones (mobile="action-sheet"). Anchored to
	 * the bottom, auto-height, sliding up — a reachable spot for a confirm or
	 * menu. Rounded only at the top; no binder-clip.
	 */
	&[data-mobile='action-sheet'] {
		@media (max-width: 40rem) {
			top: auto;
			bottom: 0;
			left: 0;
			transform: none;
			width: 100%;
			max-width: none;
			max-height: 85dvh;
			border-radius: var(--shape-md) var(--shape-md) 0 0;
			padding: var(--space-xl) var(--space-lg)
				calc(env(safe-area-inset-bottom, 0px) + var(--space-lg));

			&::before,
			&::after {
				display: none;
			}

			&[data-starting-style],
			&[data-ending-style] {
				opacity: 0;
				transform: translateY(100%);
			}
		}
	}

	/*
	 * Motion-sensitive users get the fade without the slide/scale: pin the
	 * enter/leave transform to each layout's resting position so only opacity
	 * animates.
	 */
	@media (prefers-reduced-motion: reduce) {
		&[data-starting-style],
		&[data-ending-style] {
			transform: translate(-50%, -50%);
		}

		&[data-mobile='sheet'],
		&[data-mobile='action-sheet'] {
			@media (max-width: 40rem) {
				&[data-starting-style],
				&[data-ending-style] {
					transform: none;
				}
			}
		}
	}
`

const PriTitle = styled(Dialog.Title).withConfig({
	displayName: 'PriDialogTitle',
})`
	font-family: var(--font-display);
	font-size: var(--typescale-title-large-size);
	line-height: var(--typescale-title-large-line);
	font-weight: var(--font-weight-bold);
	color: var(--color-on-surface);
	margin: 0;
	text-transform: uppercase;
	letter-spacing: 0.06em;
	text-shadow: var(--text-shadow-emboss);
`

const PriDescription = styled(Dialog.Description).withConfig({
	displayName: 'PriDialogDescription',
})`
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	line-height: var(--typescale-body-medium-line);
	letter-spacing: var(--typescale-body-medium-tracking);
	color: var(--color-on-surface-variant);
	margin: 0;
	font-style: italic;
`

// While the sheet is open, mirror the visual viewport's height onto the popup so
// the sheet shrinks with the on-screen keyboard (keeping the footer + caret
// visible) instead of being overlapped by it. No-op off `sheet` and on servers.
function useSheetViewportHeight(
	ref: RefObject<HTMLElement | null>,
	enabled: boolean,
) {
	useEffect(() => {
		const viewport =
			typeof window === 'undefined' ? undefined : window.visualViewport
		const el = ref.current
		if (!enabled || !viewport || !el) return
		const apply = () => {
			el.style.setProperty('--pri-dialog-vh', `${viewport.height}px`)
			// The keyboard eats a big chunk of the layout viewport; flag it so the
			// sheet can drop secondary chrome (description) and give the editor the
			// reclaimed room.
			if (window.innerHeight - viewport.height > 120) {
				el.setAttribute('data-keyboard', 'open')
			} else {
				el.removeAttribute('data-keyboard')
			}
		}
		apply()
		viewport.addEventListener('resize', apply)
		viewport.addEventListener('scroll', apply)
		return () => {
			viewport.removeEventListener('resize', apply)
			viewport.removeEventListener('scroll', apply)
			el.style.removeProperty('--pri-dialog-vh')
			el.removeAttribute('data-keyboard')
		}
	}, [enabled, ref])
}

// `mobile` opts the dialog into a phone-specific layout: "sheet" is a
// full-screen, keyboard-aware editor surface; "action-sheet" is a bottom-
// anchored, auto-height panel for confirmations and menus (buttons in the
// thumb zone). Omit it and the dialog stays a centered modal on every screen.
function PriPopup({
	mobile,
	...props
}: ComponentProps<typeof StyledPopup> & {
	readonly mobile?: 'sheet' | 'action-sheet'
}) {
	const ref = useRef<HTMLDivElement>(null)
	// Only the full-screen sheet tracks the keyboard; an action sheet is short
	// and bottom-anchored, so it needs no viewport binding.
	useSheetViewportHeight(ref, mobile === 'sheet')
	return <StyledPopup ref={ref} data-mobile={mobile} {...props} />
}

export const PriDialog = {
	Root: Dialog.Root,
	Trigger: Dialog.Trigger,
	Portal: Dialog.Portal,
	Close: Dialog.Close,
	Viewport: Dialog.Viewport,
	Backdrop: PriBackdrop,
	Popup: PriPopup,
	Title: PriTitle,
	Description: PriDescription,
}

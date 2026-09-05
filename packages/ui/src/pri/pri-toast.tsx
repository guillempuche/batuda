import { Toast } from '@base-ui/react/toast'
import { styled } from 'next-yak'

/**
 * Workshop toast — clipboard note: aged paper card with a masking tape
 * corner + a binder clip up top. Slides in from the bottom-right.
 *
 * Mount `<PriToast.Provider>` high in the tree and one viewport holding the list
 * at app chrome — `<PriToast.Viewport><PriToast.List closeLabel={…} /></…>`. The
 * viewport alone draws an empty frame, so a toast raised into it is never seen.
 * Fire toasts via `usePriToast()`.
 */
const PriViewport = styled(Toast.Viewport)`
	position: fixed;
	bottom: var(--space-lg);
	right: var(--space-lg);
	width: min(22rem, calc(100vw - var(--space-xl)));
	z-index: 9999;
	display: flex;
	flex-direction: column-reverse;
	gap: var(--space-xs);
	pointer-events: none;
`

const PriRoot = styled(Toast.Root)`
	position: relative;
	pointer-events: auto;
	padding: var(--space-sm) var(--space-md);
	padding-top: calc(var(--space-md) + 4px);
	background:
		radial-gradient(
			ellipse 60px 40px at 18% 32%,
			var(--color-paper-fibre-a) 0%,
			transparent 100%
		),
		var(--color-paper-aged);
	color: var(--color-on-surface);
	border: 1px solid color-mix(in oklab, var(--color-outline) 40%, transparent);
	border-radius: 2px;
	box-shadow:
		0 2px 0 var(--highlight-inset-strong) inset,
		0 4px 12px var(--shadow-color-strong);
	display: flex;
	flex-direction: column;
	gap: 2px;
	transition: opacity 200ms ease;

	&[data-type='success'] {
		box-shadow:
			0 0 0 1px color-mix(in srgb, var(--color-secondary) 40%, transparent),
			0 2px 0 var(--highlight-inset-strong) inset,
			0 4px 12px var(--shadow-color-strong);
	}

	&[data-type='error'] {
		border-left: 4px solid var(--color-error);
	}

	/* Masking-tape strip at top-left */
	&::before {
		content: '';
		position: absolute;
		top: -6px;
		left: -8px;
		width: 58px;
		height: 18px;
		background: linear-gradient(
			180deg,
			var(--color-tape-light) 0%,
			var(--color-tape) 100%
		);
		border: 1px solid var(--color-metal-edge-soft);
		transform: rotate(-4deg);
		box-shadow: 0 1px 3px var(--shadow-color);
		pointer-events: none;
	}

	&[data-starting-style],
	&[data-ending-style] {
		opacity: 0;
	}
`

const PriTitle = styled(Toast.Title)`
	font-family: var(--font-display);
	font-size: var(--typescale-label-large-size);
	font-weight: var(--font-weight-bold);
	letter-spacing: 0.05em;
	text-transform: uppercase;
	text-shadow: var(--text-shadow-emboss);
	margin: 0;
`

const PriDescription = styled(Toast.Description)`
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	line-height: var(--typescale-body-small-line);
	color: var(--color-on-surface-variant);
	font-style: italic;
	margin: 0;
`

const PriClose = styled(Toast.Close)`
	position: absolute;
	top: 4px;
	right: 6px;
	padding: 2px 6px;
	background: transparent;
	border: none;
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	color: var(--color-on-surface-variant);
	cursor: pointer;

	&:hover {
		color: var(--color-on-surface);
	}
`

/**
 * The toasts currently raised, as cards. Put it inside the viewport:
 * `<PriToast.Viewport><PriToast.List closeLabel={…} /></PriToast.Viewport>`.
 *
 * The viewport draws only the frame — without something turning the manager's
 * queue into cards, `toast.add()` fills a queue nobody reads and every message
 * the app raises is silently dropped. Nothing announces them either, so a
 * screen-reader user is told nothing at all.
 *
 * The close button's label is passed in rather than written here, because this
 * package holds no translations and the apps that use it do.
 */
export function PriToastList({ closeLabel }: { readonly closeLabel: string }) {
	const { toasts } = Toast.useToastManager()
	return (
		<>
			{toasts.map(toast => (
				<PriRoot key={toast.id} toast={toast}>
					<PriTitle />
					<PriDescription />
					<PriClose aria-label={closeLabel}>×</PriClose>
				</PriRoot>
			))}
		</>
	)
}

export const PriToast: {
	Provider: typeof Toast.Provider
	Portal: typeof Toast.Portal
	Positioner: typeof Toast.Positioner
	Viewport: typeof PriViewport
	List: typeof PriToastList
	Root: typeof PriRoot
	Title: typeof PriTitle
	Description: typeof PriDescription
	Close: typeof PriClose
} = {
	Provider: Toast.Provider,
	Portal: Toast.Portal,
	Positioner: Toast.Positioner,
	Viewport: PriViewport,
	List: PriToastList,
	Root: PriRoot,
	Title: PriTitle,
	Description: PriDescription,
	Close: PriClose,
}

export const usePriToast = Toast.useToastManager
export const createPriToastManager = Toast.createToastManager

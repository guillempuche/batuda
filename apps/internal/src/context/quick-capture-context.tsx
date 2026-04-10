import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from 'react'

/**
 * Shape of the "pre-fill" payload callers pass when they want the Quick
 * Capture dialog to open with a company (and optionally a contact) already
 * selected. If `undefined` the dialog opens empty — the user picks the
 * company inside the dialog.
 *
 * `onSubmitted` is an optional callback invoked by the dialog after a
 * successful interaction-create mutation, *before* the dialog closes.
 * Pages that show company-scoped data (Company detail page, Pipeline
 * dashboard) use it to `useAtomRefresh` their stale atoms so the new
 * interaction + server-side `lastContactedAt` / `nextAction` updates
 * land on-screen without a manual reload.
 */
export type QuickCapturePrefill = {
	companyId: string
	companyName: string
	contactId?: string | undefined
	onSubmitted?: (() => void) | undefined
}

/**
 * Context shape consumed via `useQuickCapture()`.
 *
 * `open` accepts an optional prefill. `isOpen` and `prefill` reflect the
 * current dialog state and are read by the single global <QuickCaptureDialog />
 * rendered inside this provider (see `QuickCaptureProvider` below).
 */
export type QuickCaptureContextValue = {
	readonly isOpen: boolean
	readonly prefill: QuickCapturePrefill | null
	readonly open: (prefill?: QuickCapturePrefill | undefined) => void
	readonly close: () => void
}

const QuickCaptureContext = createContext<QuickCaptureContextValue | null>(null)

/**
 * Provider that owns Quick Capture open-state + prefill + the global
 * `Shift+I` keyboard shortcut. Renders the dialog itself as a child so
 * there is exactly one instance in the tree, and every caller (TopBar
 * button, CompanyCard hover action, CompanyDetail primary CTA, dashboard
 * row action) opens that shared instance.
 *
 * Why the dialog is rendered by the Provider and not by AppShell: keeping
 * open-state and the render target in the same file makes the control-flow
 * obvious — `open()` flips state, the dialog reads state from context. If
 * the dialog were rendered elsewhere it would need to `useQuickCapture()`
 * too, doubling the indirection.
 */
export function QuickCaptureProvider({
	children,
}: {
	children: React.ReactNode
}) {
	const [isOpen, setIsOpen] = useState(false)
	const [prefill, setPrefill] = useState<QuickCapturePrefill | null>(null)

	const open = useCallback((nextPrefill?: QuickCapturePrefill | undefined) => {
		setPrefill(nextPrefill ?? null)
		setIsOpen(true)
	}, [])

	const close = useCallback(() => {
		setIsOpen(false)
		// Keep prefill around for a render so close animations don't flash.
		// The dialog component resets its form on next `isOpen` transition.
	}, [])

	// Global Shift+I keyboard shortcut. Skipped while the user is typing
	// in an input/textarea/contenteditable so it doesn't interrupt editing.
	useEffect(() => {
		const handler = (event: KeyboardEvent) => {
			if (!event.shiftKey) return
			if (event.key !== 'I') return
			if (isOpen) return
			const target = event.target as HTMLElement | null
			if (target) {
				const tag = target.tagName
				if (
					tag === 'INPUT' ||
					tag === 'TEXTAREA' ||
					tag === 'SELECT' ||
					target.isContentEditable
				) {
					return
				}
			}
			event.preventDefault()
			open()
		}
		window.addEventListener('keydown', handler)
		return () => window.removeEventListener('keydown', handler)
	}, [isOpen, open])

	const value = useMemo<QuickCaptureContextValue>(
		() => ({ isOpen, prefill, open, close }),
		[isOpen, prefill, open, close],
	)

	return (
		<QuickCaptureContext.Provider value={value}>
			{children}
		</QuickCaptureContext.Provider>
	)
}

/**
 * Hook for opening (or closing) the Quick Capture dialog from anywhere
 * inside a `QuickCaptureProvider`. Throws if called outside the provider
 * so mistakes surface at dev time instead of silently no-oping.
 */
export function useQuickCapture(): QuickCaptureContextValue {
	const context = useContext(QuickCaptureContext)
	if (context === null) {
		throw new Error(
			'useQuickCapture must be used inside a <QuickCaptureProvider>',
		)
	}
	return context
}

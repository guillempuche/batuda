import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from 'react'

/**
 * Draft mode. `new` writes a fresh thread (requires inbox + to +
 * subject). `reply` replies into an existing thread (inbox + subject
 * are locked to the thread so the payload is smaller).
 */
export type DraftMode = 'new' | 'reply'

/** Window chrome state. Drafts move between these three. */
export type DraftWindowState = 'open' | 'minimized' | 'fullscreen'

/** Per-draft form fields. Reply drafts only write `body`, `cc`, `bcc`. */
export type DraftForm = {
	readonly inboxId: string | null
	readonly to: string
	readonly cc: string
	readonly bcc: string
	readonly subject: string
	readonly body: string
}

export type Draft = {
	readonly id: string
	readonly mode: DraftMode
	readonly windowState: DraftWindowState
	readonly form: DraftForm
	readonly dirty: boolean
	readonly threadId?: string
	readonly companyId?: string
	readonly contactId?: string
}

export type OpenComposeInput = {
	readonly mode: DraftMode
	readonly threadId?: string
	readonly companyId?: string
	readonly contactId?: string
	readonly inboxId?: string
	readonly to?: string
	readonly cc?: string
	readonly bcc?: string
	readonly subject?: string
	readonly body?: string
}

const EMPTY_FORM: DraftForm = {
	inboxId: null,
	to: '',
	cc: '',
	bcc: '',
	subject: '',
	body: '',
}

export type ComposeEmailContextValue = {
	readonly drafts: ReadonlyArray<Draft>
	readonly openCompose: (input: OpenComposeInput) => string
	readonly close: (id: string, options?: { readonly force?: boolean }) => void
	readonly minimize: (id: string) => void
	readonly restore: (id: string) => void
	readonly toggleFullscreen: (id: string) => void
	readonly focus: (id: string) => void
	readonly updateForm: (id: string, patch: Partial<DraftForm>) => void
	readonly markClean: (id: string) => void
}

const ComposeEmailContext = createContext<ComposeEmailContextValue | null>(null)

/**
 * Draft state for the floating compose dock. Owns the draft map, the
 * ordering (focus order moves a draft to the front), and the global
 * `Shift+E` keyboard shortcut. The dock and each compose window read
 * from this context so there is a single source of truth for draft
 * state even as the user navigates between routes.
 *
 * Drafts do not auto-save in v1. Closing a dirty draft prompts for
 * confirmation; a forced close skips the prompt (used when a send
 * succeeds). v2 will persist drafts to localStorage or the provider
 * `drafts` resource.
 */
export function ComposeEmailProvider({
	children,
}: {
	children: React.ReactNode
}) {
	const [drafts, setDrafts] = useState<ReadonlyArray<Draft>>([])

	const openCompose = useCallback((input: OpenComposeInput): string => {
		const id = generateDraftId()
		const base: DraftForm = {
			...EMPTY_FORM,
			...(input.inboxId !== undefined && { inboxId: input.inboxId }),
			...(input.to !== undefined && { to: input.to }),
			...(input.cc !== undefined && { cc: input.cc }),
			...(input.bcc !== undefined && { bcc: input.bcc }),
			...(input.subject !== undefined && { subject: input.subject }),
			...(input.body !== undefined && { body: input.body }),
		}
		const draft: Draft = {
			id,
			mode: input.mode,
			windowState: 'open',
			form: base,
			dirty: false,
			...(input.threadId !== undefined && { threadId: input.threadId }),
			...(input.companyId !== undefined && { companyId: input.companyId }),
			...(input.contactId !== undefined && { contactId: input.contactId }),
		}
		setDrafts(prev => [draft, ...prev])
		return id
	}, [])

	const close = useCallback(
		(id: string, options?: { readonly force?: boolean }) => {
			setDrafts(prev => {
				const target = prev.find(d => d.id === id)
				if (target === undefined) return prev
				if (target.dirty && options?.force !== true) {
					const ok = window.confirm(
						'Discard this draft? Unsaved changes will be lost.',
					)
					if (!ok) return prev
				}
				return prev.filter(d => d.id !== id)
			})
		},
		[],
	)

	const minimize = useCallback((id: string) => {
		setDrafts(prev =>
			prev.map(d => (d.id === id ? { ...d, windowState: 'minimized' } : d)),
		)
	}, [])

	const restore = useCallback((id: string) => {
		setDrafts(prev => {
			const target = prev.find(d => d.id === id)
			if (target === undefined) return prev
			const rest = prev.filter(d => d.id !== id)
			return [{ ...target, windowState: 'open' }, ...rest]
		})
	}, [])

	const toggleFullscreen = useCallback((id: string) => {
		setDrafts(prev =>
			prev.map(d =>
				d.id === id
					? {
							...d,
							windowState:
								d.windowState === 'fullscreen' ? 'open' : 'fullscreen',
						}
					: d,
			),
		)
	}, [])

	const focus = useCallback((id: string) => {
		setDrafts(prev => {
			const target = prev.find(d => d.id === id)
			if (target === undefined) return prev
			if (prev[0]?.id === id) return prev
			const rest = prev.filter(d => d.id !== id)
			return [target, ...rest]
		})
	}, [])

	const updateForm = useCallback((id: string, patch: Partial<DraftForm>) => {
		setDrafts(prev =>
			prev.map(d =>
				d.id === id ? { ...d, form: { ...d.form, ...patch }, dirty: true } : d,
			),
		)
	}, [])

	const markClean = useCallback((id: string) => {
		setDrafts(prev => prev.map(d => (d.id === id ? { ...d, dirty: false } : d)))
	}, [])

	// Global Shift+E shortcut for "new compose". Skipped when the user
	// is typing in an input/textarea/contenteditable so it doesn't
	// interrupt editing — matches the Shift+I pattern from Quick Capture.
	useEffect(() => {
		const handler = (event: KeyboardEvent) => {
			if (!event.shiftKey) return
			if (event.key !== 'E') return
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
			openCompose({ mode: 'new' })
		}
		window.addEventListener('keydown', handler)
		return () => {
			window.removeEventListener('keydown', handler)
		}
	}, [openCompose])

	const value = useMemo<ComposeEmailContextValue>(
		() => ({
			drafts,
			openCompose,
			close,
			minimize,
			restore,
			toggleFullscreen,
			focus,
			updateForm,
			markClean,
		}),
		[
			drafts,
			openCompose,
			close,
			minimize,
			restore,
			toggleFullscreen,
			focus,
			updateForm,
			markClean,
		],
	)

	return (
		<ComposeEmailContext.Provider value={value}>
			{children}
		</ComposeEmailContext.Provider>
	)
}

export function useComposeEmail(): ComposeEmailContextValue {
	const ctx = useContext(ComposeEmailContext)
	if (ctx === null) {
		throw new Error(
			'useComposeEmail must be used inside a <ComposeEmailProvider>',
		)
	}
	return ctx
}

function generateDraftId(): string {
	return `draft-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`
}

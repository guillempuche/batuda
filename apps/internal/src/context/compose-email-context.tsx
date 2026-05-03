import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react'

import type { EmailBlocks } from '@batuda/email/schema'

import { apiBaseUrl } from '#/lib/api-base'

export type DraftMode = 'new' | 'reply'
export type DraftWindowState = 'open' | 'minimized' | 'fullscreen'

export type Draft = {
	readonly id: string
	readonly serverId: string | null
	readonly inboxId: string
	readonly mode: DraftMode
	readonly windowState: DraftWindowState
	readonly saving: boolean
	readonly threadId?: string
	readonly companyId?: string
	readonly contactId?: string
	readonly subject: string
	readonly to: string
	readonly bodyJson?: EmailBlocks
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
	readonly bodyJson?: EmailBlocks
}

export type ComposeEmailContextValue = {
	readonly drafts: ReadonlyArray<Draft>
	readonly openCompose: (input: OpenComposeInput) => string
	readonly close: (id: string) => void
	readonly minimize: (id: string) => void
	readonly restore: (id: string) => void
	readonly toggleFullscreen: (id: string) => void
	readonly focus: (id: string) => void
	readonly updateMeta: (
		id: string,
		patch: Partial<Pick<Draft, 'serverId' | 'saving' | 'subject' | 'to'>>,
	) => void
}

const ComposeEmailContext = createContext<ComposeEmailContextValue | null>(null)

export function ComposeEmailProvider({
	children,
}: {
	children: React.ReactNode
}) {
	const [drafts, setDrafts] = useState<ReadonlyArray<Draft>>([])
	const recoveredRef = useRef(false)

	useEffect(() => {
		if (recoveredRef.current) return
		recoveredRef.current = true
		fetch(`${apiBaseUrl()}/v1/email/drafts`, { credentials: 'include' })
			.then(res => (res.ok ? res.json() : []))
			.then((serverDrafts: unknown) => {
				if (!Array.isArray(serverDrafts)) return
				setDrafts(prev => {
					const existingServerIds = new Set(
						prev.map(d => d.serverId).filter((s): s is string => s !== null),
					)
					const recovered: Draft[] = []
					for (const raw of serverDrafts) {
						if (!raw || typeof raw !== 'object') continue
						const sd = raw as Record<string, unknown>
						const draftId =
							typeof sd['draftId'] === 'string' ? sd['draftId'] : null
						if (draftId === null || existingServerIds.has(draftId)) continue
						const clientId =
							typeof sd['clientId'] === 'string' ? sd['clientId'] : undefined
						const ctx = parseClientId(clientId)
						const toRaw = sd['to']
						recovered.push({
							id: generateDraftId(),
							serverId: draftId,
							inboxId: typeof sd['inboxId'] === 'string' ? sd['inboxId'] : '',
							mode: ctx.mode === 'reply' ? 'reply' : 'new',
							windowState: 'minimized',
							saving: false,
							subject: typeof sd['subject'] === 'string' ? sd['subject'] : '',
							to:
								typeof toRaw === 'string'
									? toRaw
									: Array.isArray(toRaw)
										? toRaw.join(', ')
										: '',
							...(ctx.companyId !== null && { companyId: ctx.companyId }),
							...(ctx.contactId !== null && { contactId: ctx.contactId }),
						})
					}
					if (recovered.length === 0) return prev
					return [...prev, ...recovered]
				})
			})
			.catch(() => {})
	}, [])

	const openCompose = useCallback((input: OpenComposeInput): string => {
		const id = generateDraftId()
		const draft: Draft = {
			id,
			serverId: null,
			inboxId: input.inboxId ?? '',
			mode: input.mode,
			windowState: 'open',
			saving: false,
			subject: input.subject ?? '',
			to: input.to ?? '',
			...(input.threadId !== undefined && { threadId: input.threadId }),
			...(input.companyId !== undefined && { companyId: input.companyId }),
			...(input.contactId !== undefined && { contactId: input.contactId }),
			...(input.bodyJson !== undefined && { bodyJson: input.bodyJson }),
		}
		setDrafts(prev => [draft, ...prev])
		return id
	}, [])

	const close = useCallback((id: string) => {
		setDrafts(prev => prev.filter(d => d.id !== id))
	}, [])

	const minimize = useCallback((id: string) => {
		setDrafts(prev =>
			prev.map(d =>
				d.id === id ? { ...d, windowState: 'minimized' as const } : d,
			),
		)
	}, [])

	const restore = useCallback((id: string) => {
		setDrafts(prev => {
			const target = prev.find(d => d.id === id)
			if (target === undefined) return prev
			const rest = prev.filter(d => d.id !== id)
			return [{ ...target, windowState: 'open' as const }, ...rest]
		})
	}, [])

	const toggleFullscreen = useCallback((id: string) => {
		setDrafts(prev =>
			prev.map(d =>
				d.id === id
					? {
							...d,
							windowState:
								d.windowState === 'fullscreen'
									? ('open' as const)
									: ('fullscreen' as const),
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

	const updateMeta = useCallback(
		(
			id: string,
			patch: Partial<Pick<Draft, 'serverId' | 'saving' | 'subject' | 'to'>>,
		) => {
			setDrafts(prev => prev.map(d => (d.id === id ? { ...d, ...patch } : d)))
		},
		[],
	)

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
			updateMeta,
		}),
		[
			drafts,
			openCompose,
			close,
			minimize,
			restore,
			toggleFullscreen,
			focus,
			updateMeta,
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

function parseClientId(clientId: string | undefined): {
	companyId: string | null
	contactId: string | null
	mode: string | null
} {
	const empty = { companyId: null, contactId: null, mode: null }
	if (!clientId?.startsWith('batuda:draft')) return empty
	const result: {
		companyId: string | null
		contactId: string | null
		mode: string | null
	} = { ...empty }
	for (const part of clientId.split(';')) {
		const eq = part.indexOf('=')
		if (eq === -1) continue
		const key = part.slice(0, eq)
		const val = part.slice(eq + 1)
		if (key === 'companyId') result.companyId = val
		else if (key === 'contactId') result.contactId = val
		else if (key === 'mode') result.mode = val
	}
	return result
}

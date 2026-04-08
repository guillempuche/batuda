import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
} from 'react'

type ActiveSectionContextType = {
	activeSection: string
	observeSection: (id: string, el: HTMLElement | null) => void
	setScrollRoot: (el: HTMLElement | null) => void
}

const ActiveSectionContext = createContext<ActiveSectionContextType>({
	activeSection: 'hero',
	observeSection: () => {},
	setScrollRoot: () => {},
})

export function ActiveSectionProvider({
	children,
}: {
	children: React.ReactNode
}) {
	const [activeSection, setActiveSection] = useState('hero')
	const observerRef = useRef<IntersectionObserver | null>(null)
	const trackedRef = useRef<Map<string, HTMLElement>>(new Map())
	const scrollRootRef = useRef<HTMLElement | null>(null)

	/* Tear down the current observer and rebuild it against the active scroll
	 * root. We re-observe every previously tracked section so callers don't
	 * need to re-register when the root changes (e.g. on viewport breakpoint). */
	const buildObserver = useCallback(() => {
		if (observerRef.current) {
			observerRef.current.disconnect()
		}

		const observer = new IntersectionObserver(
			entries => {
				for (const entry of entries) {
					if (entry.isIntersecting) {
						const id = entry.target.getAttribute('data-section-id')
						if (id) setActiveSection(id)
					}
				}
			},
			{
				root: scrollRootRef.current,
				threshold: 0,
				rootMargin: '-10% 0px -80% 0px',
			},
		)

		observerRef.current = observer
		for (const el of trackedRef.current.values()) {
			observer.observe(el)
		}
		return observer
	}, [])

	const getObserver = useCallback(() => {
		return observerRef.current ?? buildObserver()
	}, [buildObserver])

	const observeSection = useCallback(
		(id: string, el: HTMLElement | null) => {
			const observer = getObserver()
			const prev = trackedRef.current.get(id)
			if (prev) observer.unobserve(prev)

			if (el) {
				el.setAttribute('data-section-id', id)
				observer.observe(el)
				trackedRef.current.set(id, el)
			} else {
				trackedRef.current.delete(id)
			}
		},
		[getObserver],
	)

	const setScrollRoot = useCallback(
		(el: HTMLElement | null) => {
			if (scrollRootRef.current === el) return
			scrollRootRef.current = el
			/* Rebuild observer against the new root if we already have tracked
			 * sections — otherwise it'll be created lazily on first observe. */
			if (observerRef.current || trackedRef.current.size > 0) {
				buildObserver()
			}
		},
		[buildObserver],
	)

	useEffect(() => {
		return () => {
			observerRef.current?.disconnect()
			observerRef.current = null
		}
	}, [])

	return (
		<ActiveSectionContext.Provider
			value={{ activeSection, observeSection, setScrollRoot }}
		>
			{children}
		</ActiveSectionContext.Provider>
	)
}

export function useActiveSection() {
	return useContext(ActiveSectionContext).activeSection
}

export function useSectionRef(id: string) {
	const { observeSection } = useContext(ActiveSectionContext)
	return useCallback(
		(el: HTMLElement | null) => observeSection(id, el),
		[id, observeSection],
	)
}

export function useScrollRootRef() {
	const { setScrollRoot } = useContext(ActiveSectionContext)
	return useCallback(
		(el: HTMLElement | null) => setScrollRoot(el),
		[setScrollRoot],
	)
}

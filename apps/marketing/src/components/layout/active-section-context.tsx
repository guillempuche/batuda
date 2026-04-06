import { createContext, useCallback, useContext, useRef, useState } from 'react'

type ActiveSectionContextType = {
	activeSection: string
	observeSection: (id: string, el: HTMLElement | null) => void
}

const ActiveSectionContext = createContext<ActiveSectionContextType>({
	activeSection: 'hero',
	observeSection: () => {},
})

export function ActiveSectionProvider({
	children,
}: {
	children: React.ReactNode
}) {
	const [activeSection, setActiveSection] = useState('hero')
	const observerRef = useRef<IntersectionObserver | null>(null)
	const trackedRef = useRef<Map<string, HTMLElement>>(new Map())

	const getObserver = useCallback(() => {
		if (observerRef.current) return observerRef.current

		observerRef.current = new IntersectionObserver(
			entries => {
				for (const entry of entries) {
					if (entry.isIntersecting) {
						const id = entry.target.getAttribute('data-section-id')
						if (id) setActiveSection(id)
					}
				}
			},
			{ threshold: 0, rootMargin: '-10% 0px -80% 0px' },
		)
		return observerRef.current
	}, [])

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

	return (
		<ActiveSectionContext.Provider value={{ activeSection, observeSection }}>
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

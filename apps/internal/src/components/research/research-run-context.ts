import { createContext, useContext } from 'react'

// The current run's id, shared with deeply-nested findings sections (paid
// actions) so they can resolve against it without every schema view threading
// the id through as a prop. Null outside a run page — consumers then hide any
// run-scoped actions.
const ResearchRunIdContext = createContext<string | null>(null)

export const ResearchRunIdProvider = ResearchRunIdContext.Provider

export function useResearchRunId(): string | null {
	return useContext(ResearchRunIdContext)
}

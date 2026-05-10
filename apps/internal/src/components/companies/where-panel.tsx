import { ClientOnly } from '@tanstack/react-router'
import { type ComponentProps, lazy, Suspense } from 'react'

import type { WherePanel as WherePanelClient } from './where-panel-client.client'

// Leaflet and react-leaflet touch `window` at module-load time, so the
// implementation lives in a `.client.tsx` file. TanStack Start's import
// protection blocks `**/*.client.*` from the SSR environment, and `lazy`
// keeps the dynamic import in its own client chunk; `<ClientOnly>` gates
// rendering until after hydration.
const Lazy = lazy(() =>
	import('./where-panel-client.client').then(m => ({ default: m.WherePanel })),
)

export function WherePanel(props: ComponentProps<typeof WherePanelClient>) {
	return (
		<ClientOnly fallback={null}>
			<Suspense fallback={null}>
				<Lazy {...props} />
			</Suspense>
		</ClientOnly>
	)
}

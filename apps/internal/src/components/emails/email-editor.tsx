import { ClientOnly } from '@tanstack/react-router'
import { type ComponentProps, lazy, Suspense } from 'react'

import type { EmailEditor as EmailEditorClient } from './email-editor.client'

// The editor only ever runs in a browser, and a plain import drags its whole
// toolchain — an HTML renderer, a code formatter, a CSS builder — into the
// server bundle, which has a hard size ceiling. TanStack Start's import
// protection keeps `.client.tsx` files out of that bundle, `lazy` gives the
// editor its own browser-only chunk, and `<ClientOnly>` holds off rendering
// until the page is interactive.
const Lazy = lazy(() =>
	import('./email-editor.client').then(m => ({ default: m.EmailEditor })),
)

export function EmailEditor(props: ComponentProps<typeof EmailEditorClient>) {
	return (
		<ClientOnly fallback={null}>
			<Suspense fallback={null}>
				<Lazy {...props} />
			</Suspense>
		</ClientOnly>
	)
}

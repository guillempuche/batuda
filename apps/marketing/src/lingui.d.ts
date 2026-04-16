/**
 * `@lingui/vite-plugin` turns `.po` imports into a module whose
 * `messages` export is the compiled catalog object. TypeScript
 * doesn't know about the `.po` extension natively, so we declare
 * the shape here. The plugin also handles `.po?lingui` for
 * alternate formats, but marketing only uses plain `.po`.
 */
declare module '*.po' {
	import type { Messages } from '@lingui/core'

	export const messages: Messages
}

import { type I18n, type Messages, setupI18n } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import { I18nProvider } from '@lingui/react'
import { type ReactNode, useMemo } from 'react'

import { messages as caMessages } from '../locales/ca/messages.po'
import { messages as enMessages } from '../locales/en/messages.po'
import type { LangCode } from './index'

/* Both catalogs are imported eagerly at module init. The bundles are
 * small (Forja has at most a few hundred short strings) and eager
 * imports keep SSR synchronous — no dynamic-import roundtrip on first
 * render, no locale-swap jank mid-hydration. */
const catalogs: Record<LangCode, Messages> = {
	en: enMessages,
	ca: caMessages,
}

/* Build a request-scoped `I18n` instance for one locale. Forja now
 * supports per-user locale, so a shared `i18n.activate(...)` singleton
 * is unsafe under concurrent SSR requests — `setupI18n` hands back an
 * isolated instance each time. */
export function makeI18n(lang: LangCode): I18n {
	return setupI18n({
		locale: lang,
		messages: { [lang]: catalogs[lang] },
	})
}

/* Render-tree wrapper. Memoises the i18n instance per `lang` so
 * client-side language swaps don't rebuild the catalog tables on every
 * render. On the server each request gets its own tree, so the memo
 * still resolves to a request-scoped instance. */
export function LinguiProvider({
	lang,
	children,
}: {
	lang: LangCode
	children: ReactNode
}) {
	const i18n = useMemo(() => makeI18n(lang), [lang])
	return <I18nProvider i18n={i18n}>{children}</I18nProvider>
}

/* Prebuilt translations for `<head>` metadata. TanStack Router's `head`
 * option runs synchronously per request and doesn't have access to the
 * React context, so we can't call `useLingui()` inside it. Instead, we
 * resolve every locale's head strings once at module load using a
 * dedicated i18n instance per locale — lookup cost at request time is a
 * single object access. */
const headInstances: Record<LangCode, I18n> = {
	en: makeI18n('en'),
	ca: makeI18n('ca'),
}

const titleMsg = msg`Forja — Engranatge CRM`
const descriptionMsg = msg`Forja — Engranatge's internal sales CRM.`

export const translatedHead: Record<
	LangCode,
	{ title: string; description: string }
> = {
	en: {
		title: headInstances.en._(titleMsg),
		description: headInstances.en._(descriptionMsg),
	},
	ca: {
		title: headInstances.ca._(titleMsg),
		description: headInstances.ca._(descriptionMsg),
	},
}

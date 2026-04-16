import { type I18n, type Messages, setupI18n } from '@lingui/core'
import { I18nProvider } from '@lingui/react'
import { type ReactNode, useMemo } from 'react'

import { messages as caMessages } from '../locales/ca/messages.po'
import { messages as enMessages } from '../locales/en/messages.po'
import { messages as esMessages } from '../locales/es/messages.po'
import type { LangCode } from './index'

/* All three catalogs are imported eagerly at module init. The bundles are
 * small (marketing has a few hundred short strings at most) and eager
 * imports keep SSR synchronous — no dynamic-import roundtrip during the
 * first render. */
const catalogs: Record<LangCode, Messages> = {
	en: enMessages,
	ca: caMessages,
	es: esMessages,
}

/* Build a fresh `I18n` instance scoped to one request/lang. Marketing is
 * multi-locale per URL, so we cannot share a single `i18n.activate(lang)`
 * across concurrent SSR requests (the activation is global state and
 * would race). `setupI18n` hands back an isolated instance each time. */
export function makeI18n(lang: LangCode): I18n {
	return setupI18n({
		locale: lang,
		messages: { [lang]: catalogs[lang] },
	})
}

/* Render-tree wrapper. Memoises the i18n instance per `lang` so client-side
 * language switches don't rebuild the catalog tables on every render — only
 * when `lang` actually changes. On the server each request gets its own
 * tree, so the memo still resolves to a request-scoped instance. */
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

import { i18n } from '@lingui/core'

import { messages as enMessages } from './locales/en/messages.po'

/**
 * Forja's single shared i18n instance. We load the English catalog
 * eagerly at module init and activate `en` immediately so there's
 * exactly one locale available during SSR and on first client paint
 * — no flash of missing translations, no `dynamicActivate` dance.
 *
 * When we add real translations later (`ca`, `es`, …), this file is
 * where the static import list + default activation will grow. For
 * now the module is deliberately tiny so the boot cost is invisible.
 *
 * Note on SSR: Forja is single-locale, so sharing one `i18n` instance
 * across requests is safe. The moment we add per-user locale
 * switching we'll have to move to request-scoped instances (see
 * Lingui's SSR docs), but that's a non-concern while every request
 * resolves to the same `en` catalog.
 */
i18n.load('en', enMessages)
i18n.activate('en')

export { i18n }

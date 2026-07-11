/**
 * Render an integer cent amount as a localized currency string. Research
 * costs and paid-data spend are stored as whole cents; this formats them with
 * the viewer's locale and the given currency (defaulting to EUR, the pricing
 * currency) so the symbol, separators, and digit grouping are correct instead
 * of a hardcoded `€`.
 */
export function formatMoneyCents(
	cents: number,
	options?: { readonly currency?: string; readonly locale?: string },
): string {
	return new Intl.NumberFormat(options?.locale, {
		style: 'currency',
		currency: options?.currency ?? 'EUR',
	}).format(cents / 100)
}

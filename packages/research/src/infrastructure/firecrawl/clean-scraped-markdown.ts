/**
 * Cleans scraped page markdown before it reaches the research extractor.
 *
 * Some sites built with a WordPress page builder (Avada/Fusion, Divi, WPBakery,
 * …) hand back their body as shortcode scaffolding — `[fusion_builder_container
 * …]` and the like — instead of readable prose, because the real text is
 * assembled by the builder. Firecrawl's own main-content extraction does not
 * always strip these, so the model is left with markup soup and nothing to pull.
 *
 * This removes those page-builder shortcodes (opening `[name …]` and closing
 * `[/name]`), taking care never to touch an ordinary markdown link `[text](url)`,
 * image `![alt](url)`, or reference `[1]` / `[cs]: url`. When what remains is a
 * long page that is still mostly markup, it returns an empty string — the caller's
 * signal to skip the source rather than feed the model noise. A short, clean page
 * (even one carrying only the company name) is always kept: shortness alone is
 * never treated as low-signal, because that name is exactly the grounding cue.
 */

// Builder prefixes whose real shortcodes are ALWAYS `prefix_word` (e.g. `vc_row`,
// `fusion_text`, `et_pb_section`). Requiring the `_word` suffix means a bare
// markdown reference like `[cs]:` or `[av]` is never mistaken for a shortcode.
const PREFIXES_WITH_SUFFIX = [
	'fusion', // Avada / Fusion Builder
	'et_pb', // Divi
	'vc', // WPBakery (Visual Composer)
	'su', // Shortcodes Ultimate
	'kc', // King Composer
	'av', // Avia / Enfold
	'mk', // Jupiter / MK
	'cs', // Cornerstone
	'dt_sc', // DesignThemes
]
// Builder shortcodes that legitimately appear bare (just the tag plus optional
// attributes). Their names are long and distinctive enough not to collide with
// ordinary markdown, so a `_word` suffix is optional here.
const PREFIXES_STANDALONE = ['rev_slider', 'layerslider', 'tatsu']

// Matches an opening `[prefix…]` or closing `[/prefix…]` shortcode, with any
// attributes up to the closing bracket on the same line.
const SHORTCODE_GLOBAL = new RegExp(
	`\\[/?(?:(?:${PREFIXES_WITH_SUFFIX.join('|')})_[a-z0-9]+(?:_[a-z0-9]+)*` +
		`|(?:${PREFIXES_STANDALONE.join('|')})(?:_[a-z0-9]+)*)(?:\\s[^\\]\\n]*)?\\]`,
	'gi',
)

// A long page whose letters are only a small fraction of its characters is markup
// soup (e.g. from a builder we don't recognize); skip it. The length floor keeps a
// short, clean page from ever being judged low-signal.
const MOSTLY_MARKUP_MIN_LENGTH = 400
const MOSTLY_MARKUP_LETTER_RATIO = 0.3

const letterCount = (text: string): number =>
	(text.match(/\p{L}/gu) ?? []).length

export const cleanScrapedMarkdown = (raw: string): string => {
	if (raw.trim().length === 0) return ''
	const cleaned = raw
		.replace(SHORTCODE_GLOBAL, ' ')
		// Collapse the whitespace and blank-line residue the removed tags leave.
		.replace(/[ \t]+\n/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.replace(/[ \t]{2,}/g, ' ')
		.trim()
	if (cleaned.length === 0) return ''
	if (
		cleaned.length > MOSTLY_MARKUP_MIN_LENGTH &&
		letterCount(cleaned) / cleaned.length < MOSTLY_MARKUP_LETTER_RATIO
	)
		return ''
	return cleaned
}

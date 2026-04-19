// Email brand theme — hex values only. Email clients strip var(--…),
// color-mix, gradients, and text-shadow; every style our components emit
// must be inline and resolvable without a document stylesheet. Values
// mirror packages/ui/src/tokens.css MD3 roles.

export const brandColors = {
	// Terracotta — reserved for <a>/link spans only. Body stays warm near-black.
	primary: '#B05220',
	onPrimary: '#FFFFFF',

	// Default body text — warm near-black on unforced white. No cream
	// container frame; "manually sent" feel keeps body/surface neutral.
	onSurface: '#2D2A24',
	onSurfaceVariant: '#56524A',

	// Outline for quote left border + thin separators.
	outline: '#847D71',
	outlineVariant: '#CCC5B5',

	// Sign-off stamp — uppercase, spaced, muted.
	signOff: '#56524A',

	// Quote chrome — left border and interior text.
	quoteBorder: '#CCC5B5',
	quoteText: '#56524A',
} as const
export type BrandColors = typeof brandColors

// Font stacks chosen to degrade gracefully where the <Font> preload is
// stripped (Outlook desktop). Display gets Arial Narrow as a condensed
// substitute; body falls to Arial.
export const brandFonts = {
	display: `'Barlow Condensed', 'Arial Narrow', 'Helvetica Neue Condensed', sans-serif`,
	body: `'Barlow', Arial, Helvetica, sans-serif`,
} as const
export type BrandFonts = typeof brandFonts

export const brandFontWeight = {
	regular: 400,
	medium: 500,
	bold: 700,
} as const
export type BrandFontWeight = typeof brandFontWeight

// Remote <Font> sources. We load only the weights we actually emit —
// everything else falls back to the local stack. Keeps the preload small.
export const brandFontFaces = [
	{
		family: 'Barlow',
		url: 'https://fonts.gstatic.com/s/barlow/v12/7cHpv4kjgoGqM7E_DMs5.woff2',
		format: 'woff2',
		weight: brandFontWeight.regular,
		style: 'normal' as const,
	},
	{
		family: 'Barlow',
		url: 'https://fonts.gstatic.com/s/barlow/v12/7cHqv4kjgoGqM7E3w-oc4Q.woff2',
		format: 'woff2',
		weight: brandFontWeight.bold,
		style: 'normal' as const,
	},
	{
		family: 'Barlow Condensed',
		url: 'https://fonts.gstatic.com/s/barlowcondensed/v12/HTxwL3I-JCGChYJ8VI-L6OO_au7B.woff2',
		format: 'woff2',
		weight: brandFontWeight.medium,
		style: 'normal' as const,
	},
] as const
export type BrandFontFace = (typeof brandFontFaces)[number]

// The single exported theme consumed by every brand-aware component and
// by the server-side renderer. Editor chrome reads the same object, so
// on-canvas rendering mirrors on-wire output.
export const brandTheme = {
	colors: brandColors,
	fonts: brandFonts,
	fontWeight: brandFontWeight,
	fontFaces: brandFontFaces,

	// Baseline typography — sizes in px for email-client friendliness.
	body: {
		fontFamily: brandFonts.body,
		fontSize: '16px',
		lineHeight: '1.55',
		color: brandColors.onSurface,
	},

	link: {
		color: brandColors.primary,
		textDecoration: 'underline',
	},

	heading: {
		fontFamily: brandFonts.display,
		color: brandColors.onSurface,
		fontWeight: brandFontWeight.medium,
		// Per-level sizing. Kept conservative — email clients rarely honor
		// fancy headings and we want the "manually written" aesthetic.
		1: { fontSize: '26px', lineHeight: '1.25', margin: '0 0 16px' },
		2: { fontSize: '22px', lineHeight: '1.3', margin: '0 0 12px' },
		3: { fontSize: '18px', lineHeight: '1.35', margin: '0 0 12px' },
	},

	paragraph: {
		margin: '0 0 16px',
	},

	list: {
		margin: '0 0 16px',
		paddingLeft: '24px',
	},

	listItem: {
		margin: '0 0 6px',
	},

	divider: {
		border: 'none',
		borderTop: `1px solid ${brandColors.outlineVariant}`,
		margin: '24px 0',
	},

	// Left-border quote with muted interior. Nested quotes multiply the
	// padding naturally via recursive rendering — no special-case depth cap.
	quote: {
		margin: '0 0 16px',
		padding: '0 0 0 16px',
		borderLeft: `3px solid ${brandColors.quoteBorder}`,
		color: brandColors.quoteText,
	},

	// Sign-off — single <Text> line, uppercase, letter-spaced. No <Hr>
	// above; a rule would read as transactional chrome.
	signOff: {
		fontFamily: brandFonts.display,
		fontWeight: brandFontWeight.medium,
		fontSize: '13px',
		letterSpacing: '0.1em',
		textTransform: 'uppercase' as const,
		color: brandColors.signOff,
		margin: '24px 0 0',
	},

	image: {
		display: 'block' as const,
		maxWidth: '100%',
		height: 'auto',
	},
} as const

export type BrandTheme = typeof brandTheme

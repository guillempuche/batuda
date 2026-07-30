/**
 * Deterministic generator for bulk demo rows.
 *
 * The hand-written fixtures stay the anchors that tests and demos point at;
 * this fills in the volume around them so lists, filters, paging and the
 * pipeline board have realistic amounts of data to work with. Everything is
 * driven by a fixed seed, so re-seeding always produces the same rows and a
 * diff of the demo data stays readable.
 */

/**
 * Small deterministic pseudo-random generator. Same seed in, same sequence
 * out, on every machine — `Math.random()` would make each seed run different
 * and impossible to reason about.
 */
export const mulberry32 = (seed: number) => (): number => {
	seed = (seed + 0x6d2b79f5) | 0
	let t = seed
	t = Math.imul(t ^ (t >>> 15), t | 1)
	t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

export type Rng = () => number

export const pick = <T>(rng: Rng, items: ReadonlyArray<T>): T => {
	const item = items[Math.floor(rng() * items.length)]
	if (item === undefined) {
		throw new Error('pick: cannot choose from an empty list')
	}
	return item
}

/** Pick `count` distinct items, or fewer when the pool is smaller. */
export const pickSome = <T>(
	rng: Rng,
	items: ReadonlyArray<T>,
	count: number,
): T[] => {
	const pool = [...items]
	const out: T[] = []
	while (out.length < count && pool.length > 0) {
		const [taken] = pool.splice(Math.floor(rng() * pool.length), 1)
		if (taken !== undefined) out.push(taken)
	}
	return out
}

/** True with the given probability (0–1). */
export const chance = (rng: Rng, probability: number): boolean =>
	rng() < probability

/** A date between `daysAgoMax` and `daysAgoMin` before `reference`. */
export const daysBefore = (
	rng: Rng,
	reference: Date,
	daysAgoMax: number,
	daysAgoMin = 0,
): Date => {
	const span = daysAgoMax - daysAgoMin
	const days = daysAgoMin + rng() * span
	return new Date(reference.getTime() - days * 24 * 60 * 60 * 1000)
}

// ── Vocabulary ───────────────────────────────────────────────────

/**
 * Business-type prefixes paired with the industry they actually imply, so a
 * generated "Transports Riera" is filed under transport rather than a random
 * sector. Keeps the demo data coherent when someone filters by industry.
 */
const TRADES = [
	{ prefix: 'Restaurant', industry: 'restaurants' },
	{ prefix: 'Bar', industry: 'restaurants' },
	{ prefix: 'Celler', industry: 'restaurants' },
	{ prefix: 'Forn', industry: 'restaurants' },
	{ prefix: 'Hostal', industry: 'hospitality' },
	{ prefix: 'Apartaments', industry: 'hospitality' },
	{ prefix: 'Construccions', industry: 'construction' },
	{ prefix: 'Fusteria', industry: 'construction' },
	{ prefix: 'Electricitat', industry: 'construction' },
	{ prefix: 'Climatització', industry: 'construction' },
	{ prefix: 'Taller', industry: 'manufacturing' },
	{ prefix: 'Metalls', industry: 'manufacturing' },
	{ prefix: 'Impremta', industry: 'manufacturing' },
	{ prefix: 'Transports', industry: 'transport' },
	{ prefix: 'Logística', industry: 'transport' },
	{ prefix: 'Distribucions', industry: 'distribution' },
	{ prefix: 'Majorista', industry: 'distribution' },
	{ prefix: 'Ferreteria', industry: 'retail' },
	{ prefix: 'Òptica', industry: 'retail' },
	{ prefix: 'Floristeria', industry: 'retail' },
	{ prefix: 'Assessoria', industry: 'services' },
	{ prefix: 'Gestoria', industry: 'services' },
	{ prefix: 'Neteges', industry: 'services' },
	{ prefix: 'Jardineria', industry: 'services' },
] as const

const FAMILY_NAMES = [
	'Puig',
	'Serra',
	'Roca',
	'Vila',
	'Camps',
	'Ferrer',
	'Bosch',
	'Mas',
	'Riera',
	'Costa',
	'Soler',
	'Prat',
	'Vidal',
	'Torres',
	'Rovira',
	'Sala',
	'Font',
	'Pla',
	'Grau',
	'Munt',
	'Carbó',
	'Oliva',
	'Blanch',
	'Vendrell',
	'Amat',
	'Casals',
	'Bonet',
	'Duran',
	'Gispert',
	'Llopis',
] as const

/** Towns with real coordinates so the map view has plausible pins. */
const TOWNS = [
	{ name: 'Barcelona', lat: 41.3874, lng: 2.1686 },
	{ name: 'Sabadell', lat: 41.5463, lng: 2.1086 },
	{ name: 'Terrassa', lat: 41.5638, lng: 2.0111 },
	{ name: 'Girona', lat: 41.9794, lng: 2.8214 },
	{ name: 'Lleida', lat: 41.6176, lng: 0.62 },
	{ name: 'Tarragona', lat: 41.1189, lng: 1.2445 },
	{ name: 'Reus', lat: 41.155, lng: 1.1075 },
	{ name: 'Mataró', lat: 41.5388, lng: 2.4449 },
	{ name: 'Vic', lat: 41.9301, lng: 2.2545 },
	{ name: 'Manresa', lat: 41.723, lng: 1.8265 },
	{ name: 'Igualada', lat: 41.5791, lng: 1.6174 },
	{ name: 'Vilafranca del Penedès', lat: 41.3459, lng: 1.6996 },
	{ name: 'Granollers', lat: 41.6083, lng: 2.2886 },
	{ name: 'Figueres', lat: 42.2662, lng: 2.9622 },
	{ name: 'Tortosa', lat: 40.8126, lng: 0.5211 },
	{ name: 'Olot', lat: 42.1818, lng: 2.49 },
] as const

const SOURCES = [
	'firecrawl',
	'exa',
	'google_maps',
	'referral',
	'linkedin',
	'instagram',
	'manual',
] as const

const SIZE_RANGES = ['1-5', '6-10', '11-25', '26-50', '51-200'] as const

/**
 * Pipeline stages weighted like a real funnel — many early-stage leads,
 * few clients — so the board columns and status filters look believable
 * instead of evenly split.
 */
const STATUS_WEIGHTS = [
	{ status: 'prospect', weight: 30 },
	{ status: 'contacted', weight: 22 },
	{ status: 'responded', weight: 14 },
	{ status: 'meeting', weight: 10 },
	{ status: 'proposal', weight: 8 },
	{ status: 'client', weight: 8 },
	{ status: 'closed', weight: 4 },
	{ status: 'dead', weight: 4 },
] as const

const TOTAL_STATUS_WEIGHT = STATUS_WEIGHTS.reduce((n, s) => n + s.weight, 0)

const pickStatus = (rng: Rng): string => {
	let roll = rng() * TOTAL_STATUS_WEIGHT
	for (const { status, weight } of STATUS_WEIGHTS) {
		roll -= weight
		if (roll <= 0) return status
	}
	return 'prospect'
}

const PAIN_POINTS = [
	'Comandes per telèfon, es perden a les hores punta.',
	'Full de càlcul compartit que ningú manté al dia.',
	'Pressupostos a mà, triguen dies a sortir.',
	'Sense web, tot arriba per xarxes socials.',
	'Estoc descontrolat entre magatzem i botiga.',
	'Facturació manual, errors al tancar el mes.',
	'Cap seguiment dels clients que no responen.',
] as const

const CURRENT_TOOLS = [
	'Excel',
	'Excel + WhatsApp',
	'Llibreta de paper',
	'Google Sheets',
	"Programa antic d'escriptori",
	'Cap eina',
] as const

const NEXT_ACTIONS = [
	'Trucar per confirmar interès',
	'Enviar pressupost',
	'Fer seguiment de la proposta',
	'Concertar visita',
	"Enviar cas d'èxit del sector",
] as const

const slugify = (value: string): string =>
	value
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '')

export type GeneratedCompany = {
	readonly slug: string
	readonly name: string
	readonly status: string
	readonly industry: string
	readonly sizeRange: string
	readonly country: string
	readonly location: string
	readonly source: string
	readonly priority: number
	readonly website: string | null
	readonly email: string | null
	readonly phone: string | null
	readonly productsFit: string[]
	readonly tags: string[]
	readonly painPoints: string | null
	readonly currentTools: string | null
	readonly nextAction: string | null
	readonly lastContactedAt: Date | null
	readonly latitude: number
	readonly longitude: number
	readonly geocodedAt: Date
	readonly geocodeSource: string
}

/**
 * Build `count` companies. Priority is always 2 or 3 — priority 1 stays
 * reserved for the hand-written fixtures so they keep sorting to the top of
 * the default list, which several end-to-end tests rely on.
 */
export const generateCompanies = (options: {
	readonly count: number
	readonly seed: number
	readonly reference: Date
	readonly productSlugs: ReadonlyArray<string>
	/** Distinguishes slugs between orgs so the two demo orgs never collide. */
	readonly slugPrefix?: string
}): GeneratedCompany[] => {
	const rng = mulberry32(options.seed)
	const used = new Set<string>()
	const out: GeneratedCompany[] = []

	// The loop retries on a name clash, so it needs a way out: without this a
	// count larger than the vocabulary can produce would spin forever inside
	// the seed's open transaction, with nothing logged.
	const maxAttempts = options.count * 20
	let attempts = 0

	while (out.length < options.count) {
		attempts++
		if (attempts > maxAttempts) {
			throw new Error(
				`generateCompanies: could only build ${out.length} of ${options.count} companies before running out of distinct names. Widen TRADES/FAMILY_NAMES/TOWNS in generate.ts or lower the requested count.`,
			)
		}
		const trade = pick(rng, TRADES)
		const family = pick(rng, FAMILY_NAMES)
		const town = pick(rng, TOWNS)
		const name = `${trade.prefix} ${family}`
		const base = options.slugPrefix
			? `${options.slugPrefix}-${slugify(name)}`
			: slugify(name)
		// The same trade/family pair can come up twice; suffix the town to keep
		// slugs unique without inventing an unnatural name.
		const slug = used.has(base) ? `${base}-${slugify(town.name)}` : base
		if (used.has(slug)) continue
		used.add(slug)

		const status = pickStatus(rng)
		// Built from the slug, not the name: the slug is what carries the town
		// suffix that made this company distinct, so two firms with the same
		// trade and family surname no longer end up on one shared domain.
		const domain = `${slug.replace(/-/g, '')}.cat`
		// Leads that never got past prospect mostly have no contact date yet.
		const contacted = status !== 'prospect' || chance(rng, 0.3)

		out.push({
			slug,
			name,
			status,
			industry: trade.industry,
			sizeRange: pick(rng, SIZE_RANGES),
			country: 'ES',
			location: town.name,
			source: pick(rng, SOURCES),
			priority: chance(rng, 0.45) ? 2 : 3,
			website: chance(rng, 0.7) ? `https://${domain}` : null,
			email: chance(rng, 0.8) ? `info@${domain}` : null,
			phone: chance(rng, 0.6)
				? `+34 9${Math.floor(rng() * 90 + 10)} ${Math.floor(rng() * 900 + 100)} ${Math.floor(rng() * 900 + 100)}`
				: null,
			productsFit: pickSome(
				rng,
				options.productSlugs,
				chance(rng, 0.5) ? 2 : 1,
			),
			tags: [trade.industry, town.name.toLowerCase()],
			painPoints: chance(rng, 0.75) ? pick(rng, PAIN_POINTS) : null,
			currentTools: chance(rng, 0.6) ? pick(rng, CURRENT_TOOLS) : null,
			nextAction:
				status === 'client' || status === 'closed' || status === 'dead'
					? null
					: chance(rng, 0.6)
						? pick(rng, NEXT_ACTIONS)
						: null,
			lastContactedAt: contacted
				? daysBefore(rng, options.reference, 180, 1)
				: null,
			latitude: town.lat,
			longitude: town.lng,
			geocodedAt: options.reference,
			geocodeSource: 'seed',
		})
	}

	return out
}

const FIRST_NAMES = [
	'Marc',
	'Laia',
	'Jordi',
	'Núria',
	'Pau',
	'Anna',
	'Oriol',
	'Marta',
	'Sergi',
	'Clara',
	'Albert',
	'Gemma',
	'Ramon',
	'Sílvia',
	'Xavier',
	'Roser',
] as const

const ROLES = [
	'Propietari',
	'Gerent',
	'Directora Financera',
	'Responsable de Compres',
	"Cap d'Operacions",
	'Responsable de Màrqueting',
	'Administració',
] as const

export type GeneratedContact = {
	readonly companySlug: string
	readonly name: string
	readonly role: string
	readonly buyingRole: string | null
	readonly email: string | null
	readonly phone: string | null
}

/**
 * Two to three contacts per company, the first of which decides. Names are
 * suffixed on collision so the contact map (keyed by name) stays unambiguous.
 */
export const generateContacts = (options: {
	readonly companies: ReadonlyArray<GeneratedCompany>
	readonly seed: number
	/**
	 * Names already spoken for by the hand-written fixtures. Contacts are
	 * looked up by name elsewhere in the seed, so a generated person must
	 * never end up sharing one with a curated person.
	 */
	readonly reservedNames?: ReadonlySet<string>
}): GeneratedContact[] => {
	const rng = mulberry32(options.seed)
	const used = new Set<string>(options.reservedNames ?? [])
	const out: GeneratedContact[] = []

	for (const company of options.companies) {
		const howMany = chance(rng, 0.45) ? 3 : 2
		for (let i = 0; i < howMany; i++) {
			const first = pick(rng, FIRST_NAMES)
			const family = pick(rng, FAMILY_NAMES)
			// Numbering the clash rather than skipping it: dropping the contact
			// would leave the company short, and dropping the first one would
			// leave it with nobody marked as the decision maker.
			let name = `${first} ${family}`
			for (let attempt = 2; used.has(name); attempt++) {
				name = `${first} ${family} ${attempt}`
			}
			used.add(name)

			const domain = company.website?.replace('https://', '') ?? 'example.cat'
			// Both names go into the address so two people at one company can
			// never be reached at the same one.
			const localPart = slugify(name).replace(/-/g, '.')
			out.push({
				companySlug: company.slug,
				name,
				role: i === 0 ? 'Propietari' : pick(rng, ROLES),
				// The first person generated for a company is its owner, and an
				// owner-run business is exactly where one person holds the budget.
				buyingRole: i === 0 ? 'economic_buyer' : null,
				email: chance(rng, 0.85) ? `${localPart}@${domain}` : null,
				phone: chance(rng, 0.5)
					? `+34 6${Math.floor(rng() * 90 + 10)} ${Math.floor(rng() * 900 + 100)} ${Math.floor(rng() * 900 + 100)}`
					: null,
			})
		}
	}

	return out
}

/**
 * Decides whether a run's fetched evidence is actually about the company the run
 * was asked to research, so a run that only scraped unrelated pages cannot report
 * another company's data as if it were the target's.
 *
 * The check is deterministic and reads ONLY the evidence corpus (scraped pages +
 * tool results), never the model's own prose — the model always repeats the
 * queried name, so its prose could vouch for any target. A company that was truly
 * reached almost always spells its own name (or its domain) on its own pages.
 *
 * Three verdicts drive the run:
 *  - 'strong'  the target's full name or its own domain appears in the evidence;
 *  - 'weak'    only a distinctive word of the name appears — the run never
 *              clearly landed on the target, so its findings are kept but marked
 *              for somebody to read before anything is acted on;
 *  - 'absent'  nothing in the evidence names the target — the run is misattributed
 *              and fails closed as no_reliable_data.
 */

// Legal-form suffixes dropped before matching, so "Acme Logistics S.L." and a
// page that writes "Acme Logistica SL" still match on the same name core.
const LEGAL_SUFFIXES = new Set([
	'sl',
	'slu',
	'sa',
	'sau',
	'scp',
	'sccl',
	'srl',
	'sarl',
	'slne',
	'gmbh',
	'ltd',
	'limited',
	'llc',
	'inc',
	'incorporated',
	'bv',
	'plc',
	'ag',
	'oy',
	'spa',
	'sas',
	'co',
	'corp',
	'llp',
	'kg',
	'ab',
	'as',
	'nv',
	'kft',
	// The second half of "S.A. de C.V.", which is how a Mexican company writes its
	// form. Without it the connector rule below has nothing to start from and the
	// whole form stays in the name.
	'cv',
])

// Generic words that do not prove a page is about the target — a page about any
// freight company contains "logistics"/"transport". A name reduced to only these
// yields no distinctive word, so the run cannot reach a weak (let alone strong)
// match on an industry term alone.
const GENERIC_WORDS = new Set([
	'logistics',
	'logistica',
	'transport',
	'transports',
	'transporte',
	'transportes',
	'transportation',
	'trucking',
	'cargo',
	'shipping',
	'freight',
	'brokerage',
	'delivery',
	'express',
	'group',
	'grupo',
	'holding',
	'holdings',
	'services',
	'servicios',
	'solutions',
	'soluciones',
	'company',
	'compania',
	'international',
	'global',
	'consulting',
	'partners',
	'associates',
	'industries',
])

// Second-level public labels ("co.uk", "com.au") dropped so the registrable
// label is read, not the country's second level.
const SECOND_LEVEL = new Set([
	'co',
	'com',
	'org',
	'net',
	'gov',
	'edu',
	'ac',
	'gob',
])

// Lower-case, strip accents, drop everything but letters and digits — the same
// folding the email-guess step uses, so text matches regardless of punctuation,
// case, or diacritics. Word boundaries are removed too, so a spelled-out name
// like "Acme Logistics" is found as the contiguous run "acmelogistics".
export const collapse = (value: string): string =>
	value
		.normalize('NFKD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase()
		.replace(/[^a-z0-9]/g, '')

/**
 * Accent-folded word tokens of a name, punctuation split out. Exported because
 * the same folding has to read a web address the same way it reads a name — a
 * second copy of it is how two checks start disagreeing about whether a piece of
 * text spells a company.
 */
export const foldTokens = (value: string): string[] =>
	value
		.normalize('NFKD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter(Boolean)

// A geminate l as Catalan writes it, with every mark that may sit between the
// two l's spelled by number because several of them draw the same dot and nobody
// could tell them apart written out: the middle dot is the standard one, the
// Greek ano teleia is the look-alike a paste leaves behind, the period is what a
// database that could not write any of them fell back on, and the rest are what
// a keyboard or a word processor reaches for instead.
//
// Both l's have to touch the mark, which is what keeps a legal form out of it:
// "S.L." holds no l-dot-l, and in "S.L. Lopez" a space sits at the join.
//
// Only ever handed to `replace`, which starts from the beginning every time. Ask
// it `test` instead and it answers from wherever the last call left off, so every
// other name carrying a mark would come back as carrying none.
const GEMINATED_L = /l[.\u00B7\u0387\u2022\u2027\u2219\u22C5]l/giu

/**
 * A name in each way an address may spell it, the name as written first.
 *
 * Catalan marks a geminate l with an interpunct — "Instal·lacions", "Col·legi",
 * "Il·lustració" — and no address carries the mark. Both ways of writing it out
 * are ordinary: the slug keeps the two l's ("installacions-vives") or keeps one
 * ("instalacions-vives"). Read a name only one of those ways and it is filed
 * under a spelling half the addresses never use — and the trade this product
 * sells into is called "instal·lacions" across half the country.
 *
 * ONLY a name carrying the mark is read twice. Reading every "ll" as a possible
 * geminate would put "Villa Nova" and "Vila Nova" — two different companies,
 * both ordinary here — under one name, and the rules leaning on this take a
 * company's website away.
 *
 * This runs on the name as it arrived, BEFORE a legal form's dots come out —
 * which is the only order that lets the period be one of the marks. Take the
 * dots out first and "Instal.lacions" has already become "Installacions", with
 * nothing left to say the two l's were ever one sound.
 *
 * Several marks in one name are read all the same way rather than in every
 * combination: an address is slugged by one convention, not one per word.
 */
export const nameSpellings = (name: string): ReadonlyArray<string> => {
	const doubled = name.replace(GEMINATED_L, 'll')
	const single = name.replace(GEMINATED_L, 'l')
	return doubled === single ? [doubled] : [doubled, single]
}

// Words that join two halves of a legal form — "S.A. de C.V.", "Serveis i
// Manteniments S.L." — skipped over while reading a form off the end, never
// dropped on their own.
const FORM_CONNECTORS = new Set(['de', 'y', 'i', 'and'])

// Where a name's legal form ends and the name itself begins, read from the right.
// A form sits at the end of a name, so anything before the trailing run is the
// company's own name and stays in the key — two letters at the front that happen
// to spell a legal form ("KG Motors") are part of what the company is called.
const nameEnd = (tokens: ReadonlyArray<string>): number => {
	let end = tokens.length
	let at = tokens.length
	while (at > 0) {
		const token = tokens[at - 1] ?? ''
		if (LEGAL_SUFFIXES.has(token)) {
			at--
			end = at
			continue
		}
		// A connector counts only between two halves of one form, which is why it
		// moves the cursor and never the end.
		if (end < tokens.length && FORM_CONNECTORS.has(token)) {
			at--
			continue
		}
		break
	}
	return end
}

/**
 * The words of a name minus its legal form — "Acme Logistics S.L." → ["acme",
 * "logistics"]. Exported because a caller comparing two names has to compare
 * them word by word rather than as one run of letters: telling whether one name
 * is another name and then some needs to know where each word ends, and the
 * collapsed "acmelogistics" no longer says.
 */
export const nameCoreTokens = (name: string): ReadonlyArray<string> => {
	const tokens = foldTokens(name)
	return tokens.slice(0, nameEnd(tokens))
}

// The whole name minus its legal form, collapsed — "Acme Logistics S.L." →
// "acmelogistics". This is the strong-match key: it appears verbatim on the
// company's own pages but is long enough not to hit by coincidence. A key that
// is only an industry word would match any page in that industry, so the form is
// read off the end rather than picked out wherever it appears.
export const nameCore = (name: string): string => nameCoreTokens(name).join('')

/**
 * The strong-match key in each spelling an address may use, the name as written
 * first. A caller holding a LIST of keys asks with all of them; one holding a
 * single identity for a company takes the first, so two spellings of one name
 * can never be counted as two companies.
 *
 * A form written in dots is put back together here rather than by the caller, so
 * no caller can forget to — see `spellingsWithoutForms`, which is where forgetting
 * used to cost something.
 */
export const coreSpellings = (name: string): ReadonlyArray<string> =>
	[
		...new Set(
			nameSpellings(name).map(spelling => nameCore(withoutFormDots(spelling))),
		),
	].filter(spelling => spelling !== '')

/**
 * The words of a name, every legal-form word taken out wherever it sits — "SARL
 * Transports Dupont" → ["transports", "dupont"]. Exported because a caller
 * asking which FRONT PART of a name a domain could spell has to know where each
 * word ends, and the joined "transportsdupont" no longer says.
 */
export const nameWordsWithoutForms = (name: string): ReadonlyArray<string> =>
	foldTokens(name).filter(t => !LEGAL_SUFFIXES.has(t))

/**
 * The name with every legal-form word taken out, wherever it sits — "SARL
 * Transports Dupont" → "transportsdupont".
 *
 * This answers a different question from `nameCore`: not "who is this company"
 * but "does this piece of text name it". A directory writes the trading name
 * into its address and leaves the form out, so a key that keeps the form finds
 * nothing there. Being loose is the safe direction for that question — the worst
 * it does is spot the company's name in one more place.
 */
export const nameWithoutForms = (name: string): string =>
	nameWordsWithoutForms(name).join('')

/**
 * The same key in each spelling an address may use, empty ones left out. This is
 * the reading BOTH the website guard and the directory watch put an address
 * through, so neither can come to a different answer about whether a piece of
 * text spells a company. As with `coreSpellings`, the name as written comes
 * first, and that one is the company's identity.
 *
 * A form written in dots — "Muñoz S.L." — is put back together here, inside the
 * reading, rather than left to each caller. That is the whole point: while one
 * caller did it and the other did not, the two read that name as "munoz" and
 * "munozsl", and the guard looking for the longer one could not find the company
 * on its own munoz.es. Dots the geminate mark claimed are already gone by now,
 * so a Catalan name written "Instal.lacions" keeps both of its readings.
 */
export const spellingsWithoutForms = (name: string): ReadonlyArray<string> =>
	[
		...new Set(
			nameSpellings(name).map(spelling =>
				nameWithoutForms(withoutFormDots(spelling)),
			),
		),
	].filter(spelling => spelling !== '')

/**
 * Whether a domain's label spells any of these names, allowing the legal form
 * after it — "fusteriamiquel" and "fusteriamiquelsl" both spell "fusteriamiquel",
 * and "fusteriamiquelreviews" spells somebody writing about it.
 *
 * The one place two callers have to agree: picking the site a run goes and reads
 * asks this, and so does deciding whether a website is the company's own. Two
 * copies of it would let a host be one company's site to one caller and not to
 * the other.
 */
export const labelSpellsOneOf = (
	label: string,
	names: ReadonlyArray<string>,
): boolean =>
	names.some(name => {
		// A name with nothing in it is spelled by every label, so a caller whose
		// name list came back empty would have every domain answer yes.
		if (name === '' || !label.startsWith(name)) return false
		const rest = label.slice(name.length)
		return rest === '' || LEGAL_SUFFIXES.has(rest)
	})

/**
 * Whether a word names a trade rather than a company — "logistics", "grupo",
 * "solutions". Exported alongside `distinctiveWords` for a caller that needs the
 * judgement on a word it did not get from there.
 */
export const isGenericWord = (word: string): boolean => GENERIC_WORDS.has(word)

/**
 * The shortest run of letters that may stand for a company on its own. Two or
 * three turn up inside unrelated text by coincidence — "it" sits inside
 * "digital.es", "roca" inside "barroca" — and every check that goes on a name
 * fragment pays for that coincidence in the same way.
 */
export const DISTINCTIVE_NAME_LENGTH = 4

/**
 * A legal form written with dots — "Muñoz S.L." — comes apart into single letters
 * that read as two more words of the name, so the same company written both ways
 * lands under two different keys. Taking the dots out first puts the form back
 * together. Two rows of one Spanish list spelling the form differently is the
 * ordinary case here, not an exotic one.
 */
export const withoutFormDots = (name: string): string => name.replace(/\./g, '')

/**
 * The distinctive words of a name: each long enough to stand for the company and
 * neither a legal suffix nor a generic industry term. These drive the weak match,
 * and they are also how most firms register a domain — "Transportes García" at
 * garcia.es — which is why a caller asking whether a host is a company's own
 * needs them beside its cores.
 *
 * A word written with a geminate l comes back once per spelling, since a caller
 * looking for it has no way of knowing which one it will meet.
 */
export const distinctiveWords = (name: string): string[] => [
	...new Set(
		nameSpellings(name)
			.flatMap(foldTokens)
			.filter(
				t =>
					t.length >= DISTINCTIVE_NAME_LENGTH &&
					!LEGAL_SUFFIXES.has(t) &&
					!GENERIC_WORDS.has(t),
			),
	),
]

/**
 * Whether a name holds no word that could stand for THIS company rather than for
 * anybody in its trade — "Grupo Express SL" is a kind of company and a trade and
 * nothing else.
 *
 * This is the intended trade, not a gap to close: a generic word identifies
 * nobody, and matching on one is the expensive mistake. But the consequence is
 * real and worth counting, because such a company is judged on less than
 * everybody else is. Its own site can never be established — `ownSiteVerdict`
 * has no word of its own to find in a domain, so even grupoexpress.cat reads
 * `unknown` — and the rules that hold a website against a name have only the
 * whole name left, so an address writing any part of it goes unrecognised.
 * Blanking is the direction that costs, and it is the company's real site that
 * goes.
 */
export const namesNobodyInParticular = (name: string): boolean =>
	distinctiveWords(name).length === 0

// The bare host of a website — "acme.co.uk" from "https://www.acme.co.uk/about".
// A page that references this exact host really points at the target's site,
// unlike a passing mention of the brand word, so it is a strong signal.
export const domainHost = (website: string): string | undefined => {
	const host = website
		.trim()
		.toLowerCase()
		.replace(/^[a-z]+:\/\//, '')
		.replace(/[/:?#].*$/, '')
		.replace(/^www\./, '')
	return host.includes('.') && host.length >= 4 ? host : undefined
}

/**
 * The label a domain is registered under — "acme" from "acme.co.uk", "tecsol"
 * from "annuaire.tecsol.fr". Empty when the host has no label to read.
 *
 * Exported without the four-letter floor `domainLabelOf` puts on it, because the
 * floor belongs to the question rather than to the reading: a fragment found
 * INSIDE a longer host needs the length to mean anything, while a label that IS
 * the whole name is just as telling at three letters ("dsv.com", "xpo.com").
 */
export const hostLabel = (host: string): string => {
	const labels = host.split('.').filter(Boolean)
	labels.pop() // drop the TLD
	if (labels.length >= 2 && SECOND_LEVEL.has(labels[labels.length - 1] ?? '')) {
		labels.pop() // drop a second-level public suffix (co.uk, com.au…)
	}
	return labels[labels.length - 1] ?? ''
}

// The distinctive label inside a host — "acme" from "acme.co.uk" — used only as a
// weak signal alongside the name's own words.
const domainLabelOf = (host: string): string | undefined => {
	const label = hostLabel(host)
	return label.length >= 4 ? label : undefined
}

// A caller often wraps the company name in quotes inside a longer instruction
// ("Research \"Acme Corp\" (acme.com) — find headcount…"), so the quoted phrase,
// not the whole sentence, is the name to match on. Straight and curly double
// quotes, 2–80 chars so it can't swallow a paragraph.
const QUOTED_NAME = /["“]([^"”]{2,80})["”]/

// A free-text query's company name: the first quoted phrase if one is present,
// else the part before the first comma ("Sunset Transportation, St. Louis MO");
// fall back to the whole query.
export const queryName = (query: string): string =>
	query.match(QUOTED_NAME)?.[1] ?? query.split(',')[0] ?? query

// Administrative words that name no particular place — dropped so only the
// distinctive part of a location ("louis" from "St. Louis city") is kept.
const GEO_STOPWORDS = new Set([
	'city',
	'town',
	'area',
	'region',
	'province',
	'county',
	'district',
	'greater',
	'metropolitan',
])

// The part of a free-text query after the first comma, where the convention
// "Company Name, City" puts the location ("St. Louis MO" from
// "Sunset Transportation, St. Louis MO"); empty when the query has no comma.
const queryTail = (query: string): string => {
	const comma = query.indexOf(',')
	return comma >= 0 ? query.slice(comma + 1) : ''
}

// The distinctive place words a caller supplied — the query's post-comma tail
// plus any location hint — each ≥4 chars and not a generic administrative word.
// These let a run tell "the target, in the queried city" from a same-named
// company (or a stale mention) somewhere else. Empty when no location was given,
// which is what makes the city check below fail open.
export const queryPlaces = (
	query: string,
	location?: string | undefined,
): ReadonlyArray<string> => [
	...new Set(
		foldTokens(`${queryTail(query)} ${location ?? ''}`).filter(
			t => t.length >= 4 && !GEO_STOPWORDS.has(t),
		),
	),
]

// A domain-shaped token inside free text: one or more dot-separated labels then a
// 2–24 letter top-level part. The letters-only tail keeps decimals ("3.5") and
// abbreviations ("e.g", "U.S.A") from matching.
const DOMAIN_IN_TEXT = /(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}/i

// A caller often writes the company's own domain straight into the query, e.g.
// "Sunset Transportation (sunsettrans.com)". Pull the first domain-shaped token so
// the run can treat it as the target's official site. Normalised and validated
// through domainHost, so only a real registrable host comes back.
export const parseQueryDomain = (query: string): string | undefined => {
	const match = query.match(DOMAIN_IN_TEXT)
	return match ? domainHost(match[0]) : undefined
}

export interface EntityTarget {
	readonly table: string
	readonly name?: string | undefined
	readonly website?: string | undefined
}

export interface EntityTargets {
	/** Full collapsed names — strong-match keys (checked against collapsed text). */
	readonly cores: ReadonlyArray<string>
	/** Distinctive words + domain labels — weak-match keys. */
	readonly words: ReadonlyArray<string>
	/** Registrable hosts — strong-match keys (checked against the raw corpus). */
	readonly domains: ReadonlyArray<string>
	/** Distinctive place words from the query/location — corroboration keys used
	 * only to fail closed when a name-only match names no reachable official site. */
	readonly places: ReadonlyArray<string>
}

// Only these schemas make a claim about their OWN named subject. A scan playbook
// legitimately reports third-party companies, so it is never entity-gated;
// freeform makes no entity guarantee.
const ENTITY_GROUNDED_SCHEMAS = new Set([
	'company_enrichment_v1',
	'contact_discovery_v1',
])

// True when a run's whole job is its own named subject — enrichment and contact
// discovery — as opposed to a scan that reports third parties. Callers that act on
// the subject itself (the register lookup) gate on this, so an anchored scan does
// not trigger subject-only work.
export const isEntityGroundedSchema = (schemaName: string): boolean =>
	ENTITY_GROUNDED_SCHEMAS.has(schemaName)

/**
 * Builds the match keys for a run's target, or null when the run should not be
 * entity-gated (a scan/freeform run with no anchored subject, or a target with no
 * usable name or domain).
 */
export const deriveEntityTargets = (args: {
	schemaName: string
	query: string
	subjects: ReadonlyArray<EntityTarget>
	/**
	 * A human-supplied correct official domain, from a target-correction re-run.
	 * Folded in like a subject's website — its host becomes a strong-match key —
	 * so the re-run locks onto the right company even when the stored subject's
	 * website was null or wrong. An unparseable value is ignored.
	 */
	anchorDomain?: string | undefined
	/** The run's location hint, folded into the place keys alongside the query's
	 * own "…, City" tail. */
	location?: string | undefined
}): EntityTargets | null => {
	const anchored = args.subjects.length > 0
	if (!isEntityGroundedSchema(args.schemaName) && !anchored) return null

	const names = anchored
		? args.subjects
				.map(s => s.name)
				.filter((n): n is string => n != null && n.trim() !== '')
		: [queryName(args.query)]
	const websites = args.subjects
		.map(s => s.website)
		.filter((w): w is string => w != null && w.trim() !== '')
	const anchorHost =
		args.anchorDomain != null ? domainHost(args.anchorDomain) : undefined
	// A domain written into the query is the target's own site too — fold it in so
	// a page that references it counts as a strong match, like an anchor domain.
	const queryHost = parseQueryDomain(args.query)

	const domains = [
		...new Set(
			[...websites.map(domainHost), anchorHost, queryHost].filter(
				(h): h is string => h != null,
			),
		),
	]
	const cores = [
		...new Set(names.flatMap(coreSpellings).filter(c => c.length >= 4)),
	]
	const words = [
		...new Set([
			...names.flatMap(distinctiveWords),
			...domains.map(domainLabelOf).filter((d): d is string => d != null),
		]),
	]

	if (cores.length === 0 && words.length === 0 && domains.length === 0)
		return null
	const places = queryPlaces(args.query, args.location)
	return { cores, words, domains, places }
}

/**
 * Fold a redirect destination host into a run's targets. When the caller's own
 * domain 301/302-redirects to a different host — a rebrand — that destination is
 * the same company's official site, so its host becomes a strong-match key (and
 * its label a weak one), exactly as if the caller had supplied it as the website.
 * A no-op when the host is already a target domain.
 */
export const withRedirectDomain = (
	targets: EntityTargets,
	destHost: string,
): EntityTargets => {
	if (targets.domains.includes(destHost)) return targets
	const label = domainLabelOf(destHost)
	return {
		cores: targets.cores,
		domains: [...targets.domains, destHost],
		words:
			label != null && !targets.words.includes(label)
				? [...targets.words, label]
				: targets.words,
		places: targets.places,
	}
}

/**
 * The single official-site host to fetch up front for an entity run, or undefined
 * when there is none to anchor on. The human-corrected domain wins, then an
 * anchored subject's own website, then a domain written into the query. Only a
 * single-target run (an entity-grounded schema, or one with an anchored subject)
 * reads the query — a scan has no one official site, so it never anchors.
 */
export const deriveAnchorHost = (args: {
	schemaName: string
	query: string
	subjects: ReadonlyArray<EntityTarget>
	anchorDomain?: string | undefined
}): string | undefined => {
	const fromAnchor =
		args.anchorDomain != null ? domainHost(args.anchorDomain) : undefined
	if (fromAnchor !== undefined) return fromAnchor
	const fromSubject = args.subjects
		.map(s => s.website)
		.filter((w): w is string => w != null && w.trim() !== '')
		.map(domainHost)
		.find((h): h is string => h !== undefined)
	if (fromSubject !== undefined) return fromSubject
	const anchored = args.subjects.length > 0
	if (!isEntityGroundedSchema(args.schemaName) && !anchored) return undefined
	return parseQueryDomain(args.query)
}

export type EntityMatch = 'strong' | 'weak' | 'absent'

/**
 * Classifies how strongly the evidence corpus concerns the target. `corpus` is
 * the evidence-only text (scraped pages + tool results), never the model's prose.
 */
export const classifyEntityMatch = (
	targets: EntityTargets,
	corpus: string,
): EntityMatch => {
	const lowerCorpus = corpus.toLowerCase()
	const collapsed = collapse(corpus)
	// Reaching the target's own site (its exact host appears in the text) or a
	// page that spells the whole name is a strong signal the run landed on it.
	const strong =
		targets.domains.some(host => lowerCorpus.includes(host)) ||
		targets.cores.some(core => collapsed.includes(core))
	if (strong) return 'strong'
	// A lone distinctive word is a weak signal — the target may be mentioned, but
	// the run never clearly landed on it.
	const weak = targets.words.some(word => collapsed.includes(word))
	return weak ? 'weak' : 'absent'
}

/** Whether the evidence mentions any of the queried location's distinctive place
 * words — the queried company "in that city", not a same-named company elsewhere.
 * Always false when no location was supplied, so the city check fails open. */
export const placesCorroborate = (
	targets: EntityTargets,
	corpus: string,
): boolean => {
	if (targets.places.length === 0) return false
	const collapsed = collapse(corpus)
	return targets.places.some(place => collapsed.includes(place))
}

/** Whether the run actually reached the company's own site — a fetched page whose
 * host is a target domain, or whose registrable label is (part of) the company's
 * name. A name written only on third-party pages (news, directories) is not an
 * own-site reach. Judges pages already read and leans towards yes; picking a site
 * still to be read is the stricter `isOwnSiteHost`. */
export const reachedOwnSite = (
	targets: EntityTargets,
	pages: ReadonlyArray<{ readonly host?: string | undefined }>,
): boolean =>
	pages.some(page => {
		if (page.host === undefined) return false
		if (targets.domains.includes(page.host)) return true
		const label = domainLabelOf(page.host)
		if (label === undefined) return false
		const folded = collapse(label)
		// The host's label has to carry the whole name, not merely be carried by it.
		// A company named after its trade contains the trade as a word, so reading
		// the test the other way would hand it the trade's own domain — and whoever
		// really owns that domain would have their mailbox read as this company's.
		return (
			targets.words.includes(label) ||
			targets.cores.some(core => folded.includes(core))
		)
	})

/**
 * Whether a host is the company's own site, rather than somebody's page about it.
 * This picks the one site a run then goes and reads, so a wrong yes sends it off
 * to read a directory as if it were the company — stricter on purpose than
 * `reachedOwnSite`, which only asks whether a run got anywhere near the company.
 *
 * The name has to BE the domain, not merely appear inside it: "Acme Logistics" is
 * at home on acmelogistics.com and on the shorter acme.com, since a company often
 * registers less than its full name, but not on acme-directory.com.
 */
export const isOwnSiteHost = (
	targets: EntityTargets,
	host: string,
): boolean => {
	if (targets.domains.includes(host)) return true
	const label = domainLabelOf(host)
	if (label === undefined) return false
	const folded = collapse(label)
	// The domain spells out the whole name, with at most the legal form tacked on
	// — "Fusteria Miquel" at fusteriamiquel.cat or fusteriamiquelsl.cat. Anything
	// else appended is somebody writing about the company rather than the company
	// itself: acmelogisticsreviews.com is a review site.
	const spellsOutTheName = labelSpellsOneOf(
		folded,
		targets.cores.filter(core => core.length >= DISTINCTIVE_NAME_LENGTH),
	)
	// Or the domain is one distinctive word of the name, which is how most firms
	// register: "Transportes García" lives at garcia.es. Only a distinctive word
	// counts, so the trade a company is in — which identifies nobody — cannot
	// hand it transportes.com.
	return spellsOutTheName || targets.words.includes(folded)
}

/**
 * Tightens a name-only strong match with the queried location. A page that merely
 * spells the company name reads as 'strong' even when it is about a different
 * company sharing the name, or a stale mention of one that has since been renamed
 * or acquired. When the caller gave a city, the run reached no official site, and
 * no register confirmed the company, require that city to appear in the evidence
 * too — otherwise downgrade so the run fails closed rather than shipping a
 * lookalike's profile. Fails open (keeps) whenever a city was not supplied, an
 * own site was reached, or a register confirmed the match, so it never costs a
 * genuinely-grounded run.
 */
export const cityGate = (args: {
	targets: EntityTargets
	corpus: string
	pages: ReadonlyArray<{ readonly host?: string | undefined }>
	registryConfirmed: boolean
}): 'keep' | 'downgrade' => {
	const { targets, corpus, pages, registryConfirmed } = args
	if (targets.places.length === 0) return 'keep'
	if (registryConfirmed) return 'keep'
	if (reachedOwnSite(targets, pages)) return 'keep'
	if (placesCorroborate(targets, corpus)) return 'keep'
	return 'downgrade'
}

/**
 * Whether a `registry_lookup` tool result confirms the target company. True only
 * when the lookup resolved a real company — a record carrying a `legalName`, not a
 * `{status:'no_registry'}` miss — whose legal name strongly matches the run's
 * entity targets. A registry's fuzzy name search can surface a look-alike, so the
 * legal name must clear the same 'strong' bar scraped evidence does, not merely be
 * present. Returns false when there are no targets (a discovery scan) or the result
 * is not a resolved record.
 */
export const isConfirmedRegistryMatch = (
	targets: EntityTargets | null,
	result: unknown,
): boolean => {
	if (targets === null) return false
	if (result === null || typeof result !== 'object') return false
	const record = result as { legalName?: unknown; status?: unknown }
	if (typeof record.legalName !== 'string' || record.legalName.trim() === '')
		return false
	if (record.status === 'no_registry') return false
	return classifyEntityMatch(targets, record.legalName) === 'strong'
}

export interface SourceEntityVerdict {
	readonly sourceId: string
	readonly match: EntityMatch
}

/**
 * Classify each fetched source on its own. A run that reached the target's pages
 * AND a same-named other company's pages can then keep the target's and drop the
 * rest, instead of blurring them into one whole-corpus verdict.
 *
 * A page whose own host is one of the target's domains is the company's own page — an
 * offices, contact, or team page that never spells the full name still belongs to it —
 * so it is grounded on its host, not on whether its body repeats the name. That keeps a
 * real own-site page (and the location or people it carries) in the evidence instead of
 * dropping it for reading nothing but an address.
 */
export const classifyEntityMatchPerSource = (
	targets: EntityTargets,
	sources: ReadonlyArray<{
		readonly sourceId: string
		readonly text: string
		readonly host?: string | undefined
	}>,
): ReadonlyArray<SourceEntityVerdict> =>
	sources.map(source => ({
		sourceId: source.sourceId,
		match:
			source.host !== undefined && targets.domains.includes(source.host)
				? 'strong'
				: classifyEntityMatch(targets, source.text),
	}))

/** The sources that concern the target (strong or weak) — the pages worth keeping. */
export const groundedSourceIds = (
	verdicts: ReadonlyArray<SourceEntityVerdict>,
): ReadonlyArray<string> =>
	verdicts
		.filter(verdict => verdict.match !== 'absent')
		.map(verdict => verdict.sourceId)

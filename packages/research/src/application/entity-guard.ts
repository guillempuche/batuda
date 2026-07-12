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
 *              clearly landed on the target, so it fails closed as no_reliable_data
 *              rather than present a lookalike's pages as the target's profile;
 *  - 'absent'  nothing in the evidence names the target — the run is misattributed
 *              and also fails closed as no_reliable_data.
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
const collapse = (value: string): string =>
	value
		.normalize('NFKD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase()
		.replace(/[^a-z0-9]/g, '')

// Accent-folded word tokens of a name, punctuation split out.
const foldTokens = (value: string): string[] =>
	value
		.normalize('NFKD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter(Boolean)

// The whole name minus its legal suffix, collapsed — "Acme Logistics S.L." →
// "acmelogistics". This is the strong-match key: it appears verbatim on the
// company's own pages but is long enough not to hit by coincidence.
const nameCore = (name: string): string =>
	foldTokens(name)
		.filter(t => !LEGAL_SUFFIXES.has(t))
		.join('')

// The distinctive words of a name: each ≥4 chars and neither a legal suffix nor a
// generic industry term. These drive the weak match.
const distinctiveWords = (name: string): string[] =>
	foldTokens(name).filter(
		t => t.length >= 4 && !LEGAL_SUFFIXES.has(t) && !GENERIC_WORDS.has(t),
	)

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

// The distinctive label inside a host — "acme" from "acme.co.uk" — used only as a
// weak signal alongside the name's own words.
const domainLabelOf = (host: string): string | undefined => {
	const labels = host.split('.').filter(Boolean)
	labels.pop() // drop the TLD
	if (labels.length >= 2 && SECOND_LEVEL.has(labels[labels.length - 1] ?? '')) {
		labels.pop() // drop a second-level public suffix (co.uk, com.au…)
	}
	const label = labels[labels.length - 1]
	return label && label.length >= 4 ? label : undefined
}

// A caller often wraps the company name in quotes inside a longer instruction
// ("Research \"Acme Corp\" (acme.com) — find headcount…"), so the quoted phrase,
// not the whole sentence, is the name to match on. Straight and curly double
// quotes, 2–80 chars so it can't swallow a paragraph.
const QUOTED_NAME = /["“]([^"”]{2,80})["”]/

// A free-text query's company name: the first quoted phrase if one is present,
// else the part before the first comma ("Sunset Transportation, St. Louis MO");
// fall back to the whole query.
const queryName = (query: string): string =>
	query.match(QUOTED_NAME)?.[1] ?? query.split(',')[0] ?? query

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
}

// Only these schemas make a claim about their OWN named subject. A scan playbook
// legitimately reports third-party companies, so it is never entity-gated;
// freeform makes no entity guarantee.
const ENTITY_GROUNDED_SCHEMAS = new Set([
	'company_enrichment_v1',
	'contact_discovery_v1',
])

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
}): EntityTargets | null => {
	const anchored = args.subjects.length > 0
	if (!ENTITY_GROUNDED_SCHEMAS.has(args.schemaName) && !anchored) return null

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
	const cores = names.map(nameCore).filter(c => c.length >= 4)
	const words = [
		...new Set([
			...names.flatMap(distinctiveWords),
			...domains.map(domainLabelOf).filter((d): d is string => d != null),
		]),
	]

	if (cores.length === 0 && words.length === 0 && domains.length === 0)
		return null
	return { cores, words, domains }
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
	if (!ENTITY_GROUNDED_SCHEMAS.has(args.schemaName) && !anchored)
		return undefined
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
 */
export const classifyEntityMatchPerSource = (
	targets: EntityTargets,
	sources: ReadonlyArray<{ readonly sourceId: string; readonly text: string }>,
): ReadonlyArray<SourceEntityVerdict> =>
	sources.map(source => ({
		sourceId: source.sourceId,
		match: classifyEntityMatch(targets, source.text),
	}))

/** The sources that concern the target (strong or weak) — the pages worth keeping. */
export const groundedSourceIds = (
	verdicts: ReadonlyArray<SourceEntityVerdict>,
): ReadonlyArray<string> =>
	verdicts
		.filter(verdict => verdict.match !== 'absent')
		.map(verdict => verdict.sourceId)

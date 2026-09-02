/**
 * Folds the rows of one discovery scan that are the same company into one row.
 *
 * A broad search meets a company on a directory, again in a ranking, and again in a
 * news piece, and each meeting can spell it differently — "Cobra Instalaciones y
 * Servicios" and "COBRA INSTALACIONES Y SERVICIOS SA" are one company written twice.
 * Nothing else in the chain catches it: the other duplicate check compares a row
 * against companies already on file, never against another row of the same answer.
 * A list of 62 that is 52 companies is the reader's problem to sort out by hand,
 * and it is the same work every time the scan runs.
 *
 * Two rows are the same company when either their names or their sites say so:
 *  - the same name once its legal form is off the end, so "…y Servicios" and
 *    "…Y SERVICIOS SA" meet, and accents fold on the way;
 *  - the same site host, once the domain spells one of them, which catches the pair
 *    a rename or a trade name hides.
 * Either alone is enough, and sameness carries: A meeting B by name and B meeting C
 * by host makes all three one company, which is what they are.
 *
 * A branch office is the third route, and neither of those two can see it. A company
 * publishes a page per branch, and the scan brings back the company once and each
 * branch again — "Terre Solaire" beside "Terre Solaire – agence Lyon". The names are
 * not the same name, and a branch page rarely carries a site of its own, so there is
 * no host either. What the run can see is the shape: a row whose name is another
 * row's name and then some, ending in the very town this row says it sits in. That
 * reads as one company's own branch, and it reads that way in any language, without
 * knowing what "agence" means. See `branchOfficeParents` for why the shape has to be
 * that tight — "one name starts the other" alone would fold two real companies that
 * merely open with the same word.
 *
 * A note written after the name is the fourth, and it is a different kind of thing
 * from the other three: not another company to find, but a phrase the scan added to
 * a name it had already written down — "KBE Energy (Annuaire Tecsol entry)" beside
 * "KBE Energy". Taking brackets off every name before filing it would fold "Acme
 * (UK)" into "Acme (US)" as well, so what makes this safe is the list rather than
 * the brackets: the plain name has to be on it, and it has to carry one note or
 * none. See `bracketedNoteParents`.
 *
 * What none of the four can reach, and it is not for want of trying: one name that
 * is another and then more words, with no town to anchor it — "SNEF" beside "Groupe
 * SNEF", "VOLTEC" beside "Voltec Power Technology Solutions". Each is one company
 * written twice. They are also the same shape, row for row, as "Terre Solaire"
 * beside a real and different "Terre Solaire Energie": a name, that name plus words,
 * and nothing else on either row to read. Put those two lists side by side and they
 * are identical field for field, so no rule reading the rows can answer differently
 * for them — the difference is only that "Groupe" adds nothing to a name where
 * "Energie" adds something, which is a list of words per language. This is not a
 * rule nobody has found yet; it is a rule that cannot be written from what a row
 * carries.
 *
 * A pair spelled slightly differently lands on that same wall rather than on one of
 * its own. "PPVS – Facilities Management" beside "PPVS – Facility Management France"
 * is one company, and folding the plural away is the smaller half of the problem:
 * grant it for free and what is left is "…facilit* management" beside "…facilit*
 * management france" — one name being the other plus a trailing word, with the row
 * stating no town for that word to be checked against. So closing it needs the case
 * above closed first, and that one is closed to any rule of this kind.
 *
 * Both stay two rows, and what the fold leaves standing is counted rather than
 * joined: the measurement of how many duplicates a list still holds reads the same
 * pairs far more loosely, precisely because a count that overstates costs a reader
 * a look, where a fold that overstates costs a real company its place on the list.
 *
 * The first row stays and the later ones fill its gaps — a tax id one meeting found
 * and the other did not, the site only the ranking printed — with their citations
 * added to its own. Nothing is overwritten: where both rows state a field, the first
 * one's reading is the one the checks upstream already weighed. Dropping the later
 * rows outright would throw away everything the run paid to find on them, which is
 * the reason this merges instead of filtering.
 *
 * Branches are the one exception to both of those, because they are the one case
 * where the later rows are about somewhere else. The company's own name survives
 * even when the list met a branch first, and every branch's town is kept beside the
 * others rather than the first arrival standing for all of them — a company working
 * from four towns is worth knowing about, and four towns is what the run found.
 *
 * A shared host only counts once something establishes it as one of the rows' own
 * site. The website check ahead of this does blank an address several rows claim and
 * none of them is named by — but it weighs one reading at a time, and a search that
 * looks again round after round hands it a single claimant each time. A trade body's
 * member page given to one company this round and to another the next is never two
 * claims at once, so it survives every pass and arrives here looking like a site two
 * rows share. What tells that apart from a real shared site is whether the domain
 * spells either company: a host that is nobody's own is no evidence that two
 * companies are one. Where it is somebody's own, the rows beside them on it are that
 * company again under another name, which is the pair this fold exists for.
 *
 * What that costs, on purpose: one company written twice at a domain that spells
 * neither writing of it — an acronym, a name with a word in front — stays two rows,
 * and the reader sorts it out. That is the direction to be wrong in. A duplicate is
 * a nuisance on a list somebody reads; a wrong fold takes a real company off it with
 * nothing said, and — since a row is confirmed by the websites naming it — hands the
 * survivor evidence gathered about somebody else.
 */

import {
	collapse,
	DISTINCTIVE_NAME_LENGTH,
	foldReadsEveryLetter,
	foldTokens,
	nameCore,
	nameCoreTokens,
	withoutFormDots,
} from './entity-guard'
import { isPlainObject, readTextValue } from './guard-shapes'
import { NAME_ONLY_EVIDENCE_FIELD } from './name-only-guard'
import { ownSiteVerdict } from './own-site'
import { rowGroups } from './row-groups'
import { MARKS_FIELD, OUTSIDE_PLACE_REASON_FIELD } from './row-marks'
import type { RunWords } from './run-words'
import { hostOf, isBareWebAddress } from './source-key'

// What marks a key as filing a row under its site. Written once, because a caller
// asking which key joined two rows reads the same mark this writes.
const SITE_KEY_PREFIX = 'host:'

// The host of a row's own site, or null when the field holds nothing an address can
// be read from. Null is also what a branch page looks like: it is the head office
// that registers the domain, and the branch is a page on it at most.
const siteHostOf = (row: Record<string, unknown>): string | null => {
	const website = readTextValue(row['website'])
	return website !== null && isBareWebAddress(website) ? hostOf(website) : null
}

// A name and the note somebody wrote after it in brackets — "KBE Energy (Annuaire
// Tecsol entry)" is the name "KBE Energy" with a note saying where it was found.
// Read off the name as written, because folding a name into words drops the
// brackets before anything can see them.
//
// The note has to close at the very end of the name, and there has to be a name in
// front of it to keep: a value that is nothing but a bracketed phrase names no
// company for another row to be a second reading of.
const TRAILING_NOTE = /^(.*\S)\s*\(([^()]*)\)\s*$/

// The company a name names, with any note off the end — "KBE Energy (Annuaire
// Tecsol entry)" is the company "KBE Energy". The name as written when it carries
// no note.
const withoutTrailingNote = (name: string): string =>
	TRAILING_NOTE.exec(name)?.[1] ?? name

/**
 * The hosts among these rows that a row is established as owning — the domain
 * spells that company, so the site is plainly its own.
 *
 * Read across the whole list at once rather than row by row, because the pair this
 * answers for is a company met under two names: "SICE" on sice.com beside
 * "Sociedad Ibérica de Construcciones Eléctricas" on the same host, where only the
 * first name spells the domain. One row establishing the host settles who it
 * belongs to for every row standing on it — the same reasoning the website check
 * makes when it stands its shared-host rule down.
 *
 * Nothing here clears a host, and nothing needs to: a host no row establishes is
 * `unknown`, which is not a verdict that two rows are different companies. It is
 * only the absence of a reason to say they are the same one, and the names still
 * have their say.
 *
 * `runWords` are the trades the run went looking for, handed down so this reads
 * an address exactly as the rest of the run reads it. Without them two firms named
 * after one trade would both own that trade's bare domain, and the key that folds
 * rows by site would make them one company.
 */
export const hostsEstablishedAsOwn = (
	rows: ReadonlyArray<unknown>,
	runWords: RunWords,
): ReadonlySet<string> => {
	const hosts = new Set<string>()
	for (const row of rows) {
		if (!isPlainObject(row)) continue
		const website = readTextValue(row['website'])
		const name = row['name']
		// Nothing to read: no address, or no company for a domain to spell. Either
		// way nothing is established, which is the answer rather than a missing one.
		if (website === null || typeof name !== 'string') continue
		// Filed under the host the identity key would file it under, so the row that
		// establishes a site and the row that needs it meet on the same spelling.
		const host = siteHostOf(row)
		if (host === null) continue
		// Judged on the company's name, not on a note written after it. A scan that
		// writes down where it met a company — "KBE Energy (Annuaire Tecsol entry)" —
		// puts the directory's own words into the name field, and reading those would
		// have the directory spell the company and so pass for its own site. Every
		// other row on that directory would then be filed under it as the same
		// company, which merges firms that have nothing to do with each other.
		if (
			ownSiteVerdict({
				name: withoutTrailingNote(name),
				website,
				runWords,
			}) === 'established'
		)
			hosts.add(host)
	}
	return hosts
}

/**
 * What a row is filed under: its name with the legal form off the end, and the host
 * of its site when that host is one of `ownSiteHosts`. Either identifies the company
 * on its own. A key nothing can be read from is left out rather than becoming a key
 * every thin row shares.
 *
 * `ownSiteHosts` comes from `hostsEstablishedAsOwn`, over every row this key is
 * about to be compared against — both sides of a fold, not one. It is asked for
 * rather than worked out here so a caller cannot compare keys read from two
 * different readings of who owns what.
 *
 * Exported because the fold here is not the only place one company can arrive
 * twice: a later round that looks again for a company's missing fields matches what
 * it finds against the list, and matching on anything looser would file the same
 * company under its fuller legal name as somebody new.
 */
export const discoveryRowIdentityKeys = (
	row: Record<string, unknown>,
	ownSiteHosts: ReadonlySet<string>,
): ReadonlyArray<string> => {
	const keys: Array<string> = []
	const name = row['name']
	if (typeof name === 'string') {
		// A name that is nothing but a legal form leaves no core to file under. It
		// still has to file under something, or two rows carrying the same useless
		// name have no key to meet on and the list keeps every copy of it.
		const core = nameCore(withoutFormDots(name))
		// Only where the fold read the whole name, though. Where it dropped letters,
		// what is left is the Latin somebody wrote beside them, and every company
		// ending "Co., Ltd" would meet on that and become one row.
		const filedAs =
			core === '' && foldReadsEveryLetter(name) ? collapse(name) : core
		if (filedAs !== '') keys.push(`name:${filedAs}`)
		const alsoCalled = legalNameInBrackets(name)
		if (alsoCalled !== null) keys.push(`name:${alsoCalled}`)
	}
	const host = siteHostOf(row)
	if (host !== null && ownSiteHosts.has(host))
		keys.push(`${SITE_KEY_PREFIX}${host}`)
	return keys
}

/**
 * Whether a key files a row under its site rather than its name.
 *
 * Exported so a caller can tell which of the two joined two rows without taking
 * the key apart itself. A join two names made is the ordinary one; a join a site
 * made on its own is the one worth counting, and it is what the fold is asked to
 * be careful about.
 */
export const isSiteKey = (key: string): boolean =>
	key.startsWith(SITE_KEY_PREFIX)

// Whether one name says another name and then more, word for word — "Terre Solaire"
// starts "Terre Solaire – agence Lyon". Whole words, because the letters alone would
// also have "Terre Solaire" start "Terres Solaires", which is a different company.
const saysThenMore = (
	name: ReadonlyArray<string>,
	opening: ReadonlyArray<string>,
): boolean =>
	opening.length < name.length && opening.every((word, at) => name[at] === word)

/**
 * The company's other name, when it was written in brackets after the first one.
 *
 * A scan writes one company three ways — "SOPREMA (Castellbisbal)", "SOPREMA
 * (SOPREMA IBERIA, S.L.)" and "SOPREMA IBERIA S.L.U." — and the middle one is the
 * only thing tying the other two together, because it says both names. Filing it
 * under the bracketed name as well lets it meet the row written that way.
 *
 * Only when the brackets repeat the name outside them. That is what tells a
 * second name from a note: "SOPREMA (SOPREMA IBERIA, S.L.)" is also SOPREMA
 * IBERIA, while "SOPREMA (Castellbisbal)" is not also Castellbisbal, and
 * "Acme (UK)" is not also UK — which is what keeps that row from meeting an
 * unrelated company that happens to sit in the same place. Taking the brackets
 * off every name instead would fold "Acme (UK)" into "Acme (US)", which is why
 * the rule above still asks for the plain name to be on the list.
 *
 * Null when there are no brackets, when they hold a note rather than a name, or
 * when both spellings come to the same key and the row is already filed there.
 */
const BRACKETED_QUALIFIER = /^(.*?)[([]([^)\]]+)[)\]]\s*$/

const legalNameInBrackets = (name: string): string | null => {
	const match = BRACKETED_QUALIFIER.exec(name.trim())
	const outside = match?.[1]?.trim()
	const inside = match?.[2]?.trim()
	if (outside === undefined || outside === '' || inside === undefined)
		return null
	const outsideCore = nameCore(withoutFormDots(outside))
	const insideCore = nameCore(withoutFormDots(inside))
	if (outsideCore === '' || insideCore === outsideCore) return null
	// The brackets have to *start* on the name outside them, not merely contain
	// it somewhere. A short name turns up inside an unrelated word by chance —
	// "Ara (Zaragoza)" would file a company called Ara under Zaragoza, and meet
	// any company actually called that — while the case this exists for reads the
	// name and then more: SOPREMA, then SOPREMA IBERIA.
	return insideCore.startsWith(outsideCore) ? insideCore : null
}

/**
 * For each row that reads as another row's branch office, which row it belongs to,
 * both named by their place in the list.
 *
 * A row is one of another's branches when all four hold:
 *  - its name says that row's name and then more;
 *  - it carries no site of its own, so it is not claiming a separate presence — and
 *    a branch that gives the head office's address has already met it on the host;
 *  - it says where it is;
 *  - and its name **ends** on a word of that place. This is the whole of the rule's
 *    safety. "One name starts the other" would fold "Terre Solaire" into a real and
 *    different "Terre Solaire Energie"; asking that the name end on the town the row
 *    itself claims does not, because "Energie" is not where anyone is. It is also
 *    the reason there is no list of the words a branch is announced with — "agence",
 *    "sucursal", "Niederlassung" — which would only be the languages somebody
 *    thought of: the row tells us its own town, so nothing has to be known in
 *    advance. It is the last word rather than any word, so that a joiner the place
 *    happens to share — "Acme del Norte" sitting in "Puerto del Rosario" — cannot
 *    pass for the town.
 *
 * A branch hangs off the longest name it could hang off, never every one of them.
 * With "Acme", "Acme Solar" and "Acme Solar Lyon" on one list, the last belongs to
 * "Acme Solar"; letting it belong to both would drag "Acme" and "Acme Solar" into
 * one company through it, and those two are exactly the pair this must keep apart.
 *
 * A name too short to stand for a company on its own is no anchor for anybody's
 * branches, so it is passed over rather than collecting every longer name on the
 * list.
 *
 * What this still cannot tell apart: a company whose whole name is the trade it
 * works in, sitting on a list beside unrelated firms called that trade and a town.
 * "Electricidad" would take "Electricidad Madrid" and "Electricidad Barcelona" for
 * its branches. Requiring the row above to be present at all is what bounds it —
 * the pattern alone folds nothing — and going further means judging a name generic,
 * which is a list of trade words in whichever languages somebody thought of.
 *
 * Exported because the measurement of how many duplicates a list still holds reads
 * a returned list with the same eyes the fold does. A shape the fold acts on and
 * the count cannot see would report a clean list every time.
 */
export const branchOfficeParents = (
	rows: ReadonlyArray<unknown>,
): ReadonlyMap<number, number> => {
	const names = rows.map(row =>
		isPlainObject(row) && typeof row['name'] === 'string'
			? nameCoreTokens(withoutFormDots(row['name']))
			: null,
	)
	// Long enough to stand for a company, worked out once per row rather than again
	// for every longer name it is held up against.
	const anchors = names.map(
		name => name !== null && name.join('').length >= DISTINCTIVE_NAME_LENGTH,
	)
	const parents = new Map<number, number>()
	rows.forEach((row, at) => {
		const name = names[at]
		if (!isPlainObject(row) || name == null) return
		if (siteHostOf(row) !== null) return
		const place = readTextValue(row['location'])
		if (place === null) return
		const town = new Set(foldTokens(place))
		const trailing = name[name.length - 1]
		if (trailing === undefined || !town.has(trailing)) return

		let hangsOff: number | undefined
		let longest = 0
		names.forEach((opening, openingAt) => {
			if (opening === null || !anchors[openingAt]) return
			if (!saysThenMore(name, opening) || opening.length <= longest) return
			hangsOff = openingAt
			longest = opening.length
		})
		if (hangsOff !== undefined) parents.set(at, hangsOff)
	})
	return parents
}

/**
 * For each row whose name ends in a note written in brackets, the row carrying
 * that same name without one.
 *
 * A scan meets a company on a directory and writes down where it met it —
 * "KBE Energy (Annuaire Tecsol entry)" — or writes the trade it found the company
 * under after the name — "2C ENERGIES (CHAUFFAGE CLIMATISATION ENERGIES)". Neither
 * bracketed phrase is part of what the company is called, so the two rows are the
 * same company written twice, and the plain one is the writing to keep.
 *
 * Taking the brackets off before filing every row would be the obvious move and is
 * the wrong one: it also files "Acme (UK)" and "Acme (US)" as one company, and
 * those are two. Two things keep this apart from that, and both are about the shape
 * of the list rather than what any word means:
 *
 *  - **The plain name has to be on the list.** A note only reads as a note when the
 *    same name is there without it, which is the row it is a second reading of.
 *    "Acme (UK)" beside "Acme (US)" and no bare "Acme" folds nothing.
 *  - **One note, or none.** Where a name carries two different notes, the brackets
 *    are telling the rows apart rather than annotating one of them, so all of them
 *    are left alone — including where the bare name is on the list too. "Acme",
 *    "Acme (UK)" and "Acme (US)" stays three rows.
 *
 * A row is also left alone when ONE of the two stands at a domain that spells it
 * while the other names a different address. That is the most a row can say about
 * being somebody separate, and it outranks a bracket — and only the row whose
 * domain spells it has to say it, since a row that cannot spell its own domain is
 * not thereby standing in the same place as anybody.
 *
 * Established is the whole of that, and asking for less costs a real fold: a live
 * French search returned "Société Nouvelle Garraud" citing another company's site
 * and "SOCIÉTÉ NOUVELLE GARRAUD (SN GARRAUD)" citing a Facebook page. Two different
 * hosts, and neither is either company's own — a host nobody is named by says
 * nothing about who anybody is, so it is no reason to hold a note apart from the
 * name it annotates. `ownSiteHosts` is asked for rather than worked out here for the
 * same reason `discoveryRowIdentityKeys` asks: who owns a host is read across the
 * whole list, and a caller must not compare one reading of that against another.
 *
 * What this still cannot tell apart, and nothing on the row can: one company
 * genuinely registered with brackets in its name, on a list beside another row that
 * is the same name without them. Requiring the plain row to be present is what
 * bounds it — the brackets alone fold nothing.
 *
 * Exported for the same reason `branchOfficeParents` is: the measurement of how
 * many duplicates a list still holds reads a returned list with the same eyes the
 * fold does, and a shape the fold acts on and the count cannot see would report a
 * clean list every time.
 */
export const bracketedNoteParents = (
	rows: ReadonlyArray<unknown>,
	ownSiteHosts: ReadonlySet<string>,
): ReadonlyMap<number, number> => {
	const readings = rows.map(row => {
		if (!isPlainObject(row) || typeof row['name'] !== 'string') return null
		const written = row['name']
		const noted = TRAILING_NOTE.exec(written)
		const [, beforeTheNote, theNote] = noted ?? []
		const core = nameCore(withoutFormDots(beforeTheNote ?? written))
		// A name with nothing but a legal form in front of the brackets leaves no
		// company for the plain row to be the same one as.
		if (core === '') return null
		const host = siteHostOf(row)
		return {
			core,
			host,
			note: noted === null ? null : collapse(theNote ?? ''),
			ownSite: host !== null && ownSiteHosts.has(host) ? host : null,
		}
	})

	// The first row written plainly under each name, and the distinct notes the rest
	// of them wrote after it.
	const plainRowOf = new Map<string, number>()
	const notesOn = new Map<string, Set<string>>()
	readings.forEach((reading, at) => {
		if (reading === null) return
		if (reading.note === null) {
			if (!plainRowOf.has(reading.core)) plainRowOf.set(reading.core, at)
			return
		}
		const notes = notesOn.get(reading.core)
		if (notes === undefined) notesOn.set(reading.core, new Set([reading.note]))
		else notes.add(reading.note)
	})

	const parents = new Map<number, number>()
	readings.forEach((reading, at) => {
		if (reading === null || reading.note === null) return
		const plain = plainRowOf.get(reading.core)
		if (plain === undefined) return
		if ((notesOn.get(reading.core)?.size ?? 0) > 1) return
		const plainHost = readings[plain]?.host ?? null
		const plainOwnSite = readings[plain]?.ownSite ?? null
		// One row standing at a domain that spells it, while the other names a
		// different address, is two rows saying they are in two different places —
		// and only the row whose domain spells it has to say so.
		//
		// Asking BOTH to say it put the hold on the weaker of the two readings:
		// whichever row could not establish a site handed the other's claim away. A
		// name made of nothing but the trade's own words can never spell its own
		// domain, so such a row folded into any plain row of that name wherever it
		// stood.
		const oneStandsSomewhereTheOtherIsNot =
			(reading.ownSite !== null &&
				plainHost !== null &&
				reading.ownSite !== plainHost) ||
			(plainOwnSite !== null &&
				reading.host !== null &&
				plainOwnSite !== reading.host)
		if (oneStandsSomewhereTheOtherIsNot) return
		parents.set(at, plain)
	})
	return parents
}

// What tells two citations apart: the page each names, as written. Only the case
// and the space around it are ignored — every other character of an address does
// real work, and folding them away would file "/about-us" and "/aboutus" as one
// page and quietly drop the second one's evidence.
const citationKey = (citation: unknown): string =>
	isPlainObject(citation) && typeof citation['source_id'] === 'string'
		? citation['source_id'].trim().toLowerCase()
		: JSON.stringify(citation)

// The citations of both rows, with a page cited twice kept once. A row's evidence is
// the reason to believe it, so a merge that dropped half of it would leave the
// surviving row looking thinner than the run's actual reading.
const mergeCitations = (kept: unknown, added: unknown): unknown => {
	if (!Array.isArray(kept)) return Array.isArray(added) ? added : kept
	if (!Array.isArray(added)) return kept
	const seen = new Set(kept.map(citationKey))
	const extra = added.filter(citation => {
		const key = citationKey(citation)
		if (seen.has(key)) return false
		seen.add(key)
		return true
	})
	return extra.length === 0 ? kept : [...kept, ...extra]
}

// Whether a place is one of those already named, allowing for one of the two being
// written at more detail — "Lyon" beside "Lyon, Rhône" is one town said twice, and
// listing both would invent a branch the company has not got. Every word of one has
// to appear in the other, rather than one address merely reading inside the other:
// "Roa" sits inside "Roanne" letter for letter, and those are two towns.
const alreadyNamed = (places: string, place: string): boolean => {
	const words = foldTokens(place)
	return places.split(';').some(named => {
		const already = foldTokens(named)
		// One of the two comes apart into no words at all — a place written in a
		// script this folding drops, like "東京". Fall back to the text as written, so
		// a place the code cannot read is added rather than quietly lost: a town
		// stated twice is a small harm beside a town the run found and threw away.
		if (words.length === 0 || already.length === 0)
			return named.trim().toLowerCase() === place.trim().toLowerCase()
		return (
			already.every(word => words.includes(word)) ||
			words.every(word => already.includes(word))
		)
	})
}

// The places already named, plus one more when it is not among them. When a fold puts
// a company's branches onto the row that stays, each branch states the only place it
// has, and keeping whichever arrived first would drop the rest with nothing said.
// Semicolons separate them because a single place is written with commas in it
// already ("Alcobendas, Madrid"), and joining on those would read as one long address.
const alsoAt = (places: unknown, added: string): string => {
	const held = typeof places === 'string' ? places : ''
	const place = added.trim()
	if (place === '') return held
	if (held.trim() === '') return place
	return alreadyNamed(held, place) ? held : `${held}; ${place}`
}

// What a guard worked out about one row, which is true of that row and of nothing
// else. Every other field is a fact about the company and so belongs to whichever
// row survives; these are findings about the meeting, and carrying one across the
// fold states it of a company nobody looked at.
const VERDICTS_ABOUT_THE_ROW_FOLDED_AWAY: ReadonlySet<string> = new Set([
	MARKS_FIELD,
	OUTSIDE_PLACE_REASON_FIELD,
	NAME_ONLY_EVIDENCE_FIELD,
])

// Fold a later meeting of the same company into the row that stays: fields it never
// filled get filled, and the pages behind the later row are added to its own.
//
// `alsoElsewhere` says this fold is a branch joining its company rather than one
// company met twice. It is the only case where the later row speaks about somewhere
// else, so it is the only one whose place is added to what the row already names
// instead of filling a gap and nothing more.
const foldInto = (
	kept: Record<string, unknown>,
	later: Record<string, unknown>,
	alsoElsewhere: boolean,
): Record<string, unknown> => {
	const merged: Record<string, unknown> = { ...kept }
	for (const [field, value] of Object.entries(later)) {
		if (value === undefined || value === null) continue
		if (field === 'citations') {
			merged['citations'] = mergeCitations(kept['citations'], value)
			continue
		}
		if (field === 'location' && alsoElsewhere) {
			// A row that names nowhere leaves the field as it found it, rather than
			// putting an empty reading where there was no field at all.
			const added = readTextValue(value)
			if (added === null) continue
			const places = alsoAt(readTextValue(merged['location']), added)
			if (places === '') continue
			// Written back in the shape it arrived in, so whatever reads it next
			// still finds the page behind it. The page named stays the surviving
			// row's; each branch's own page joins this row's citations a few lines
			// up, which is where the evidence for the towns added here lives.
			const paired = isPlainObject(merged['location'])
				? merged['location']
				: isPlainObject(value)
					? value
					: null
			merged['location'] =
				paired === null ? places : { ...paired, value: places }
			continue
		}
		// What a guard concluded about the row being folded away stays with it.
		// These are the fields where filling a gap would say something new rather
		// than carry something across: a company in Dallas met a second time as its
		// own Reno branch would take on the branch's "outside the area asked for"
		// and wear it as if somebody had judged the company itself, and a company
		// with a website and a place would take on a branch's "found only as a name
		// on a list" and report that of itself. A fold may drop such a finding,
		// never hand one out.
		if (VERDICTS_ABOUT_THE_ROW_FOLDED_AWAY.has(field)) continue
		const held = merged[field]
		if (held === undefined || held === null) merged[field] = value
	}
	return merged
}

export interface DedupeResult {
	readonly findings: unknown
	/** How many rows were folded into an earlier row for being the same company. */
	readonly merged: number
}

/**
 * `listField` is the key holding this scan's companies — `prospects` or
 * `competitors`. Anything else passes through untouched: a run about one named
 * company has no list of its own to compare.
 */
export const dedupeDiscoveryRows = (
	findings: unknown,
	listField: string | undefined,
	runWords: RunWords,
): DedupeResult => {
	if (listField === undefined) return { findings, merged: 0 }

	let merged = 0
	const dedupe = (rows: ReadonlyArray<unknown>): ReadonlyArray<unknown> => {
		// Which company each row belongs to, named by the earliest row of that
		// company. Worked out in full before anything is folded, because a row can
		// join two rows that were until then separate — one by name, the other by
		// site — and folding as it goes would settle on whichever of the two it
		// happened to meet first, leaving the other behind as a duplicate. The list
		// arrives in whatever order the model wrote it, so that would make the answer
		// depend on the order.
		const { groupOf: companyOf, join: sameCompany } = rowGroups(rows.length)

		const ownSiteHosts = hostsEstablishedAsOwn(rows, runWords)
		const rowOfKey = new Map<string, number>()
		rows.forEach((row, at) => {
			if (!isPlainObject(row)) return
			for (const key of discoveryRowIdentityKeys(row, ownSiteHosts)) {
				const seen = rowOfKey.get(key)
				if (seen === undefined) rowOfKey.set(key, at)
				else sameCompany(seen, at)
			}
		})
		const parentOfBranch = branchOfficeParents(rows)
		for (const [branch, parent] of parentOfBranch) sameCompany(parent, branch)
		const parentOfNote = bracketedNoteParents(rows, ownSiteHosts)
		for (const [noted, plain] of parentOfNote) sameCompany(plain, noted)

		// Follow a row up to the row whose name is the one to keep: a branch up to the
		// company it hangs off, a name with a note after it back to the plain writing
		// of it.
		//
		// Stops after as many steps as there are rows to visit. A branch always leaves
		// words behind and a note never comes off twice running, so a chain of either
		// alone runs out on its own — but the two can alternate, and what a list of
		// model-written names can do to that is not worth working out when the cost of
		// being wrong is a run that hangs. A chain longer than the rows it could visit
		// has been round in a circle, and stopping there answers with a real row.
		const climbFrom = (
			at: number,
			parents: ReadonlyMap<number, number>,
		): number => {
			let row = at
			for (let step = 0; step < parents.size; step++) {
				const parent = parents.get(row)
				if (parent === undefined) return row
				row = parent
			}
			return row
		}
		// A branch and a note both settle which name a company keeps. Only a branch
		// settles where it is, so the two are asked separately below.
		const nameComesFrom = new Map([...parentOfNote, ...parentOfBranch])

		// One row per company, in the order the list first met it — under the company's
		// own name, even where the list met one of its branches first. A reader given
		// "Terre Solaire – agence Lyon" for a company working from five towns has been
		// told the wrong thing about it, and which row a search happened to rank first
		// is no reason to say it.
		const keptAt = new Map<number, number>()
		const kept: Array<unknown> = []
		rows.forEach((row, at) => {
			if (!isPlainObject(row)) {
				kept.push(row)
				return
			}
			const company = companyOf(at)
			const index = keptAt.get(company)
			if (index === undefined) {
				keptAt.set(company, kept.length)
				const namedBy = rows[climbFrom(at, nameComesFrom)]
				const ownName = isPlainObject(namedBy) ? namedBy['name'] : undefined
				kept.push(
					typeof ownName === 'string' && ownName !== row['name']
						? { ...row, name: ownName }
						: row,
				)
				return
			}
			// This row speaks about somewhere else than the one it is joining when it is
			// a branch, or when it is the company itself arriving after one of its
			// branches took the place that stays. Another reading of the same branch is
			// neither, and neither is the same name with a note written after it, so
			// their place fills a gap like any other field.
			const held = kept[index]
			const elsewhere =
				parentOfBranch.has(at) || climbFrom(company, parentOfBranch) === at
			kept[index] = isPlainObject(held) ? foldInto(held, row, elsewhere) : row
			merged++
		})
		return kept
	}

	const walk = (value: unknown, key?: string): unknown => {
		if (Array.isArray(value)) {
			return key === listField ? dedupe(value) : value.map(item => walk(item))
		}
		if (isPlainObject(value)) {
			return Object.fromEntries(
				Object.entries(value).map(([k, v]) => [k, walk(v, k)] as const),
			)
		}
		return value
	}

	return { findings: walk(findings), merged }
}

/**
 * Whether a website is established as the company's OWN — the positive claim,
 * which nothing else in this package makes.
 *
 * `website-guard.ts` answers the opposite question: is this address clearly NOT
 * the company's? Its rules only ever blank, and a blank costs a real website, so
 * its bar is deliberately high and it keeps whatever it cannot condemn. That
 * makes "kept" mean "not condemned", which is not the same statement as "the
 * company owns it" — and a caller asking "is at least one of this company's
 * sources not a directory, its own site included?" reads the first and hears the
 * second. It then answers yes out of silence, which is exactly the fail-open the
 * directory watch refuses to allow itself (see `directory-sites.ts`).
 *
 * So this asks the question the other way round, with the same two-valued shape
 * the directory watch gives itself: `established`, or `unknown` — and `unknown`
 * is not a clearance. There is no third value meaning cleared, because there is
 * nothing here to answer yes with when the evidence is thin.
 *
 * ## What establishes it
 *
 * One thing, read off the address: THE DOMAIN SPELLS THE COMPANY. A firm
 * registers its own name, or the front of it, or the one word of it people use —
 * "Fusteria Miquel" at fusteriamiquel.cat, "XPO Logistics" at xpo.com,
 * "Transportes García" at garcia.es. The label has to BE one of those, never
 * merely contain it: "acme-directory.com" contains "acme" and belongs to
 * somebody else, and a listing whose own domain happens to carry a word of the
 * name would otherwise clear itself.
 *
 * ## What deliberately does NOT establish it
 *
 * **The path.** "facebook.com/Some-Company" and "xpo.com/about-xpo-logistics"
 * are the same shape — a page naming the company on a host that does not — and
 * from the address alone nothing separates them. A directory files a company at
 * a path; so does a social platform; so, sometimes, does the company itself. A
 * path names a PAGE about the company, and who publishes a page about a company
 * is the very thing in question. `website-guard.ts` reads paths, and must: a
 * name in a deeper segment is the listing signature, and the first segment is
 * exempted there so an "about us" page is not mistaken for one. Those are
 * reasons to withhold a blank. None of them is a reason to claim ownership.
 *
 * **Where the claim was read from.** A row's citations say which pages the run
 * opened, never who owns a domain. Settling ownership on provenance opens a hole
 * for every way a row can cite: one citing nothing, one whose citations a guard
 * ahead has already dropped, one with a second citation about the COMPANY but
 * not about the address, one citing by an opaque `src_…` id with no host in it,
 * and the target's own `website` field, which carries exactly one source and so
 * can never have a second. Reading no citations at all closes every one of them
 * together. It also holds a scanned row and the run's own answer to one bar,
 * and the run's own answer is where a rule that reads citations has the least
 * to go on.
 *
 * **A second page that prints the address.** Tempting, and the one clause
 * considered and dropped: a footer or a link roll prints "facebook.com" on
 * pages that have nothing to do with whose site it is, so a mention on another
 * page manufactures `established` out of ordinary web furniture — the failure
 * this verdict exists to prevent, arriving by a different door.
 *
 * ## What it costs, on purpose
 *
 * A company at a domain that spells its name with something in front of it —
 * "Penske Logistics" at gopenske.com, "Grupo Cobra" at grupocobra.com — reads
 * `unknown`, as does one at an acronym its name never spells (SICE at sice.com).
 * So does any company at a domain registered with an accent, which arrives in
 * the punycode spelling and folds to letters that spell nothing: a blind spot
 * in exactly the markets this work is for, and the reason it is written down
 * here rather than met in a run.
 *
 * In every one of those the website is still kept, since keeping is not this
 * verdict's decision; what it loses is standing as the source that vouches for
 * the company. That is a withholding, and withholding is the direction this
 * file is allowed to be wrong in.
 *
 * Closing any of them means loosening — reading past a word in front, or
 * matching initials — and each loosening is a new way to clear a stranger's
 * address. Measure the cost before paying it.
 *
 * Whether the host is a business directory is a separate question with a
 * separate answer (`directory-sites.ts`), and a caller weighing a company's
 * sources asks both.
 */

import {
	collapse,
	distinctiveWords,
	hostLabel,
	isGenericWord,
	labelSpellsOneOf,
	nameWordsWithoutForms,
	withoutFormDots,
} from './entity-guard'
import { hostOf, isBareWebAddress } from './source-key'

/**
 * What is known about a company's website. `unknown` is not "cleared". Spelled
 * as a value rather than left as the absence of one, so a caller has to name it
 * before acting on it.
 */
export type OwnSiteVerdict = 'established' | 'unknown'

// How many words a company's name runs to before what came in is a brief rather
// than a name. A run started from free text with no company on file passes its
// whole question down as the name, and every long word of a question would then
// be a word a domain could be cleared by — "Acme Corp Barcelona" clearing
// barcelona.cat. A run that does not know the company's name cannot say whose
// site anything is. Set well clear of the longest real names, which run to six
// ("Sociedad Española de Montajes Industriales"), because what sits on the other
// side of this is a paragraph rather than a seventh word.
const MOST_WORDS_A_NAME_RUNS_TO = 8

// The shortest front part a domain may be read as spelling. The large carriers
// register three letters — dsv.com, xpo.com — so the floor cannot be four; but
// one or two letters is an initial rather than a name, and a domain that short
// belongs to whoever paid for it regardless of whose initials it matches.
const SHORTEST_NAME_A_DOMAIN_SPELLS = 3

// Every name a company's own domain could plausibly be registered under: the
// whole name and each shorter run of its words from the front — "XPO Logistics"
// gives "xpo" and "xpologistics". Front-anchored, because a firm shortens its
// name by dropping the end ("Acme Logistics" at acme.com) and not by dropping
// the start, and a run taken from anywhere would let a listing filed under any
// word of the name clear itself.
const namesTheDomainCouldCarry = (
	words: ReadonlyArray<string>,
): ReadonlyArray<string> => {
	const runs: Array<string> = []
	let run = ''
	let identifiesSomebody = false
	for (const word of words) {
		run += word
		// A front part made of nothing but trade words identifies nobody, so
		// "Grupo Ferré" must not be at home on grupo.es and "Transportes García"
		// not on transportes.com. Once a word of the company's own has arrived,
		// every longer run carries it.
		identifiesSomebody = identifiesSomebody || !isGenericWord(word)
		if (identifiesSomebody && run.length >= SHORTEST_NAME_A_DOMAIN_SPELLS) {
			runs.push(run)
		}
	}
	return runs
}

/**
 * Whether a host is this company's own domain.
 *
 * The label has to spell the company: one of the names a domain could carry, or
 * one distinctive word of the name on its own — which is how most small firms
 * register. Either may have the legal form after it, and nothing else:
 * "fusteriamiquelsl.cat" is the workshop, "fusteriamiquelreviews.com" is
 * somebody writing about it.
 */
const hostSpellsTheCompany = (name: string, host: string): boolean => {
	const words = nameWordsWithoutForms(withoutFormDots(name))
	if (words.length > MOST_WORDS_A_NAME_RUNS_TO) return false
	return labelSpellsOneOf(collapse(hostLabel(host)), [
		...namesTheDomainCouldCarry(words),
		...distinctiveWords(name),
	])
}

/**
 * Whether this website is established as the company's own site.
 *
 * `name` is the company the address is claimed for — the row's own name on a
 * scanned company, and the company the run is about for the one `website` field
 * that arrives with no name beside it. A run with no name to compare establishes
 * nothing, which is the right answer rather than a missing one.
 */
export const ownSiteVerdict = (args: {
	readonly name: string
	readonly website: string
}): OwnSiteVerdict => {
	const { name, website } = args
	// A value with words written next to it is not one address, so there is no
	// domain to read — and a reader cannot open it either.
	if (!isBareWebAddress(website)) return 'unknown'
	const host = hostOf(website)
	if (host === null) return 'unknown'

	return hostSpellsTheCompany(name, host) ? 'established' : 'unknown'
}

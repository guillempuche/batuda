import { describe, expect, it } from 'vitest'

import {
	type FarmRow,
	parseFarmCorpus,
	parseFarmRow,
	rowByRow,
	scoreFarmReplay,
} from './eval-farm-replay'

const row = (over: Partial<FarmRow>): FarmRow => ({
	id: 'r1',
	askedAbout: ['Sant Quirze del Vallès'],
	name: 'Acme Fabricacions',
	website: 'https://acme.example',
	statedPlace: 'Sant Quirze del Vallès, Barcelona',
	addresses: ['https://acme.example'],
	label: 'ok',
	...over,
})

const dropEverything = rowByRow(() => 'drop')
const keepEverything = rowByRow(() => 'keep')

describe('parseFarmRow', () => {
	describe('when the row is well formed', () => {
		it('should read it and default the fields it leaves out', () => {
			// GIVEN a row carrying only the fields a corpus must state
			const result = parseFarmRow({
				id: 'r1',
				name: 'Acme Fabricacions',
				label: 'ok',
			})

			// WHEN parsed — THEN the optional fields come back empty rather than absent
			expect(result.ok).toBe(true)
			if (!result.ok) return
			expect(result.value.addresses).toEqual([])
			expect(result.value.askedAbout).toEqual([])
			expect(result.value.website).toBeNull()
			expect(result.value.statedPlace).toBeNull()
		})
	})

	describe('when the row cannot be graded against', () => {
		it('should refuse a row that is not an object', () => {
			// GIVEN a string where a row should be
			// WHEN parsed — THEN it is refused rather than coerced
			const result = parseFarmRow('not a row')
			expect(result).toEqual({ ok: false, error: 'row is not an object' })
		})

		it('should refuse a row with no id, since no error could name it', () => {
			// GIVEN a row with a name and a label but nothing to call it by
			// WHEN parsed — THEN it is refused
			const result = parseFarmRow({ name: 'Acme', label: 'ok' })
			expect(result).toEqual({ ok: false, error: 'row has no id' })
		})

		it('should refuse a row with a blank name', () => {
			// GIVEN whitespace where the company's name should be — a deletion this
			// row could report would name nobody
			// WHEN parsed — THEN it is refused
			const result = parseFarmRow({ id: 'r1', name: '   ', label: 'ok' })
			expect(result.ok).toBe(false)
			if (result.ok) return
			expect(result.error).toContain('r1')
		})

		it('should refuse an unlabelled row rather than read it as ordinary', () => {
			// GIVEN a row nobody has decided about. Read as `ok` it would flatter
			// every rule, which is the one direction this must not be wrong in.
			// WHEN parsed — THEN it is refused, naming the labels it could carry
			const result = parseFarmRow({ id: 'r1', name: 'Acme' })
			expect(result.ok).toBe(false)
			if (result.ok) return
			expect(result.error).toContain('network')
		})

		it('should refuse a label outside the three', () => {
			// GIVEN a label somebody invented
			// WHEN parsed — THEN it is refused
			const result = parseFarmRow({ id: 'r1', name: 'Acme', label: 'junk' })
			expect(result.ok).toBe(false)
		})
	})

	describe('when a field is stated as the wrong kind of thing', () => {
		const base = { id: 'r1', name: 'Acme', label: 'ok' }

		it('should refuse one address written bare instead of as a list', () => {
			// GIVEN the easy slip on a row that cites a single page. Read as "no
			// addresses" it would take the row's evidence away without saying so,
			// and every rule graded against it would report a miss it did not earn.
			const result = parseFarmRow({
				...base,
				addresses: 'https://vk.example/sant-quirze',
			})

			// WHEN parsed — THEN it is refused rather than silently emptied
			expect(result.ok).toBe(false)
			if (result.ok) return
			expect(result.error).toContain('addresses')
		})

		it('should refuse a website that is not text', () => {
			// GIVEN a number where the address should be
			// WHEN parsed — THEN it is refused rather than read as "no website"
			const result = parseFarmRow({ ...base, website: 42 })
			expect(result.ok).toBe(false)
			if (result.ok) return
			expect(result.error).toContain('website')
		})

		it('should refuse the towns written as one string', () => {
			// GIVEN the run's towns joined rather than listed
			// WHEN parsed — THEN it is refused, since a rule that reads the town
			// would otherwise be graded against a row that names none
			const result = parseFarmRow({ ...base, askedAbout: 'Rubí, Castellar' })
			expect(result.ok).toBe(false)
			if (result.ok) return
			expect(result.error).toContain('askedAbout')
		})

		it('should refuse a list with an entry that is not text', () => {
			// GIVEN one good address and one entry of the wrong kind. Dropping the
			// second quietly would take an address off the row and cost a rule a
			// catch it had earned.
			const result = parseFarmRow({
				...base,
				addresses: ['https://acme.example', 42],
			})

			// WHEN parsed — THEN the row is refused rather than shortened
			expect(result.ok).toBe(false)
			if (result.ok) return
			expect(result.error).toContain('addresses')
		})

		it('should skip a blank entry rather than refuse the row', () => {
			// GIVEN a list carrying something the author left empty — absence again,
			// which is a real answer wherever it appears
			const result = parseFarmRow({
				...base,
				addresses: ['https://acme.example', '   '],
			})

			// WHEN parsed — THEN the blank is dropped and the row stands
			expect(result.ok).toBe(true)
			if (!result.ok) return
			expect(result.value.addresses).toEqual(['https://acme.example'])
		})

		it('should accept a field written as an explicit null', () => {
			// GIVEN a row saying outright that it has no website and no place —
			// absence is a real answer and must keep passing
			const result = parseFarmRow({
				...base,
				website: null,
				statedPlace: null,
				addresses: null,
			})

			// WHEN parsed — THEN it reads as empty rather than being refused
			expect(result.ok).toBe(true)
			if (!result.ok) return
			expect(result.value.website).toBeNull()
			expect(result.value.addresses).toEqual([])
		})
	})
})

describe('parseFarmCorpus', () => {
	describe('when some rows are malformed', () => {
		it('should keep the good rows and name every bad one', () => {
			// GIVEN a corpus with one good row and two that cannot be graded
			const result = parseFarmCorpus([
				{ id: 'r1', name: 'Acme', label: 'ok' },
				{ id: 'r2', name: 'Beta' },
				'not a row',
			])

			// WHEN parsed — THEN one row survives and both failures are reported, so
			// a malformed row cannot quietly shrink the set a rule is graded against
			expect(result.rows).toHaveLength(1)
			expect(result.errors).toHaveLength(2)
		})
	})

	describe('when the corpus is not a list', () => {
		it('should say so rather than come back empty', () => {
			// GIVEN an object where the array should be
			// WHEN parsed — THEN the reason is reported
			expect(parseFarmCorpus({}).errors).toEqual(['corpus is not an array'])
		})
	})

	describe('when two rows share an id', () => {
		it('should keep the first and refuse the second', () => {
			// GIVEN two different companies filed under one id. A rule answers by id,
			// so the pair would take each other's verdict and the corpus would grade
			// the rule on an answer it never gave.
			const result = parseFarmCorpus([
				{ id: 'r1', name: 'Acme', label: 'ok' },
				{ id: 'r1', name: 'Beta', label: 'network' },
			])

			// WHEN parsed — THEN only one survives and the clash is named
			expect(result.rows).toHaveLength(1)
			expect(result.rows[0]?.name).toBe('Acme')
			expect(result.errors[0]).toContain('more than one row')
		})
	})
})

describe('scoreFarmReplay', () => {
	describe('when the rule leaves every row alone', () => {
		it('should report the baseline: nothing caught, nothing deleted', () => {
			// GIVEN the corpus and a rule that does nothing — what ships today
			const rows = [
				row({ id: 'n1', label: 'network' }),
				row({ id: 's1', label: 'serves_not_in' }),
				row({ id: 'o1', label: 'ok' }),
			]

			// WHEN replayed — THEN no company is harmed and no junk is caught
			const score = scoreFarmReplay(rows, keepEverything)
			expect(score).toEqual({
				rows: 3,
				networkDropped: 0,
				networkTotal: 1,
				placeRefused: 0,
				placeTotal: 1,
				companiesDeleted: [],
				placesRefusedInError: [],
			})
		})
	})

	describe('when the rule drops every row', () => {
		it('should catch all the network and name every company it deleted', () => {
			// GIVEN a rule that scores perfectly on the junk by deleting the list
			const rows = [
				row({ id: 'n1', label: 'network', name: 'VKS Pintura' }),
				row({ id: 's1', label: 'serves_not_in', name: 'Fervalles' }),
				row({ id: 'o1', label: 'ok', name: 'Carinsa Group' }),
			]

			// WHEN replayed — THEN the two real companies are named, which is what
			// stops a single accuracy figure making this rule look good
			const score = scoreFarmReplay(rows, dropEverything)
			expect(score.networkDropped).toBe(1)
			expect(score.companiesDeleted).toEqual(['Fervalles', 'Carinsa Group'])
		})
	})

	describe('when the rule refuses a place', () => {
		it('should count a refusal on a town-page row as the catch it is', () => {
			// GIVEN a row whose place was read off a page about a town it serves
			const rows = [row({ id: 's1', label: 'serves_not_in' })]

			// WHEN the rule refuses the place — THEN it is counted, and the company
			// is not recorded as deleted, because it survives
			const score = scoreFarmReplay(
				rows,
				rowByRow(() => 'refuse_place'),
			)
			expect(score.placeRefused).toBe(1)
			expect(score.placeTotal).toBe(1)
			expect(score.companiesDeleted).toEqual([])
		})

		it('should name an ordinary row whose place it refused for no reason', () => {
			// GIVEN an ordinary row, and a rule that doubts it anyway
			const rows = [row({ id: 'o1', label: 'ok', name: 'Carinsa Group' })]

			// WHEN replayed — THEN the cheap mistake is counted apart from a
			// deletion rather than folded in with it
			const score = scoreFarmReplay(
				rows,
				rowByRow(() => 'refuse_place'),
			)
			expect(score.placesRefusedInError).toEqual(['Carinsa Group'])
			expect(score.companiesDeleted).toEqual([])
		})
	})

	describe('when the rule half-answers a network row', () => {
		it('should count a refused place on network as a miss, not a catch', () => {
			// GIVEN a rule that doubts the network's place but leaves it on the list.
			// The row is not a company at all, so anything short of a drop is a miss.
			const rows = [row({ id: 'n1', label: 'network' })]

			// WHEN replayed — THEN it is not counted as caught
			const score = scoreFarmReplay(
				rows,
				rowByRow(() => 'refuse_place'),
			)
			expect(score.networkDropped).toBe(0)
			expect(score.networkTotal).toBe(1)
			expect(score.placesRefusedInError).toEqual([])
		})
	})

	describe('when a rule reads only the address', () => {
		it('should report the network row that cites none as a miss', () => {
			// GIVEN the case the corpus exists to keep honest: a row of the network
			// that reached the list citing a finance profile and nothing of the
			// network's own, beside one that cites the network outright
			const rows = [
				row({
					id: 'n1',
					label: 'network',
					name: 'VKS Pintura Líquida Industrial',
					website: 'https://www.vkspinturaliquidabarcelona.es',
					addresses: [
						'https://www.vkspinturaliquidabarcelona.es/sant-quirze-del-valles',
					],
				}),
				row({
					id: 'n2',
					label: 'network',
					name: 'VKS Projects',
					website: null,
					addresses: ['https://pitchbook.com'],
				}),
			]
			const byHost = rowByRow(candidate =>
				candidate.addresses.some(address => address.includes('vks'))
					? 'drop'
					: 'keep',
			)

			// WHEN replayed — THEN one of the two is caught, and the harness says so
			// rather than crediting a host rule for a row it cannot see
			const score = scoreFarmReplay(rows, byHost)
			expect(score.networkDropped).toBe(1)
			expect(score.networkTotal).toBe(2)
		})
	})

	describe('when the rule reads the list rather than one row', () => {
		it('should let a rule answer for a row from what the others show', () => {
			// GIVEN the signal that lives across rows, not inside one: two companies
			// on different domains sharing a brand. Neither row says anything on its
			// own; together they give the operator away.
			const rows = [
				row({ id: 'n1', label: 'network', name: 'VK Estampacions' }),
				row({ id: 'n2', label: 'network', name: 'VK Anoditzats' }),
				row({ id: 'o1', label: 'ok', name: 'Carinsa Group' }),
			]
			const byBrand = (all: ReadonlyArray<FarmRow>) => {
				const leads = all.map(candidate => candidate.name.split(' ')[0])
				return new Map(
					all.map(candidate => [
						candidate.id,
						leads.filter(name => name === candidate.name.split(' ')[0]).length >
						1
							? ('drop' as const)
							: ('keep' as const),
					]),
				)
			}

			// WHEN replayed — THEN both go and the single company is untouched
			const score = scoreFarmReplay(rows, byBrand)
			expect(score.networkDropped).toBe(2)
			expect(score.companiesDeleted).toEqual([])
		})

		it('should keep a row the rule reached no conclusion about', () => {
			// GIVEN an answer that names one row and says nothing of the other.
			// Silence is not a verdict, and must not be read as one.
			const rows = [
				row({ id: 'n1', label: 'network' }),
				row({ id: 'o1', label: 'ok', name: 'Carinsa Group' }),
			]

			// WHEN replayed — THEN the unmentioned company is left alone
			const score = scoreFarmReplay(rows, () => new Map([['n1', 'drop']]))
			expect(score.networkDropped).toBe(1)
			expect(score.companiesDeleted).toEqual([])
		})

		it('should ignore a verdict about a row the corpus does not hold', () => {
			// GIVEN a rule naming a row nobody asked it about — the same reading the
			// place check takes of a verdict for a row outside its batch
			const rows = [row({ id: 'o1', label: 'ok', name: 'Carinsa Group' })]

			// WHEN replayed — THEN the stray verdict changes nothing
			const score = scoreFarmReplay(
				rows,
				() =>
					new Map([
						['someone-else', 'drop'],
						['o1', 'keep'],
					]),
			)
			expect(score.companiesDeleted).toEqual([])
			expect(score.rows).toBe(1)
		})
	})

	describe('when the corpus is empty', () => {
		it('should report zeroes rather than divide by nothing', () => {
			// GIVEN no rows
			// WHEN replayed — THEN every count is zero and nothing throws
			const score = scoreFarmReplay([], dropEverything)
			expect(score.rows).toBe(0)
			expect(score.networkTotal).toBe(0)
			expect(score.placeTotal).toBe(0)
			expect(score.companiesDeleted).toEqual([])
		})
	})
})

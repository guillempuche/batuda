import { describe, expect, it } from 'vitest'

import { dropNetworkRows, placesNamed } from './network-guard'

const VALLES = ['Sant Quirze del Vallès', 'Cerdanyola del Vallès', 'Barcelona']

const prospect = (
	name: string,
	website: string | null,
	cites: ReadonlyArray<string> = [],
) => ({
	name,
	...(website === null ? {} : { website }),
	citations: cites.map(source_id => ({ source_id })),
})

const scan = (...prospects: ReadonlyArray<unknown>) => ({ prospects })

const names = (findings: unknown): ReadonlyArray<string> =>
	((findings as { prospects: Array<{ name: string }> }).prospects ?? []).map(
		row => row.name,
	)

describe('placesNamed', () => {
	describe('when the request writes a town and the province it sits in', () => {
		it('should take them apart, since that is the pair the check needs', () => {
			// GIVEN an area in the words a request uses
			// WHEN taken apart — THEN both places come back
			expect(placesNamed('Ripollet (Barcelona)')).toEqual([
				'Ripollet',
				'Barcelona',
			])
		})
	})

	describe('when the request joins two towns with a word', () => {
		it('should take those apart too, or neither town can be matched', () => {
			// GIVEN two towns joined the way a Catalan or Spanish request writes them
			// WHEN taken apart — THEN each town stands on its own
			expect(placesNamed('Barberà del Vallès i Badia del Vallès')).toEqual([
				'Barberà del Vallès',
				'Badia del Vallès',
			])
			expect(placesNamed('Sabadell y Terrassa')).toEqual([
				'Sabadell',
				'Terrassa',
			])
		})
	})

	describe('when the request names one place', () => {
		it('should come back with the one, so the check finds no pair', () => {
			// GIVEN an area naming a single region
			// WHEN taken apart — THEN there is nothing to tell apart
			expect(placesNamed('Baltimore metro')).toEqual(['Baltimore metro'])
			expect(placesNamed('   ')).toEqual([])
		})
	})

	describe('when a place is written twice', () => {
		it('should keep one of it', () => {
			// GIVEN a request repeating itself
			// WHEN taken apart — THEN the repeat is folded away
			expect(placesNamed('Barcelona, Barcelona')).toEqual(['Barcelona'])
		})
	})
})

describe('dropNetworkRows', () => {
	describe('when a domain names one place and files a page under another', () => {
		it('should take off the rows resting on it and nothing else', () => {
			// GIVEN a domain that says Barcelona, files a page under Cerdanyola, and
			// spells the company it carries — beside an ordinary company
			const findings = scan(
				prospect(
					'VKS Estampacions Metalúrgiques',
					'https://www.vksestampacionsmetalurgiquesbarcelona.es',
					[
						'https://www.vksestampacionsmetalurgiquesbarcelona.es/cerdanyola-del-valles',
					],
				),
				prospect('Carinsa Group', 'https://carinsa.example', [
					'https://carinsa.example',
				]),
			)

			// WHEN read — THEN only the row on that domain goes
			const result = dropNetworkRows(findings, 'prospects', VALLES)
			expect(names(result.findings)).toEqual(['Carinsa Group'])
			expect(result.hosts).toEqual(['vksestampacionsmetalurgiquesbarcelona.es'])
		})

		it('should read a town whose accent the path escaped', () => {
			// GIVEN the same page with its accent written as an escape, which is how
			// a Spanish or Catalan listing spells most of its addresses
			const findings = scan(
				prospect('VKS Estampacions Metalúrgiques', null, [
					'https://www.vksestampacionsmetalurgiquesbarcelona.es/cerdanyola-del-vall%C3%A8s',
				]),
			)

			// WHEN read — THEN it is caught, as the unescaped spelling is
			expect(
				dropNetworkRows(findings, 'prospects', VALLES).dropped,
			).toHaveLength(1)
		})

		it('should read a town of four letters', () => {
			// GIVEN a request about Rubí — as much a town as a longer-named one
			const findings = scan(
				prospect('VKS Estampacions Metalúrgiques', null, [
					'https://www.vksestampacionsmetalurgiquesbarcelona.es/rubi',
				]),
			)

			// WHEN read — THEN the check runs rather than switching itself off
			const result = dropNetworkRows(
				findings,
				'prospects',
				placesNamed('Rubí (Barcelona)'),
			)
			expect(result.dropped).toHaveLength(1)
		})
	})

	describe('when a row of the same operator cites nothing of its own', () => {
		it('should leave it standing, since nothing spreads by name', () => {
			// GIVEN one caught row and a second of the same operator whose only
			// evidence is a finance profile. Reaching it meant grouping on the first
			// word of a name, which deleted unrelated firms sharing a trade word, so
			// this miss is the price paid on purpose.
			const findings = scan(
				prospect('VKS Estampacions Metalúrgiques', null, [
					'https://www.vksestampacionsmetalurgiquesbarcelona.es/cerdanyola-del-valles',
				]),
				prospect('VKS Projects', null, ['https://a-finance-profile.example']),
			)

			// WHEN read — THEN only the row resting on the caught domain goes
			const result = dropNetworkRows(findings, 'prospects', VALLES)
			expect(names(result.findings)).toEqual(['VKS Projects'])
		})
	})

	describe('when other rows share the caught row’s first word', () => {
		it('should leave them alone, however common that word is', () => {
			// GIVEN a caught row and two unrelated firms whose names begin the same
			// way. Spanish and Catalan firms lead with their trade, which is the
			// run's own request word — grouping on it took real companies off a list.
			const findings = scan(
				prospect('Talleres Metalicos Barcelona', null, [
					'https://talleresmetalicosbarcelona.example/cerdanyola-del-valles',
				]),
				prospect('Talleres Ferrer', 'https://talleresferrer.example'),
				prospect('Taller Puig', 'https://tallerpuig.example'),
			)

			// WHEN read — THEN the two ordinary firms stay
			const result = dropNetworkRows(findings, 'prospects', VALLES)
			expect(names(result.findings)).toEqual(['Talleres Ferrer', 'Taller Puig'])
		})
	})

	describe('when the domain is spelled only by the place it carries', () => {
		it('should leave the firms it lists alone', () => {
			// GIVEN a directory named for a town, filing pages under another town,
			// listing firms called "… del Vallès". Counted without discounting the
			// place, `valles` and `del` read as the firm's own name and both real
			// companies went.
			const findings = scan(
				prospect('Serralleria del Vallès', null, [
					'https://cerdanyoladelvalles.a-directory.example/sant-quirze-del-valles/s',
				]),
				prospect('Fusteria del Vallès', null, [
					'https://cerdanyoladelvalles.a-directory.example/sant-quirze-del-valles/f',
				]),
			)

			// WHEN read — THEN nothing is dropped
			const result = dropNetworkRows(findings, 'prospects', VALLES)
			expect(result.dropped).toEqual([])
			expect(result.hosts).toEqual([])
		})

		it('should spare a directory that lists a firm named like itself', () => {
			// GIVEN a trade-and-place directory listing one firm called exactly that.
			// One such listing used to convict the host and take every other row on
			// it — three real companies.
			const findings = scan(
				prospect('Talleres Barcelona SL', null, [
					'https://talleres-barcelona.a-directory.example/cerdanyola-del-valles/a',
				]),
				prospect('Delinox Solucions', null, [
					'https://talleres-barcelona.a-directory.example/cerdanyola-del-valles/b',
				]),
			)

			// WHEN read — THEN both survive
			expect(dropNetworkRows(findings, 'prospects', VALLES).dropped).toEqual([])
		})
	})

	describe('when a real firm is named after a place', () => {
		it('should leave it standing though it serves another town', () => {
			// GIVEN a firm genuinely named for the province, with a landing page for a
			// town it travels to. Its place may be wrong — that is the place check's
			// question — but it is a company and must not be deleted.
			const findings = scan(
				prospect('Talleres Barcelona', 'https://talleresbarcelona.example', [
					'https://talleresbarcelona.example/servicios/ripollet',
				]),
			)

			// WHEN read — THEN it stays
			const result = dropNetworkRows(findings, 'prospects', [
				'Ripollet',
				'Barcelona',
			])
			expect(result.dropped).toEqual([])
		})

		it('should not read a country and a city as a town and its province', () => {
			// GIVEN a national firm named for the country, with a page for a city —
			// which is what every national firm does
			const findings = scan(
				prospect('Aislamientos España', 'https://aislamientosespana.example', [
					'https://aislamientosespana.example/barcelona',
				]),
			)

			// WHEN read — THEN it stays
			const result = dropNetworkRows(
				findings,
				'prospects',
				placesNamed('Barcelona, España'),
			)
			expect(result.dropped).toEqual([])
		})

		it('should not read a place and its own region as two places', () => {
			// GIVEN "Barcelonès" beside "Barcelona" — two names for one place. Read
			// as substrings they looked like the town-and-province pair.
			const findings = scan(
				prospect(
					'Estampacions Barcelona',
					'https://estampacionsbarcelona.example',
					['https://estampacionsbarcelona.example/barcelones/serveis'],
				),
			)

			// WHEN read — THEN it stays
			const result = dropNetworkRows(
				findings,
				'prospects',
				placesNamed('Barcelonès (Barcelona)'),
			)
			expect(result.dropped).toEqual([])
		})
	})

	describe('when an address carries prose after it', () => {
		it('should ignore it rather than read the prose as a path', () => {
			// GIVEN a source the model wrote with a sentence after the address. Parsed,
			// the sentence escapes into the path, where its words read as place names.
			const findings = scan(
				prospect('Casanovas Ferros', null, [
					'https://barcelona-provincia.a-directory.example/firms/x.htm (“Direcció: … Cerdanyola del Vallès”)',
				]),
			)

			// WHEN read — THEN the address is not read at all
			expect(dropNetworkRows(findings, 'prospects', VALLES).dropped).toEqual([])
		})
	})

	describe('when the run has nothing to read a domain against', () => {
		it('should drop nothing when the request named fewer than two places', () => {
			// GIVEN the operator's own address, and a request that named one town and
			// no province — so "barcelona" in the domain means nothing to this run
			const findings = scan(
				prospect('VKS Estampacions Metalúrgiques', null, [
					'https://www.vksestampacionsmetalurgiquesbarcelona.es/cerdanyola-del-valles',
				]),
			)

			// WHEN read — THEN it survives, which is the honest answer rather than a
			// guess made from a vocabulary the run never brought
			const result = dropNetworkRows(findings, 'prospects', [
				'Cerdanyola del Vallès',
			])
			expect(result.dropped).toEqual([])
		})
	})

	describe('when there is no list to read', () => {
		it('should pass the findings straight back', () => {
			// GIVEN a scan with no list field named, findings that are not an object,
			// and a list field holding something that is not a list
			// WHEN read — THEN each comes back untouched rather than throwing
			const findings = scan(prospect('Acme', 'https://acme.example'))
			expect(dropNetworkRows(findings, undefined, VALLES).findings).toBe(
				findings,
			)
			expect(
				dropNetworkRows('not findings', 'prospects', VALLES).dropped,
			).toEqual([])
			expect(
				dropNetworkRows({ prospects: 'not a list' }, 'prospects', VALLES)
					.dropped,
			).toEqual([])
		})

		it('should step over a row that is not an object', () => {
			// GIVEN junk sitting in the list beside a caught row
			const findings = {
				prospects: [
					'not a row',
					prospect('VKS Estampacions Metalúrgiques', null, [
						'https://www.vksestampacionsmetalurgiquesbarcelona.es/cerdanyola-del-valles',
					]),
				],
			}

			// WHEN read — THEN the junk survives untouched and the caught row goes
			const result = dropNetworkRows(findings, 'prospects', VALLES)
			expect(
				(result.findings as { prospects: ReadonlyArray<unknown> }).prospects,
			).toEqual(['not a row'])
			expect(result.dropped).toHaveLength(1)
		})
	})
})

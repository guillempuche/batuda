import { describe, expect, it } from 'vitest'

import { dropSharedHandles } from './shared-handles-guard'

const INSTAGRAM = 'https://instagram.com/mefram_mecanitzats'
const profiles = (findings: unknown, at: number): ReadonlyArray<string> =>
	(
		findings as {
			prospects: Array<{ social_profiles?: Array<{ value: string }> }>
		}
	).prospects[at]?.social_profiles?.map(profile => profile.value) ?? []

describe('dropSharedHandles, when two scan rows carry one Instagram account', () => {
	const findings = {
		prospects: [
			{
				name: 'MEFRAM MECANITZATS',
				website: 'https://www.mefram.es/',
				social_profiles: [{ kind: 'instagram', value: INSTAGRAM }],
			},
			{
				name: 'Mecanizados Folkman',
				website: 'https://mecanizadosfolkman.es/',
				social_profiles: [
					{ kind: 'instagram', value: INSTAGRAM },
					{ kind: 'linkedin', value: 'https://linkedin.com/company/folkman' },
				],
			},
		],
	}
	const pages = [
		{ host: 'mefram.es', text: 'Síguenos en instagram.com/mefram_mecanitzats' },
		{ host: 'mecanizadosfolkman.es', text: 'Fabricamos piezas industriales' },
	]

	it('should keep it on the row whose own site shows it and take it off the other', () => {
		// WHEN judged against the pages the run opened
		const result = dropSharedHandles(findings, 'prospects', pages)
		// THEN MEFRAM keeps its account, Folkman loses the copied one and keeps its own
		expect(profiles(result.findings, 0)).toEqual([INSTAGRAM])
		expect(profiles(result.findings, 1)).toEqual([
			'https://linkedin.com/company/folkman',
		])
		expect(result.dropped).toBe(1)
	})

	it('should read the handle alone on the page as showing the account', () => {
		// GIVEN the site writing "@mefram_mecanitzats" beside an icon
		const result = dropSharedHandles(findings, 'prospects', [
			{ host: 'www.mefram.es', text: 'Instagram: @mefram_mecanitzats' },
		])
		// THEN MEFRAM keeps it and Folkman loses it
		expect(profiles(result.findings, 0)).toEqual([INSTAGRAM])
		expect(result.dropped).toBe(1)
	})

	it('should not settle it on a page of a row that does not carry it', () => {
		// GIVEN a third row's own page mentioning the handle, while neither row
		// that carries the account has a page showing it
		const withThird = {
			prospects: [
				...findings.prospects,
				{ name: 'Blog', website: 'https://blog.es/' },
			],
		}
		const result = dropSharedHandles(withThird, 'prospects', [
			{ host: 'blog.es', text: 'seguimos a @mefram_mecanitzats' },
		])
		// THEN nothing is settled and nobody loses it
		expect(result.findings).toBe(withThird)
		expect(result.dropped).toBe(0)
	})

	it('should read a short handle only as a word of its own', () => {
		// GIVEN an account whose handle is a short word, written inside another
		// word on the owner's page
		const short = {
			prospects: [
				{
					name: 'Acme',
					website: 'https://acme.es/',
					social_profiles: [{ value: 'https://instagram.com/acme' }],
				},
				{
					name: 'Other',
					website: 'https://other.es/',
					social_profiles: [{ value: 'https://instagram.com/acme' }],
				},
			],
		}
		const result = dropSharedHandles(short, 'prospects', [
			{ host: 'acme.es', text: 'acmeic products' },
		])
		// THEN the page does not show the account, so nothing is settled
		expect(result.findings).toBe(short)
	})

	it('should leave it on both when no fetched page shows it', () => {
		// GIVEN pages that mention no account, so nothing settles who owns it
		const result = dropSharedHandles(findings, 'prospects', [
			{ host: 'mefram.es', text: 'empresa familiar' },
		])
		// THEN nobody loses it — the rightful owner would go with the copy
		expect(result.findings).toBe(findings)
		expect(result.dropped).toBe(0)
	})

	it('should leave a profile one row alone carries, whatever the pages say', () => {
		// GIVEN only Folkman naming the account
		const alone = {
			prospects: [
				{ name: 'MEFRAM', website: 'https://www.mefram.es/' },
				findings.prospects[1],
			],
		}
		// WHEN judged
		const result = dropSharedHandles(alone, 'prospects', [])
		// THEN the findings come back untouched
		expect(result.findings).toBe(alone)
		expect(result.dropped).toBe(0)
	})

	it('should pass a run with no list through', () => {
		expect(dropSharedHandles({ contacts: [] }, undefined, pages).dropped).toBe(
			0,
		)
		// AND a run whose list field holds something that is not a list of rows
		expect(
			dropSharedHandles({ prospects: 'none' }, 'prospects', pages).dropped,
		).toBe(0)
	})
})

describe('dropSharedHandles, when the one account is written several ways', () => {
	it('should read a trailing slash and a www. as one account, and a bare handle as no address', () => {
		// GIVEN rows naming the account with a trailing slash, with www., and
		// as a bare handle that names no page, and only the first company's
		// site showing it
		const findings = {
			prospects: [
				{
					name: 'MEFRAM',
					website: 'https://www.mefram.es/',
					social_profiles: [{ value: `${INSTAGRAM}/` }],
				},
				{
					name: 'Folkman',
					website: 'https://mecanizadosfolkman.es/',
					social_profiles: [{ value: 'www.instagram.com/mefram_mecanitzats' }],
				},
				{
					name: 'Tallers Vidal',
					website: 'https://tallersvidal.cat/',
					social_profiles: [{ value: '@mefram_mecanitzats' }],
				},
			],
		}
		// WHEN judged against a page of the first company's own site
		const result = dropSharedHandles(findings, 'prospects', [
			{
				host: 'www.mefram.es',
				text: 'Síguenos: instagram.com/mefram_mecanitzats',
			},
		])
		// THEN the two addresses count as one account, kept where it is shown,
		// and the bare handle is not an address this guard reads
		expect(profiles(result.findings, 0)).toEqual([`${INSTAGRAM}/`])
		expect(profiles(result.findings, 1)).toEqual([])
		expect(profiles(result.findings, 2)).toEqual(['@mefram_mecanitzats'])
		expect(result.dropped).toBe(1)
	})

	it('should not mistake two companies for one by a platform path that names no account', () => {
		// GIVEN two rows each with a Facebook address by numeric id, which the
		// platform parser refuses as an account page
		const findings = {
			prospects: [
				{
					name: 'One',
					website: 'https://one.es/',
					social_profiles: [{ value: 'https://facebook.com/profile.php?id=1' }],
				},
				{
					name: 'Two',
					website: 'https://two.es/',
					social_profiles: [{ value: 'https://facebook.com/profile.php?id=2' }],
				},
			],
		}
		// WHEN judged
		const result = dropSharedHandles(findings, 'prospects', [
			{ host: 'one.es', text: 'facebook' },
		])
		// THEN nothing is taken away
		expect(result.findings).toBe(findings)
		expect(result.dropped).toBe(0)
	})

	it('should take a shared account off a row with no site of its own once another row shows it', () => {
		// GIVEN a row that names no website, so it has no pages to show it
		const findings = {
			prospects: [
				{ name: 'Nobody', social_profiles: [{ value: INSTAGRAM }] },
				{
					name: 'MEFRAM',
					website: 'https://www.mefram.es/',
					social_profiles: [{ value: INSTAGRAM }],
				},
			],
		}
		// WHEN judged against MEFRAM's own page
		const result = dropSharedHandles(findings, 'prospects', [
			{ host: 'mefram.es', text: 'instagram.com/mefram_mecanitzats' },
		])
		// THEN the row with nothing to show for it loses the account
		expect(profiles(result.findings, 0)).toEqual([])
		expect(profiles(result.findings, 1)).toEqual([INSTAGRAM])
		expect(result.dropped).toBe(1)
	})
})

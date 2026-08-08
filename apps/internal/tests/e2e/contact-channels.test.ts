import { execSync } from 'node:child_process'

import { expect, test } from '@playwright/test'

import { DATABASE_URL } from './helpers/database-url'
import { waitForInteractive } from './helpers/hydration'
import { setActiveOrgBySlug } from './helpers/set-active-org'

// Putting a contact's ways of being reached right, from the People tab of a
// company: correcting an address in place, being told when a correction cannot
// land, removing one, and choosing which of a kind is the main one.
//
// Controlled inputs are driven directly here. The caveat about `fill()` being
// dropped is specific to PriPasswordInput, whose eye-toggle wrapper owns the
// change handler; a PriInput used directly takes a programmatic fill fine
// (docs/frontend.md § PriPasswordInput).
//
// Selectors verified against:
//   apps/internal/src/components/contacts/manage-channels-dialog.tsx
//   apps/internal/src/routes/companies/$slug.tsx (contact-channels-{id})

const COMPANY_SLUG = 'cal-pep-fonda'
const SEEDED_EMAIL = 'pep@calpepfonda.cat'
const CORRECTED_EMAIL = 'pep.casals@calpepfonda.cat'
const SPARE_EMAIL = 'comandes-e2e@calpepfonda.cat'

const psql = (sqlText: string): string =>
	execSync(`psql "${DATABASE_URL}" -tA -c "${sqlText.replace(/"/g, '\\"')}"`, {
		encoding: 'utf8',
	}).trim()

const contactId = (): string =>
	psql(
		`SELECT id FROM contacts WHERE name = 'Pep Casals' ORDER BY created_at LIMIT 1`,
	).split('\n')[0] as string

const channelId = (address: string): string =>
	psql(
		`SELECT id FROM channels WHERE subject_table='contacts' AND address='${address}' LIMIT 1`,
	).split('\n')[0] as string

const addressesOf = (id: string): string =>
	psql(
		`SELECT address FROM channels WHERE subject_table='contacts' AND subject_id='${id}' ORDER BY address`,
	)

// Adding one shows it twice — in the dialog row and on the card behind it, both
// re-derived from the same live list — so a bare text match is ambiguous.
const addSpare = async (page: import('@playwright/test').Page) => {
	await page.getByTestId('channel-add-value').fill(SPARE_EMAIL)
	await page.getByTestId('channel-add-submit').click()
	await expect(page.getByTestId('manage-channels-dialog')).toContainText(
		SPARE_EMAIL,
		{ timeout: 10_000 },
	)
	return channelId(SPARE_EMAIL)
}

test.describe('a contact’s ways of being reached', () => {
	let pep: string
	let phone: string
	let phoneWasPrimary: string

	test.beforeEach(async ({ page }) => {
		await page.goto('/', { waitUntil: 'commit' })
		await setActiveOrgBySlug(page, 'taller')
		pep = contactId()
		phone = psql(
			`SELECT id FROM channels WHERE subject_table='contacts' AND subject_id='${pep}' AND channel='phone' LIMIT 1`,
		).split('\n')[0] as string
		phoneWasPrimary =
			phone === ''
				? ''
				: (psql(`SELECT is_primary FROM channels WHERE id='${phone}'`).split(
						'\n',
					)[0] as string)
		// Land on `?tab=people` directly: PriTabs reads the active tab from the URL
		// at SSR, while clicking it needs hydration and races the assertion.
		await page.goto(`/companies/${COMPANY_SLUG}?tab=people`, {
			waitUntil: 'networkidle',
		})
		await waitForInteractive(page, `contact-channels-${pep}`)
		await page.getByTestId(`contact-channels-${pep}`).click()
		await expect(page.getByTestId('manage-channels-dialog')).toBeVisible()
	})

	test.afterEach(() => {
		// Put the seeded row back: other suites join on this exact address
		// (apps/cli/src/commands/seed/emails.ts), so a corrected one left behind
		// breaks them rather than this spec.
		psql(
			`UPDATE channels SET address='${SEEDED_EMAIL}' WHERE subject_table='contacts' AND address='${CORRECTED_EMAIL}'`,
		)
		psql(
			`DELETE FROM channels WHERE subject_table='contacts' AND address='${SPARE_EMAIL}'`,
		)
		// The seed leaves these unset, so anything this spec wrote has to come back
		// off — a verdict or a default left behind changes what the next run sees.
		psql(
			`UPDATE channels SET verification=NULL, label=NULL WHERE subject_table='contacts' AND subject_id='${pep}'`,
		)
		if (phone !== '')
			psql(
				`UPDATE channels SET is_primary=${phoneWasPrimary === 't'} WHERE id='${phone}'`,
			)
	})

	// Tagged so it gates a pull request: CI's smoke subset is `--grep @smoke`, and
	// an untagged spec only ever runs on main, after the merge it should have
	// stopped. This is the one that fails if correcting an address breaks.
	test('should correct a wrong address in place, on the card as well as in the dialog', {
		tag: '@smoke',
	}, async ({ page }) => {
		// GIVEN the address on file is wrong
		const id = channelId(SEEDED_EMAIL)

		// WHEN it is corrected in the row itself
		await page.getByTestId(`channel-edit-${id}`).click()
		await page.getByTestId(`channel-value-${id}`).fill(CORRECTED_EMAIL)
		await page.getByTestId(`channel-save-${id}`).click()

		// THEN the correction is what is stored, and what the card behind the
		// dialog shows — the rows are re-derived from the same live list
		await expect(page.getByTestId(`channel-row-${id}`)).toContainText(
			CORRECTED_EMAIL,
			{ timeout: 10_000 },
		)
		expect(addressesOf(pep)).toContain(CORRECTED_EMAIL)
		expect(addressesOf(pep)).not.toContain(SEEDED_EMAIL)
	})

	test('should say what the server said when a correction cannot land, and keep what was typed', async ({
		page,
	}) => {
		// GIVEN a second address already on file — the state a mistyped address and
		// its correction leave somebody in
		const spare = await addSpare(page)

		// WHEN the spare is renamed onto the address already there
		await page.getByTestId(`channel-edit-${spare}`).click()
		await page.getByTestId(`channel-value-${spare}`).fill(SEEDED_EMAIL)
		await page.getByTestId(`channel-save-${spare}`).click()

		// THEN the server's own sentence appears beside the box...
		const problem = page.getByTestId(`channel-error-${spare}`)
		await expect(problem).toBeVisible({ timeout: 10_000 })
		await expect(problem).toContainText(SEEDED_EMAIL)
		// ...the row stays open with what was typed still in it, so nobody has to
		// retype it from memory...
		await expect(page.getByTestId(`channel-value-${spare}`)).toHaveValue(
			SEEDED_EMAIL,
		)
		// ...and nothing was merged away
		expect(addressesOf(pep)).toContain(SPARE_EMAIL)
		expect(addressesOf(pep)).toContain(SEEDED_EMAIL)
	})

	test('should refuse an address that could never be one of its kind', async ({
		page,
	}) => {
		// GIVEN a phone number typed into the address box of an email row
		const id = channelId(SEEDED_EMAIL)
		await page.getByTestId(`channel-edit-${id}`).click()
		await page.getByTestId(`channel-value-${id}`).fill('+34 972 100 200')

		// WHEN it is saved
		await page.getByTestId(`channel-save-${id}`).click()

		// THEN it is turned away in words, and the address on file is untouched
		await expect(page.getByTestId(`channel-error-${id}`)).toContainText(
			'valid email',
			{ timeout: 10_000 },
		)
		expect(addressesOf(pep)).toContain(SEEDED_EMAIL)
	})

	test('should remove an address that should not be there', async ({
		page,
	}) => {
		// GIVEN a throwaway address added for this test — never a seeded one, which
		// other suites join on and which cannot be put back with its id
		const spare = await addSpare(page)

		// WHEN it is removed
		await page.getByTestId(`channel-remove-${spare}`).click()

		// THEN it is gone from the list and from the record
		await expect(page.getByTestId(`channel-row-${spare}`)).toHaveCount(0, {
			timeout: 10_000,
		})
		expect(addressesOf(pep)).not.toContain(SPARE_EMAIL)
	})

	test('should make a number the main one, not only an address', async ({
		page,
	}) => {
		// GIVEN the contact's phone, which is not an email — the control used to be
		// offered on email rows only, though the flag means something for every kind
		test.skip(phone === '', 'seed has no phone for this contact')
		// Start from "not the main one" whatever a previous run left behind. The
		// dialog is part of the URL, so it comes back by itself on reload.
		psql(`UPDATE channels SET is_primary=false WHERE id='${phone}'`)
		await page.reload({ waitUntil: 'networkidle' })
		await expect(page.getByTestId('manage-channels-dialog')).toBeVisible()

		// WHEN it is made the main phone
		await page.getByTestId(`channel-primary-${phone}`).click()

		// THEN it is, and it says so rather than only showing a filled star
		await expect(page.getByTestId(`channel-primary-${phone}`)).toBeDisabled({
			timeout: 10_000,
		})
		expect(psql(`SELECT is_primary FROM channels WHERE id='${phone}'`)).toBe(
			't',
		)
	})

	test('should lower how far an address is trusted without touching whether it bounced', async ({
		page,
	}) => {
		// GIVEN an address nobody has ruled on
		const id = channelId(SEEDED_EMAIL)

		// WHEN somebody marks it risky
		await page.getByTestId(`channel-trust-${id}`).click()
		await page.getByTestId('channel-trust-option-risky').click()

		// THEN that is what is recorded...
		await expect
			.poll(() => psql(`SELECT verification FROM channels WHERE id='${id}'`), {
				timeout: 10_000,
			})
			.toBe('risky')
		// ...and the bounce state is untouched, which is the whole point of keeping
		// the two apart: one is what we expect before sending, the other what
		// happened after
		expect(psql(`SELECT status FROM channels WHERE id='${id}'`)).toBe('unknown')
	})
})

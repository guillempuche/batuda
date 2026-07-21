import { type BrowserContext, expect, type Page, test } from '@playwright/test'

import { openAddMemberPanel } from './helpers/add-member-panel'
import { findLatestEmail, findLatestMessage } from './helpers/dev-inbox'
import { setActiveOrgBySlug } from './helpers/set-active-org'

// End-to-end set/change password from /profile. The flow under test:
//
//   1. Alice adds a fresh person → they are a member immediately, created
//      without a password, and emailed a note that carries no way in.
//   2. In a separate browser context that person signs in the way anyone
//      does: they ask for their own link from /login and follow it. Their
//      `account` table has no credential row, so `fetchSecurityState`
//      derives `hasPassword: false`.
//   3. /profile renders the "Set a password" form (the three-state card's
//      `!hasPassword && !passwordOptOut` branch).
//   4. Submitting the form hits POST /auth/set-password (the thin BA
//      plugin route at apps/server/src/plugins/set-password-route.ts).
//   5. After router.invalidate(), the card flips to "Change password"
//      because the loader re-fetches hasPassword and gets true.
//   6. The opt-out path POSTs { passwordOptOut: true } to
//      /auth/update-user — the card collapses to the passwordless-only
//      confirmed state with an undo affordance.
//
// Selectors and branches verified against:
//   apps/internal/src/routes/profile/index.tsx
//   apps/server/src/plugins/set-password-route.ts
//   apps/internal/src/lib/security-state.ts

const BASE_URL = process.env['E2E_BASE_URL'] ?? 'https://batuda.localhost'

const NEW_PASSWORD = 'first-real-password-1234'

// Adds a fresh passwordless person and returns a BrowserContext + Page
// authenticated as them. Two contexts are required: Alice's session does the
// adding, and a separate one signs in so we end up as the new member, not
// Alice.
async function bootPasswordlessMember(
	alicePage: Page,
	browser: import('@playwright/test').Browser,
	emailHint: string,
): Promise<{
	email: string
	context: BrowserContext
	page: Page
}> {
	const email = `${emailHint}-${Date.now()}@example.com`
	const startedAt = Date.now()

	// The panel is inline on the members page behind the "Add member" CTA;
	// role and language both default, so no extra interaction is needed.
	await openAddMemberPanel(alicePage)
	await alicePage.getByTestId('add-member-email').fill(email)
	await alicePage.getByTestId('add-member-submit').click()
	await expect(alicePage.getByTestId('add-member-success')).toBeVisible({
		timeout: 10_000,
	})

	// They are already a member; this mail only tells them so. Asserting it has
	// no sign-in link is the point — that is what makes it safe to sit unread.
	const welcome = await findLatestMessage({
		recipient: email,
		label: 'member-added',
		sinceMs: startedAt,
		maxWaitMs: 10_000,
	})
	expect(welcome.body).not.toMatch(/\/auth\/magic-link\/verify/)

	// So they sign in the ordinary way, asking for their own link. `baseURL` is
	// explicit because a context built straight off the browser does not inherit
	// the project's, and every navigation below is relative.
	// Empty storageState on purpose: the authed project injects Alice's cookie,
	// which would land this context on the dashboard already signed in as her —
	// /login would redirect away and the form would never render.
	const memberContext = await browser.newContext({
		ignoreHTTPSErrors: true,
		baseURL: BASE_URL,
		storageState: { cookies: [], origins: [] },
	})
	const memberPage = await memberContext.newPage()
	// Ask for the link exactly as the sign-in page does — same endpoint, same
	// origin, same cookie jar. Driving the button instead would make every
	// scenario here depend on the login screen, which is not what this file is
	// about; `members.test.ts` covers that surface.
	const requested = await memberContext.request.post(
		`${BASE_URL}/auth/sign-in/magic-link`,
		{
			headers: { origin: BASE_URL, 'content-type': 'application/json' },
			data: {
				email,
				callbackURL: `${BASE_URL}/`,
				errorCallbackURL: `${BASE_URL}/login`,
			},
		},
	)
	expect(
		requested.ok(),
		`sign-in link request failed: ${requested.status()}`,
	).toBe(true)

	const signIn = await findLatestEmail({
		recipient: email,
		label: 'magic-link',
		sinceMs: startedAt,
		maxWaitMs: 10_000,
	})
	await memberPage.goto(signIn.url, { waitUntil: 'networkidle' })

	return { email, context: memberContext, page: memberPage }
}

// Each scenario boots a person from scratch: add them, wait for the welcome
// mail, sign them in, wait for the sign-in mail. Two inbox round-trips put it
// past the default budget on a cold run, and the work is real rather than a
// hang — so give it room instead of trimming the flow.
test.describe.configure({ timeout: 90_000 })

test.describe('setting a first password from /profile', () => {
	test.beforeEach(async ({ page }) => {
		// Sibling tests may have flipped Alice's active org; reset before
		// each scenario so /settings/organization/members resolves to taller.
		await page.goto('/', { waitUntil: 'commit' })
		await setActiveOrgBySlug(page, 'taller')
	})

	test.describe('when a passwordless user opens /profile', () => {
		test('should render the set-password form, accept a new password, and flip to change-password', async ({
			page,
			browser,
		}) => {
			// GIVEN a freshly added person with no credential row
			//   [profile/index.tsx — `!hasPassword && !passwordOptOut` branch]
			const bob = await bootPasswordlessMember(page, browser, 'pwd-set')

			// WHEN Bob opens the settings profile page
			await bob.page.goto('/settings/profile', { waitUntil: 'networkidle' })

			// THEN the set-password form should render — not the change-password
			// form, and not the opted-out confirmed state.
			await expect(bob.page.getByTestId('set-password-form')).toBeVisible({
				timeout: 10_000,
			})
			await expect(bob.page.getByTestId('change-password-form')).toHaveCount(0)
			await expect(
				bob.page.getByTestId('profile-password-card-opted-out'),
			).toHaveCount(0)

			// WHEN Bob fills both password fields and submits
			//   [set-password-route.ts — credential row written branch]
			// Wait for the submit control to go live first: the fields are
			// uncontrolled and read on submit, so typing into them before React
			// has finished hydrating is silently discarded.
			await expect(bob.page.getByTestId('set-password-submit')).toBeEnabled({
				timeout: 10_000,
			})
			await bob.page.getByTestId('set-password-new').fill(NEW_PASSWORD)
			await bob.page.getByTestId('set-password-confirm').fill(NEW_PASSWORD)

			// Diagnostic: confirm fill() actually landed in the DOM input
			// (the form reads via FormData on submit, not React state).
			const newInputValue = await bob.page
				.getByTestId('set-password-new')
				.inputValue()
			expect(
				newInputValue,
				'fill() should have written into the password input',
			).toBe(NEW_PASSWORD)

			// Capture the set-password response so we can diagnose 401/200.
			const setPasswordResponse = bob.page.waitForResponse(
				resp =>
					resp.url().includes('/auth/set-password') &&
					resp.request().method() === 'POST',
				{ timeout: 5_000 },
			)
			await bob.page.getByTestId('set-password-submit').click()
			const resp = await setPasswordResponse
			expect(
				resp.status(),
				`POST /auth/set-password returned ${resp.status()} — body=${await resp.text()}`,
			).toBe(200)

			// THEN the loader re-invalidates and the card flips to the
			// change-password form (proving the credential row now exists).
			await expect(bob.page.getByTestId('change-password-form')).toBeVisible({
				timeout: 10_000,
			})
			await expect(bob.page.getByTestId('set-password-form')).toHaveCount(0)

			await bob.context.close()
		})
	})

	test.describe('when a passwordless user opts out from the profile card', () => {
		test('should swap to the passwordless-only confirmed state and offer an undo', async ({
			page,
			browser,
		}) => {
			// GIVEN a passwordless member on /profile
			//   [profile/index.tsx — `passwordless-only-toggle` button]
			const bob = await bootPasswordlessMember(page, browser, 'pwd-optout')
			await bob.page.goto('/settings/profile', { waitUntil: 'networkidle' })
			await expect(bob.page.getByTestId('set-password-form')).toBeVisible({
				timeout: 10_000,
			})

			// WHEN Bob clicks "I prefer passwordless"
			//   [security-state.ts — setPasswordOptOut(true)]
			await bob.page.getByTestId('passwordless-only-toggle').click()

			// THEN the opted-out card replaces the set-password form.
			await expect(
				bob.page.getByTestId('profile-password-card-opted-out'),
			).toBeVisible({ timeout: 10_000 })
			await expect(bob.page.getByTestId('set-password-form')).toHaveCount(0)

			// WHEN Bob undoes via the "Change my mind" link
			//   [security-state.ts — setPasswordOptOut(false)]
			await bob.page.getByTestId('passwordless-only-undo').click()

			// THEN the set-password form returns, proving the flag flipped
			// back and the loader re-fetched.
			await expect(bob.page.getByTestId('set-password-form')).toBeVisible({
				timeout: 10_000,
			})
			await expect(
				bob.page.getByTestId('profile-password-card-opted-out'),
			).toHaveCount(0)

			await bob.context.close()
		})
	})

	test.describe('when a password user (Alice) opens /profile', () => {
		test('should render the change-password form and reject a wrong current password', async ({
			page,
		}) => {
			// GIVEN Alice, who already has a credential row from the seed
			//   [profile/index.tsx — `hasPassword === true` branch]
			await page.goto('/settings/profile', { waitUntil: 'networkidle' })

			// THEN the change-password form should render, not the set form.
			await expect(page.getByTestId('change-password-form')).toBeVisible({
				timeout: 10_000,
			})
			await expect(page.getByTestId('set-password-form')).toHaveCount(0)

			// WHEN Alice submits with a wrong current password
			//   [profile/index.tsx — `INVALID_PASSWORD` branch on changePassword]
			await page
				.getByTestId('change-password-current')
				.fill('this-is-not-her-current-password')
			await page
				.getByTestId('change-password-new')
				.fill('would-be-the-new-password-123')
			await page
				.getByTestId('change-password-confirm')
				.fill('would-be-the-new-password-123')
			await page.getByTestId('change-password-submit').click()

			// THEN the wrong-current error region surfaces. We do NOT proceed
			// to actually change Alice's password — sibling tests rely on the
			// seed credentials for auth.setup. Cleaning that up across the
			// suite is out of scope for this test.
			await expect(page.getByTestId('change-password-error')).toBeVisible({
				timeout: 10_000,
			})
		})
	})
})

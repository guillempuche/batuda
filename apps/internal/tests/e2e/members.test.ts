import {
	type BrowserContext,
	expect,
	type Locator,
	type Page,
	test,
} from '@playwright/test'

import {
	openAddMemberPanel,
	selectMemberLocale,
	selectMemberRole,
} from './helpers/add-member-panel'
import { findLatestMessage } from './helpers/dev-inbox'
import { setActiveOrgBySlug } from './helpers/set-active-org'

// Adding people to an organization, driven from
// /settings/organization/members. There is no invitation and nothing to
// accept: the person exists and is a member the moment the form is submitted,
// and the email they receive only tells them so.
//
// That is the property most worth holding onto here — the message carries no
// way into the account, so it can sit unread indefinitely without becoming a
// credential someone else could use. Each scenario below asserts its absence
// rather than trusting the template.
//
// Selectors verified against:
//   apps/internal/src/routes/settings/organization/members.tsx
//
// Auth: Alice's session comes from `auth.setup`'s storageState. The
// member-view persona uses a fresh context so we never reuse Alice's cookie.

const BASE_URL = process.env['E2E_BASE_URL'] ?? 'https://batuda.localhost'

function memberRow(page: Page, email: string): Locator {
	return page.locator('li', { hasText: email })
}

// Every scenario below adds a real person to the shared seed organization.
// Left alone they accumulate across runs and the roster drifts, so each one is
// recorded here and removed at the end.
const addedForCleanup: string[] = []

// Generates an address for a scenario and records it for teardown. Only
// addresses minted here are ever removed — passing a seeded address to
// `addMember` must not put it on the list, or cleanup deletes seed data.
function freshEmail(prefix: string): string {
	const email = `${prefix}-${Date.now()}@example.com`
	addedForCleanup.push(email)
	return email
}

async function addMember(page: Page, email: string): Promise<void> {
	await page.getByTestId('add-member-email').fill(email)
	await page.getByTestId('add-member-submit').click()
}

test.afterAll(async ({ browser }) => {
	if (addedForCleanup.length === 0) return
	// Best effort on purpose: tidying up is not what these tests assert, and a
	// cleanup that can fail the suite is worse than a roster with a few extra
	// rows in a database that gets re-seeded anyway.
	const context = await browser.newContext({
		ignoreHTTPSErrors: true,
		baseURL: BASE_URL,
		storageState: 'tests/e2e/.auth/alice.json',
	})
	try {
		// The stored session carries no active organization, and removal is
		// scoped to one — without this every call comes back NO_ACTIVE_ORGANIZATION
		// and nothing is actually tidied.
		await context.request
			.post(`${BASE_URL}/auth/organization/set-active`, {
				headers: { origin: BASE_URL, 'content-type': 'application/json' },
				data: { organizationSlug: 'taller' },
			})
			.catch(() => undefined)
		for (const email of addedForCleanup) {
			await context.request
				.post(`${BASE_URL}/auth/organization/remove-member`, {
					headers: { origin: BASE_URL, 'content-type': 'application/json' },
					data: { memberIdOrEmail: email },
				})
				.catch(() => undefined)
		}
	} finally {
		await context.close()
	}
})

// Signs in Carol, a plain member of taller, in her own context. Empty
// storageState on purpose: the authed project injects Alice's cookie by
// default, which would make every assertion below run as the owner instead.
//
// Signed in over the API rather than through the page: her login is not what
// any of these tests are about, and loading a cold page for it costs more than
// everything they actually assert.
async function signInAsCarol(
	browser: import('@playwright/test').Browser,
): Promise<BrowserContext> {
	const context = await browser.newContext({
		ignoreHTTPSErrors: true,
		baseURL: BASE_URL,
		storageState: { cookies: [], origins: [] },
	})
	const headers = { origin: BASE_URL, 'content-type': 'application/json' }
	const signedIn = await context.request.post(
		`${BASE_URL}/auth/sign-in/email`,
		{
			headers,
			data: { email: 'colleague@taller.cat', password: 'batuda-dev-2026' },
		},
	)
	expect(signedIn.ok(), 'Carol should be able to sign in').toBe(true)
	const switched = await context.request.post(
		`${BASE_URL}/auth/organization/set-active`,
		{ headers, data: { organizationSlug: 'taller' } },
	)
	expect(switched.ok(), 'Carol should reach taller').toBe(true)
	return context
}

test.describe('adding a member', () => {
	test.beforeEach(async ({ page }) => {
		// Sibling tests may have flipped Alice's active org; reset before each
		// scenario so the members page resolves to taller.
		await page.goto('/', { waitUntil: 'commit' })
		await setActiveOrgBySlug(page, 'taller')
	})

	test.describe('when an owner adds someone new', () => {
		test('should list them straight away and email them nothing they could sign in with', async ({
			page,
		}) => {
			// GIVEN a fresh address and the add panel open
			const recipient = freshEmail('added')
			const startedAt = Date.now()
			await openAddMemberPanel(page)

			// WHEN Alice submits the form
			await addMember(page, recipient)

			// THEN the success banner confirms it and the person is in the list —
			// there is no pending state to wait through
			await expect(page.getByTestId('add-member-success')).toBeVisible({
				timeout: 10_000,
			})
			await expect(memberRow(page, recipient)).toBeVisible({ timeout: 10_000 })

			// AND the email they get carries no link to sign in with and no token
			const welcome = await findLatestMessage({
				recipient,
				label: 'member-added',
				sinceMs: startedAt,
				maxWaitMs: 10_000,
			})
			expect(welcome.body).not.toMatch(/\/auth\/magic-link\/verify/)
			expect(welcome.body).not.toMatch(/token=/)
			// AND it points them at the sign-in page instead, with the origin
			// joined cleanly — a trailing slash on the configured public URL
			// would otherwise produce `//login`
			expect(welcome.body).toMatch(/[^/]\/login\b/)
			expect(welcome.body).not.toMatch(/\/\/login\b/)
		})
	})

	test.describe('when the chosen language is Catalan', () => {
		test('should write the welcome email in Catalan', async ({ page }) => {
			// GIVEN a fresh address and Catalan picked in the panel
			const recipient = freshEmail('added-ca')
			const startedAt = Date.now()
			await openAddMemberPanel(page)
			await selectMemberLocale(page, 'ca')

			// WHEN Alice submits the form
			await addMember(page, recipient)
			await expect(page.getByTestId('add-member-success')).toBeVisible({
				timeout: 10_000,
			})

			// THEN the email is written in Catalan, not the English default
			const welcome = await findLatestMessage({
				recipient,
				label: 'member-added',
				sinceMs: startedAt,
				maxWaitMs: 10_000,
			})
			expect(welcome.body).toContain('Inicia la sessió')
			expect(welcome.body).not.toContain('added you to')
		})
	})

	test.describe('when the chosen role is admin', () => {
		test('should add them as an admin, not silently as a member', async ({
			page,
		}) => {
			// GIVEN a fresh address and Admin picked in the panel
			const recipient = freshEmail('added-admin')
			await openAddMemberPanel(page)
			await selectMemberRole(page, 'admin')

			// WHEN Alice submits the form
			await addMember(page, recipient)
			await expect(page.getByTestId('add-member-success')).toBeVisible({
				timeout: 10_000,
			})

			// THEN the roster shows them carrying the admin role, not the default
			const row = memberRow(page, recipient)
			await expect(row).toBeVisible({ timeout: 10_000 })
			await expect(row.locator('[data-testid^="member-role-"]')).toContainText(
				/admin/i,
			)
		})
	})

	test.describe('when the person is already in the organization', () => {
		test('should refuse and say so rather than adding them twice', async ({
			page,
		}) => {
			// GIVEN someone who is already a member of taller
			await openAddMemberPanel(page)

			// WHEN Alice tries to add them again
			await addMember(page, 'colleague@taller.cat')

			// THEN the form reports it and no success banner appears
			await expect(page.getByTestId('add-member-error')).toBeVisible({
				timeout: 10_000,
			})
			await expect(page.getByTestId('add-member-success')).toHaveCount(0)

			// AND the message names the duplicate specifically. The same testid
			// renders for every failure kind, so without this a 409 quietly
			// degrading to a 500 would still pass.
			await expect(page.getByTestId('add-member-error')).toContainText(
				'colleague@taller.cat',
			)

			// AND they are still listed exactly once — no second membership row
			await expect(memberRow(page, 'colleague@taller.cat')).toHaveCount(1)
		})
	})

	// Someone can already have a Batuda account when they are added — they work
	// at two of your clients, or you removed them and changed your mind. That
	// path skips account creation entirely and has its own rules about their
	// language, so it is worth exercising separately from a fresh address.
	test.describe('when the person already has an account', () => {
		test('should add them to the second organization and keep the language they already had', async ({
			page,
			browser,
		}) => {
			// Two adds and an inbox poll — past a single test's default budget,
			// and all of it real work.
			test.setTimeout(60_000)

			// GIVEN someone added to taller who reads Catalan
			const recipient = freshEmail('two-orgs')
			await openAddMemberPanel(page)
			await selectMemberLocale(page, 'ca')
			await addMember(page, recipient)
			await expect(page.getByTestId('add-member-success')).toBeVisible({
				timeout: 10_000,
			})

			// AND Bea, who is an admin of a second organization. Signed in over the
			// API rather than through the page: her login is not what this test is
			// about, and loading a cold page for it costs more than everything else
			// here put together.
			const beaContext = await browser.newContext({
				ignoreHTTPSErrors: true,
				baseURL: BASE_URL,
				storageState: { cookies: [], origins: [] },
			})
			const signedIn = await beaContext.request.post(
				`${BASE_URL}/auth/sign-in/email`,
				{
					headers: { origin: BASE_URL, 'content-type': 'application/json' },
					data: { email: 'boss@batuda.dev', password: 'batuda-dev-2026' },
				},
			)
			expect(signedIn.ok(), 'Bea should be able to sign in').toBe(true)
			const switched = await beaContext.request.post(
				`${BASE_URL}/auth/organization/set-active`,
				{
					headers: { origin: BASE_URL, 'content-type': 'application/json' },
					data: { organizationSlug: 'restaurant' },
				},
			)
			expect(switched.ok(), 'Bea should reach the second org').toBe(true)

			// WHEN she adds that same person to her organization, choosing English
			const startedAt = Date.now()
			const added = await beaContext.request.post(`${BASE_URL}/v1/members`, {
				headers: { origin: BASE_URL, 'content-type': 'application/json' },
				data: { email: recipient, role: 'member', locale: 'en' },
			})

			// THEN they join, and the language they already had wins over the one
			// picked here — a second organization does not get to relabel someone
			expect(added.status()).toBe(200)
			expect((await added.json()).locale).toBe('ca')

			// AND the note telling them so is written in that language too
			const welcome = await findLatestMessage({
				recipient,
				label: 'member-added',
				sinceMs: startedAt,
				maxWaitMs: 10_000,
			})
			expect(welcome.body).toContain('t’ha afegit a')
			expect(welcome.body).not.toContain('added you to')

			await beaContext.close()
		})
	})

	// The UI hides the add controls from a regular member, but hiding a button
	// is not authorization — anyone can post to the endpoint directly. These
	// probe the server the way someone bypassing the page would.
	test.describe('when a regular member calls the API directly', () => {
		// One session for the whole block — each probe is a single request.
		let carolContext: BrowserContext | undefined

		test.beforeAll(async ({ browser }) => {
			carolContext = await signInAsCarol(browser)
		})

		test.afterAll(async () => {
			await carolContext?.close()
		})

		test('should refuse to add anyone and write nothing', async () => {
			// GIVEN Carol, a plain member of taller, signed in
			const victim = `bypass-${Date.now()}@example.com`

			// WHEN she posts to the add-member endpoint herself
			const refused = await carolContext!.request.post(
				`${BASE_URL}/v1/members`,
				{
					headers: { origin: BASE_URL, 'content-type': 'application/json' },
					data: { email: victim, role: 'admin', locale: 'en' },
				},
			)

			// THEN the server refuses — this check is the only authorization on
			// the path, because Better Auth's own add-member performs none
			expect(refused.status()).toBe(403)
			expect((await refused.json())._tag).toBe('Forbidden')

			// AND nothing was created: the guard runs before the account write, so
			// a refused call cannot leave an account behind
			const carol = await carolContext!.newPage()
			await carol.goto('/settings/organization/members', {
				waitUntil: 'networkidle',
			})
			await expect(memberRow(carol, victim)).toHaveCount(0)
			await carol.close()
		})

		test('should not be able to reach Better Auth’s own add-member endpoint', async () => {
			// GIVEN Carol signed in
			// WHEN she posts straight to Better Auth's add-member, which has no
			// role check of its own
			const response = await carolContext!.request.post(
				`${BASE_URL}/auth/organization/add-member`,
				{
					headers: { origin: BASE_URL, 'content-type': 'application/json' },
					data: { userId: 'anything', role: 'owner', organizationId: 'any' },
				},
			)

			// THEN it is not routable at all. It is declared without a path, so
			// the router never registers it — the day that changes, this endpoint
			// becomes an unauthenticated way to make anyone an owner.
			expect(response.status()).toBe(404)
		})

		test('should not be able to set its own stored language', async () => {
			// GIVEN Carol signed in
			// WHEN she tries to write the language field directly
			const response = await carolContext!.request.post(
				`${BASE_URL}/auth/update-user`,
				{
					headers: { origin: BASE_URL, 'content-type': 'application/json' },
					data: { locale: '__proto__' },
				},
			)

			// THEN the field is rejected. It keys an email-template lookup, so an
			// arbitrary string there produces a broken message rather than a
			// missing one.
			expect(response.status()).toBe(400)
			expect((await response.json()).code).toBe('FIELD_NOT_ALLOWED')
		})
	})

	test.describe('when a regular member views the page', () => {
		test('should see the roster read-only with no add or remove controls', async ({
			browser,
		}) => {
			// GIVEN Carol, a plain member of taller, signed in
			const carolContext = await signInAsCarol(browser)
			const carol = await carolContext!.newPage()

			// WHEN she opens the members page
			await carol.goto('/settings/organization/members', {
				waitUntil: 'networkidle',
			})

			// THEN she can see who is in the workspace
			await expect(memberRow(carol, 'colleague@taller.cat')).toBeVisible()
			// BUT there is no add CTA and no remove controls
			await expect(carol.getByTestId('add-member-open')).toHaveCount(0)
			await expect(
				carol.locator('[data-testid^="member-remove-"]'),
			).toHaveCount(0)

			await carolContext.close()
		})
	})
})

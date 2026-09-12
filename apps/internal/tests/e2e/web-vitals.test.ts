import { expect, test } from '@playwright/test'

import { waitForHydrated } from './helpers/hydration'
import {
	HYDRATION_ERROR,
	LIGHTHOUSE_PROFILES,
	readPaint,
	settle,
	throttle,
	trackConsoleErrors,
	trackPaint,
} from './helpers/web-vitals'

/* How the app loads, measured the way PageSpeed measures it. Three things
 * every other e2e test passes through without noticing:
 *
 * - The page moves after it has painted (a list or an inbox reflowing once
 *   its data or fonts arrive), while every functional check stays green.
 * - The server renders a page's data and the browser throws it away: the
 *   loader's handover fails quietly, the page looks right, and every visitor
 *   fetches the same data again after hydration.
 * - The fonts stop being self-hosted. A single `<link>` to a fonts CDN is a
 *   render-blocking third-party request and a layout shift when the face
 *   swaps in, and nothing else here would object to it.
 *
 * The numbers here are measured against the dev server, which is slower and
 * unminified but paints the same layout; a budget met here is met in
 * production. What the dev server cannot show is the response headers the
 * production Worker adds (the `Link` preloads, the year-long asset cache), so
 * those stay with the production-build harness. Each measurement is recorded
 * as a test annotation, so the report shows the numbers behind a pass. */

/* Google's "good" bar is 0.1. The pages measure 0.001 to 0.002, so 0.05 leaves
 * room for noise while still catching a shift a visitor would notice. */
const CLS_BUDGET = 0.05

/* Throttled runs against the dev server take longer than the suite default,
 * and the first visit to a route also compiles it. */
const THROTTLED_TIMEOUT = 120_000

const SIGNED_OUT = { cookies: [], origins: [] }

test.describe('layout stability', () => {
	for (const [device, profile] of Object.entries(LIGHTHOUSE_PROFILES)) {
		test.describe(`on a ${device} connection`, () => {
			test.use({ viewport: { width: profile.width, height: profile.height } })

			test.describe('when a visitor opens the sign-in page', () => {
				test.use({ storageState: SIGNED_OUT })

				test('should settle without the form moving', async ({
					context,
					page,
				}) => {
					test.setTimeout(THROTTLED_TIMEOUT)
					// GIVEN a cold load, slow enough that paint and hydration cannot race
					await throttle(context, page, profile)
					await trackPaint(page)

					// WHEN the page has painted, hydrated and its fonts have landed
					const response = await page.goto('/login')
					expect(response?.status(), 'the page must actually load').toBe(200)
					await settle(page)

					// THEN something was measured at all
					const paint = await readPaint(page)
					expect(paint.lcp, 'nothing was measured').toBeGreaterThan(0)

					// AND nothing moved enough for a visitor to notice
					test.info().annotations.push({
						type: 'web-vitals',
						description: `/login ${device} cls=${paint.cls} lcp=${paint.lcp} shifts=${JSON.stringify(paint.shifts)}`,
					})
					expect(
						paint.cls,
						`shifts: ${JSON.stringify(paint.shifts)}`,
					).toBeLessThan(CLS_BUDGET)
				})
			})

			for (const route of [
				'/',
				'/companies',
				'/research',
				'/settings/organization/members',
			]) {
				test.describe(`when Alice opens ${route}`, () => {
					test('should settle without the page moving', async ({
						context,
						page,
					}) => {
						test.setTimeout(THROTTLED_TIMEOUT)
						// GIVEN Alice's session (from the setup project) and a throttled
						// cold load
						await throttle(context, page, profile)
						await trackPaint(page)

						// WHEN the page has painted and its data has hydrated
						const response = await page.goto(route)
						expect(response?.status(), 'the page must actually load').toBe(200)
						await settle(page)

						// THEN the measurement ran, and the page stayed still
						const paint = await readPaint(page)
						expect(paint.lcp, 'nothing was measured').toBeGreaterThan(0)
						test.info().annotations.push({
							type: 'web-vitals',
							description: `${route} ${device} cls=${paint.cls} lcp=${paint.lcp} shifts=${JSON.stringify(paint.shifts)}`,
						})
						expect(
							paint.cls,
							`shifts: ${JSON.stringify(paint.shifts)}`,
						).toBeLessThan(CLS_BUDGET)
					})

					test('should hydrate without a server/client mismatch', async ({
						page,
					}) => {
						// GIVEN console output captured from before navigation. This one
						// runs at full speed: a mismatch is a question of what the two
						// sides render at this viewport, not of how fast they get there,
						// and on a throttled dev server the browser's own answers arrive
						// late enough to hide the very race this guards against.
						test.setTimeout(THROTTLED_TIMEOUT)
						const errors = trackConsoleErrors(page)

						// WHEN the page loads and hydrates
						const response = await page.goto(route)
						expect(response?.status(), 'the page must actually load').toBe(200)
						await settle(page)

						// THEN React took the page over. Without this the test passes
						// on a page that never hydrated, because that logs nothing too.
						await waitForHydrated(page)

						// AND it reported no mismatch between what the server sent and
						// what the browser rendered
						const mismatches = errors.filter(text => HYDRATION_ERROR.test(text))
						expect(mismatches, mismatches.join('\n')).toHaveLength(0)
					})
				})
			}
		})
	}
})

test.describe('data painted on the server', () => {
	test.describe('when the dashboard is fetched without JavaScript', () => {
		test.use({ javaScriptEnabled: false })

		// Tagged so it gates a pull request: CI's smoke subset is `--grep @smoke`,
		// and a broken handover is invisible to every functional test.
		test('should already show the pipeline, not a spinner', {
			tag: '@smoke',
		}, async ({ page }) => {
			// GIVEN Alice's session and the served HTML rendered on its own
			const response = await page.goto('/')
			expect(response?.status()).toBe(200)

			// THEN the page is the dashboard with its counters laid out, not the
			// waiting state the browser would otherwise have to fetch its way out
			// of. The loader fetches the pipeline on the server and hands it to
			// the page; when that handover fails the server renders the spinner
			// and the browser quietly asks the API again.
			const dashboard = page.getByTestId('pipeline-page')
			await expect(dashboard).toBeVisible()
			await expect(dashboard.getByRole('status')).toHaveCount(0)
			await expect(
				dashboard.getByRole('link', { name: /active companies/i }),
			).toBeVisible()
			await expect(
				dashboard.getByRole('link', { name: /open tasks/i }),
			).toBeVisible()

			// AND the top bar already names the organisation: the server reads who
			// is signed in and hands it over with the page, so nothing waits on the
			// browser to find out.
			await expect(page.getByTestId('active-org-name')).not.toHaveText(
				/no active organi[sz]ation/i,
			)
			await expect(page.getByTestId('active-org-name')).not.toBeEmpty()
		})
	})

	test.describe('when the API answers the browser slowly', () => {
		// Tagged so it gates a pull request: this is the check that would have
		// caught the dashboard quietly refetching everything after hydration.
		test('should show the pipeline from the server without waiting for it', {
			tag: '@smoke',
		}, async ({ page }) => {
			// GIVEN the browser's own pipeline requests take far longer than the
			// page should need. An atom that was handed over from the server still
			// asks the API once more after mounting (it shows the server's value
			// while the fresh one is in flight), so the request itself is expected;
			// what must not happen is the page waiting on it.
			await page.route(/\/v1\/pipeline(\/next-steps)?(\?.*)?$/, async route => {
				await new Promise(resolve => setTimeout(resolve, 8_000))
				await route.continue()
			})

			// WHEN the dashboard loads and hydrates
			const response = await page.goto('/')
			expect(response?.status()).toBe(200)

			// THEN the counters are there long before that request could answer,
			// because the loader fetched them on the server and handed them over.
			// When that handover broke, the page sat on the spinner until the
			// browser had fetched everything itself.
			const dashboard = page.getByTestId('pipeline-page')
			await expect(
				dashboard.getByRole('link', { name: /active companies/i }),
			).toBeVisible({ timeout: 3_000 })
			await expect(dashboard.getByRole('status')).toHaveCount(0)
		})
	})
})

test.describe('fonts', () => {
	test.use({ storageState: SIGNED_OUT })

	test.describe('when the sign-in page loads', () => {
		// Tagged so it gates a pull request: a fonts CDN creeping back in is a
		// one-line change no functional test would notice.
		test('should preload every brand face from its own origin', {
			tag: '@smoke',
		}, async ({ page }) => {
			// GIVEN every font request is recorded with where it went
			const fontOrigins: Array<string> = []
			page.on('request', request => {
				if (request.resourceType() === 'font') {
					fontOrigins.push(new URL(request.url()).origin)
				}
			})

			// WHEN the page loads and settles
			const response = await page.goto('/login')
			expect(response?.status()).toBe(200)
			await settle(page)

			// THEN the five faces the first screen uses are asked for up front.
			// The faces are declared `font-display: optional`, so a face that has
			// not arrived by first paint sits out the whole visit: the preload is
			// what decides whether the brand fonts show at all.
			await expect(page.locator('link[rel="preload"][as="font"]')).toHaveCount(
				5,
			)

			// AND every font came from this site, none from a fonts CDN. A
			// third-party stylesheet blocks the first paint and swaps the face in
			// afterwards, which is the layout shift the sign-in card used to have.
			const own = new URL(page.url()).origin
			expect(fontOrigins.length, 'no font was fetched').toBeGreaterThan(0)
			expect(fontOrigins.filter(origin => origin !== own)).toHaveLength(0)
		})
	})
})

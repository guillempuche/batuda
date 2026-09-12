import type { BrowserContext, Page } from '@playwright/test'

/**
 * Paint measurements for a page, read back the way Lighthouse reads them.
 *
 * `cls` is the sum of every layout shift the visitor did not cause; `shifts`
 * keeps each one so a failure says when the page moved. `lcp` is the time of
 * the largest paint, and doubles as proof that anything was measured: it is
 * zero only when the observer never ran.
 */
export type PaintMetrics = {
	readonly cls: number
	readonly shifts: ReadonlyArray<{ at: number; value: number }>
	readonly fcp: number
	readonly lcp: number
}

declare global {
	interface Window {
		__webVitals?: {
			cls: number
			shifts: Array<{ at: number; value: number }>
			lcp: number
		}
	}
}

/**
 * Install before the first navigation. Layout-shift entries are only buffered
 * for observers that exist when the shift happens, and the shifts worth
 * catching are the ones hydration causes, long before any `page.evaluate`
 * could run afterwards.
 */
export async function trackPaint(page: Page): Promise<void> {
	await page.addInitScript(() => {
		const tracked = {
			cls: 0,
			shifts: [] as Array<{ at: number; value: number }>,
			lcp: 0,
		}
		window.__webVitals = tracked

		new PerformanceObserver(list => {
			for (const entry of list.getEntries() as Array<
				PerformanceEntry & { value: number; hadRecentInput: boolean }
			>) {
				if (entry.hadRecentInput) continue
				tracked.cls += entry.value
				tracked.shifts.push({
					at: Math.round(entry.startTime),
					value: Number(entry.value.toFixed(4)),
				})
			}
		}).observe({ type: 'layout-shift', buffered: true })

		new PerformanceObserver(list => {
			const entries = list.getEntries()
			const last = entries[entries.length - 1]
			if (last) tracked.lcp = Math.round(last.startTime)
		}).observe({ type: 'largest-contentful-paint', buffered: true })
	})
}

/**
 * Throws rather than defaulting when the tracker never ran. An uninstrumented
 * page would otherwise report a perfect zero and pass every budget, and a
 * Playwright upgrade or a stricter document policy could retire this whole
 * suite without anyone noticing.
 */
export async function readPaint(page: Page): Promise<PaintMetrics> {
	const paint = await page.evaluate(() => {
		const tracked = window.__webVitals
		if (!tracked) return null
		const fcp = performance
			.getEntriesByType('paint')
			.find(entry => entry.name === 'first-contentful-paint')
		return {
			cls: Number(tracked.cls.toFixed(4)),
			shifts: tracked.shifts,
			fcp: Math.round(fcp?.startTime ?? 0),
			lcp: tracked.lcp,
		}
	})
	if (!paint) {
		throw new Error(
			'readPaint: window.__webVitals is missing, so nothing was measured. Call trackPaint(page) before navigating.',
		)
	}
	return paint
}

/**
 * How React reports a server/client mismatch, in both wordings: the readable
 * one from a development build and the minified codes (418, 423, 425) from a
 * production build. A filter written against one alone can only ever pass
 * against the other.
 */
export const HYDRATION_ERROR =
	/Minified React error #(418|423|425)|react\.dev\/errors\/(418|423|425)|Hydration failed|hydration mismatch|did ?n.t match the client/i

/** Collect console errors and uncaught exceptions from before navigation. */
export function trackConsoleErrors(page: Page): Array<string> {
	const errors: Array<string> = []
	page.on('console', message => {
		if (message.type() === 'error') errors.push(message.text())
	})
	page.on('pageerror', error => errors.push(error.message))
	return errors
}

/**
 * Long enough for hydration, the fonts and the first data reads to land.
 * Shifts only accumulate, so waiting longer can only make the check stricter.
 */
export async function settle(page: Page): Promise<void> {
	await page.waitForLoadState('load')
	await page.waitForTimeout(2000)
}

export type ThrottleProfile = {
	readonly width: number
	readonly height: number
	readonly rttMs: number
	readonly downBytesPerSec: number
	readonly cpuSlowdown: number
}

/**
 * The two Lighthouse device profiles, so a failure here and a PageSpeed
 * failure describe the same thing. The throttling is what makes the numbers
 * repeatable: unthrottled, first paint and hydration race, and the same build
 * can measure anywhere between no shift and a full-screen one from run to run.
 */
export const LIGHTHOUSE_PROFILES = {
	desktop: {
		width: 1350,
		height: 940,
		rttMs: 40,
		downBytesPerSec: (10240 * 1024) / 8,
		cpuSlowdown: 1,
	},
	mobile: {
		width: 412,
		height: 823,
		rttMs: 150,
		downBytesPerSec: 1474560 / 8,
		cpuSlowdown: 4,
	},
} as const satisfies Record<string, ThrottleProfile>

/** Emulate a network and CPU profile for one page through Chrome's protocol. */
export async function throttle(
	context: BrowserContext,
	page: Page,
	profile: ThrottleProfile,
): Promise<void> {
	const cdp = await context.newCDPSession(page)
	await cdp.send('Network.enable')
	await cdp.send('Network.emulateNetworkConditions', {
		offline: false,
		latency: profile.rttMs,
		downloadThroughput: profile.downBytesPerSec,
		uploadThroughput: profile.downBytesPerSec / 2,
	})
	await cdp.send('Emulation.setCPUThrottlingRate', {
		rate: profile.cpuSlowdown,
	})
}

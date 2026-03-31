import { expect, Locator, Page, test } from "@playwright/test"

async function eachBox(
    page: Page,
    callback: (box: Locator, index: number) => Promise<void>
) {
    const boxes = page.locator(".box")
    const count = await boxes.count()
    expect(count).toBe(3)
    await callback(boxes.nth(0), 0)
    await callback(boxes.nth(1), 1)
    await callback(boxes.nth(2), 2)
}

async function eachStaggerBox(
    page: Page,
    callback: (box: Locator, index: number) => Promise<void>
) {
    const boxes = page.locator(".box")
    const count = await boxes.count()
    expect(count).toBe(12) // 3 groups × 4 boxes each
    for (let i = 0; i < count; i++) {
        await callback(boxes.nth(i), i)
    }
}

test.describe("scroll()", () => {
    test.use({ viewport: { width: 500, height: 500 } })

    test("delay - animations with delay should be less than halfway when scrolled halfway", async ({
        page,
    }) => {
        await page.goto("scroll/scroll-delay.html")
        await page.reload()

        // Get the total scroll height (400vh)
        const totalScrollHeight = await page.evaluate(() => {
            return document.documentElement.scrollHeight - window.innerHeight
        })

        // Scroll to halfway point
        const halfwayScroll = totalScrollHeight / 2
        await page.evaluate((scrollY) => {
            window.scrollTo(0, scrollY)
        }, halfwayScroll)

        // Wait a moment for scroll-triggered animations to update
        await page.waitForTimeout(100)

        await eachBox(page, async (box) => {
            const boundingBox = await box.boundingBox()
            // The animation goes from 0 to 100px translateX
            // With delay, when we're halfway through scroll, the animation should be less than 50px
            // because the delay means the animation starts later in the scroll timeline
            expect(boundingBox?.x).toBeLessThan(50)
            expect(boundingBox?.x).toBeGreaterThan(0)
        })

        // Now scroll to the bottom of the page
        await page.evaluate((scrollY) => {
            window.scrollTo(0, scrollY)
        }, totalScrollHeight)

        // Wait for animations to complete
        await page.waitForTimeout(100)

        // At the bottom, all boxes should be at 100px translateX
        await eachBox(page, async (box) => {
            const boundingBox = await box.boundingBox()
            expect(boundingBox?.x).toBeCloseTo(100, 1)
        })
    })

    test("stagger - animations with stagger delay should all be at 100px at bottom", async ({
        page,
    }) => {
        await page.goto("scroll/scroll-stagger.html")
        await page.reload()

        // Record the initial bounding box x for each box
        const initialXs: number[] = []
        await eachStaggerBox(page, async (box) => {
            const boundingBox = await box.boundingBox()
            initialXs.push(boundingBox?.x ?? 0)
        })

        // Get the total scroll height (400vh)
        const totalScrollHeight = await page.evaluate(() => {
            return document.documentElement.scrollHeight - window.innerHeight
        })

        // Scroll to the bottom of the page
        await page.evaluate((scrollY) => {
            window.scrollTo(0, scrollY)
        }, totalScrollHeight)

        // Wait for animations to complete
        await page.waitForTimeout(100)

        // At the bottom, all boxes should be at 100px translateX from their initial position regardless of stagger
        let i = 0
        await eachStaggerBox(page, async (box) => {
            const boundingBox = await box.boundingBox()
            const initialX = initialXs[i++]
            expect(boundingBox?.x).toBeCloseTo(initialX + 100, 1)
        })
    })
})

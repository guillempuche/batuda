import { expect, test } from "@playwright/test"

test.describe("Carousel focus item", () => {
    test.skip(
        ({ browserName }) => browserName === "webkit",
        "Skipping test in WebKit, focus detection doesn't work"
    )

    test.beforeEach(async ({ page }) => {
        await page.goto("/tests/CarouselFocusItem")
        await page.waitForTimeout(200) // Wait for carousel to initialize
    })

    test("Focus item does not scroll the carousel container", async ({
        page,
    }) => {
        const beforeButton = page.locator("#before-carousel")
        const container = page.locator("#carousel-focus [role='region']")
        const ul = page.locator("#carousel-focus ul")

        // Focus the before button
        await beforeButton.focus()
        await expect(beforeButton).toBeFocused()

        // Tab into the carousel
        await page.keyboard.press("Tab")

        // Wait for focus to settle
        await page.waitForTimeout(100)

        // The container should not have scrolled
        const scrollLeft = await container.evaluate(
            (el) => el.scrollLeft
        )
        expect(scrollLeft).toBe(0)

        // The ul transform should still be a valid matrix
        const transform = await ul.evaluate(
            (el) => getComputedStyle(el).transform
        )
        expect(transform).toMatch(/^matrix\(/)
    })
})

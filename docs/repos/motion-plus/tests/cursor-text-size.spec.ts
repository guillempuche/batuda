import { expect, Page, test } from "@playwright/test"

async function wakeCursor(page: Page, x = 100, y = 100) {
    await page.waitForTimeout(30)
    await page.mouse.move(x, y)
    await page.waitForTimeout(30)
    await page.mouse.move(x + 1, y + 1)
}

test.beforeEach(async ({ page }) => {
    await page.goto("/tests/Cursor")
})

test.describe("Cursor match text size", () => {
    test("matches text size", async ({ page }) => {
        await wakeCursor(page)

        await page.hover("[data-testid='h3']")

        await page.waitForTimeout(400)

        const boundingBox = await page.getByTestId("cursor").boundingBox()

        expect(boundingBox).not.toBeNull()
        expect(boundingBox?.width).toBe(4)
        expect(boundingBox?.height).toBe(32)

        const followBoundingBox = await page
            .getByTestId("follow-cursor")
            .boundingBox()

        expect(followBoundingBox).not.toBeNull()
        expect(Math.round(followBoundingBox?.width || 0)).toBe(100)
        expect(Math.round(followBoundingBox?.height || 0)).toBe(100)
    })
})

import { expect, Page, test } from "@playwright/test"

async function wakeCursor(page: Page, x = 100, y = 100) {
    await page.waitForTimeout(30)
    await page.mouse.move(x, y)
    await page.waitForTimeout(30)
    await page.mouse.move(x + 1, y + 1)
}

test.beforeEach(async ({ page }) => {
    await page.goto("/tests/CursorZone")
})

test.describe("Cursor zoning", () => {
    test("cursor should be black when hovering over white element", async ({
        page,
    }) => {
        await wakeCursor(page)
        await page.hover("#white")
        await page.waitForTimeout(100)
        const cursor = await page.locator("#cursor")
        const backgroundColor = await cursor.evaluate(
            (el) => window.getComputedStyle(el).backgroundColor
        )
        await expect(backgroundColor).toBe("rgb(0, 0, 0)")
    })

    test("cursor should be white when hovering over red element", async ({
        page,
    }) => {
        await wakeCursor(page)
        await page.hover("#red")
        await page.waitForTimeout(100)
        const cursor = await page.locator("#cursor")
        const backgroundColor = await cursor.evaluate(
            (el) => window.getComputedStyle(el).backgroundColor
        )
        await expect(backgroundColor).toBe("rgb(255, 255, 255)")
    })

    test("cursor should transition from black to white when moving from white to red element", async ({
        page,
    }) => {
        await wakeCursor(page)
        await page.hover("#white")
        await page.waitForTimeout(100)
        await page.hover("#red")
        await page.waitForTimeout(100)
        const cursor = await page.locator("#cursor")
        const backgroundColor = await cursor.evaluate(
            (el) => window.getComputedStyle(el).backgroundColor
        )
        await expect(backgroundColor).toBe("rgb(255, 255, 255)")
    })

    test("cursor should be red when not hovering over any themed element", async ({
        page,
    }) => {
        await wakeCursor(page)
        await page.hover("#red")
        await page.waitForTimeout(100)
        await page.mouse.move(0, 0)
        await page.waitForTimeout(100)
        const cursor = await page.locator("#cursor")
        const backgroundColor = await cursor.evaluate(
            (el) => window.getComputedStyle(el).backgroundColor
        )
        await expect(backgroundColor).toBe("rgb(255, 0, 0)")
    })
})

import { expect, Page, test } from "@playwright/test"

async function wakeCursor(page: Page, x = 100, y = 100) {
    await page.waitForTimeout(30)
    await page.mouse.move(x, y)
    await page.waitForTimeout(30)
    await page.mouse.move(x + 1, y + 1)
}

const defaultSize = 17

test.beforeEach(async ({ page }) => {
    await page.goto("/tests/Cursor")
})

test.describe("Cursor default behaviour", () => {
    test("cursor is hidden until mouse move", async ({ page }) => {
        await expect(page.getByTestId("cursor")).toHaveCount(0)
        await wakeCursor(page)
        await expect(page.getByTestId("cursor")).toHaveCount(1)
    })

    test("has default cursor styles", async ({ page }) => {
        await wakeCursor(page)

        await expect(page.getByTestId("cursor")).toHaveCSS(
            "background-color",
            "rgb(51, 51, 51)"
        )
        await expect(page.getByTestId("cursor")).toHaveCSS(
            "border-radius",
            "20px"
        )
        await expect(page.getByTestId("cursor")).toHaveCSS("z-index", "99999")
    })

    test("is default size", async ({ page }) => {
        await wakeCursor(page, 0, 100)

        await page.waitForTimeout(200)

        const boundingBox = await page.getByTestId("cursor").boundingBox()

        expect(boundingBox).not.toBeNull()
        expect(boundingBox?.width).toBe(defaultSize)
        expect(boundingBox?.height).toBe(defaultSize)
    })

    test("is default pointer size", async ({ page }) => {
        await wakeCursor(page)

        await page.hover("[data-testid='pointer-target']")

        await page.waitForTimeout(200)

        const boundingBox = await page.getByTestId("cursor").boundingBox()

        expect(boundingBox).not.toBeNull()
        expect(boundingBox?.width).toBe(31)
        expect(boundingBox?.height).toBe(31)
    })

    test("matches text size", async ({ page }) => {
        await wakeCursor(page)

        await page.hover("[data-testid='h3']")

        await page.waitForTimeout(200)

        const boundingBox = await page.getByTestId("cursor").boundingBox()

        expect(boundingBox).not.toBeNull()
        expect(boundingBox?.width).toBe(4)
        expect(boundingBox?.height).toBe(32)
    })

    test("defaults to center: 0.5", async ({ page }) => {
        await wakeCursor(page)

        await page.mouse.move(0, 100)

        await page.waitForTimeout(300)

        const boundingBox = await page.getByTestId("cursor").boundingBox()

        expect(boundingBox).not.toBeNull()
        expect(boundingBox?.x).toBe(0 - defaultSize / 2)
        expect(boundingBox?.y).toBe(100 - defaultSize / 2)
    })
})

test.describe("Cursor default follow behaviour", () => {
    test("cursor follows mouse", async ({ page }) => {
        await wakeCursor(page)

        await page.mouse.move(0, 100)

        await page.waitForTimeout(200)

        const boundingBox = await page
            .getByTestId("follow-cursor")
            .boundingBox()

        expect(boundingBox).not.toBeNull()
        expect(boundingBox?.x).toBe(0)
        expect(boundingBox?.y).toBe(100)
        expect(boundingBox?.width).toBe(100)
        expect(boundingBox?.height).toBe(100)
    })

    test("doesn't scale down on click", async ({ page }) => {
        await wakeCursor(page)

        await page.mouse.move(100, 100)
        await page.mouse.down()

        await page.waitForTimeout(200)

        const boundingBox = await page
            .getByTestId("follow-cursor")
            .boundingBox()

        expect(boundingBox).not.toBeNull()
        expect(boundingBox?.x).toBe(100)
        expect(boundingBox?.y).toBe(100)
        expect(boundingBox?.width).toBe(100)
        expect(boundingBox?.height).toBe(100)
    })
})

import { expect, Page, test } from "@playwright/test"

async function wakeCursor(page: Page, x = 100, y = 100) {
    await page.waitForTimeout(30)
    await page.mouse.move(x, y)
    await page.waitForTimeout(30)
    await page.mouse.move(x + 1, y + 1)
}

test.beforeEach(async ({ page, browserName }) => {
    test.skip(browserName !== "webkit", "Flaky in WebKit")
    await page.goto("/tests/CursorOptions")
})

test.describe("Cursor options", () => {
    test("changes color on hover over button", async ({ page }) => {
        await wakeCursor(page)
        await page.hover("[data-testid='pointer-target']")
        await page.waitForTimeout(200)

        await expect(page.getByTestId("cursor")).toHaveCSS(
            "background-color",
            "rgb(255, 0, 0)" // #f00 from variants.pointer
        )
    })

    test("has green background color by default", async ({ page }) => {
        await wakeCursor(page)
        await page.waitForTimeout(200)

        await expect(page.getByTestId("cursor")).toHaveCSS(
            "background-color",
            "rgb(0, 255, 0)" // #0f0 from style prop
        )
    })

    test("can set center position", async ({ page }) => {
        await wakeCursor(page)
        await page.mouse.move(100, 100)
        await page.waitForTimeout(200)

        const boundingBox = await page.getByTestId("follow").boundingBox()

        expect(boundingBox).not.toBeNull()
        expect(boundingBox?.x).toBe(0) // 100 - 100 (offset.x) = 0
        expect(boundingBox?.y).toBe(0) // 100 - 100 (offset.y) = 0
    })

    test("can set offset", async ({ page }) => {
        await wakeCursor(page)
        await page.mouse.move(200, 200)
        await page.waitForTimeout(200)

        const boundingBox = await page.getByTestId("follow").boundingBox()

        expect(boundingBox).not.toBeNull()
        expect(boundingBox?.x).toBe(100) // 200 - 100 (offset.x) = 100
        expect(boundingBox?.y).toBe(100) // 200 - 100 (offset.y) = 100
    })

    test("maintains child element size", async ({ page }) => {
        await wakeCursor(page)
        await page.waitForTimeout(200)

        const boundingBox = await page.getByTestId("follow").boundingBox()

        expect(boundingBox).not.toBeNull()
        expect(boundingBox?.width).toBe(100) // Set in style prop
        expect(boundingBox?.height).toBe(100) // Set in style prop
    })

    test("scales down on press", async ({ page }) => {
        await wakeCursor(page)
        await page.mouse.move(100, 100)
        await page.waitForTimeout(200)

        const initialBoundingBox = await page
            .getByTestId("cursor")
            .boundingBox()
        expect(initialBoundingBox).not.toBeNull()
        const initialWidth = initialBoundingBox!.width
        const initialHeight = initialBoundingBox!.height

        await page.mouse.down()
        await page.waitForTimeout(200)

        const pressedBoundingBox = await page
            .getByTestId("cursor")
            .boundingBox()
        expect(pressedBoundingBox).not.toBeNull()
        expect(pressedBoundingBox!.width).toBe(initialWidth * 0.5)
        expect(pressedBoundingBox!.height).toBe(initialHeight * 0.5)
    })
})

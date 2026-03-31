import { expect, Page, test } from "@playwright/test"

async function wakeCursor(page: Page, x = 100, y = 100) {
    await page.waitForTimeout(30)
    await page.mouse.move(x, y)
    await page.waitForTimeout(30)
    await page.mouse.move(x + 1, y + 1)
}

test.beforeEach(async ({ page, browserName }) => {
    test.skip(browserName !== "webkit", "Flaky in WebKit")
    await page.goto("/tests/CursorMagnetic")
})

test.describe("Cursor magnetic", () => {
    test("cursor matches button size when hovering", async ({ page }) => {
        await wakeCursor(page)

        // Get button dimensions first
        const button = await page.getByTestId("pointer-target")
        const buttonBox = await button.boundingBox()
        expect(buttonBox).not.toBeNull()

        // Move to center of button
        await page.mouse.move(
            buttonBox!.x + buttonBox!.width / 2,
            buttonBox!.y + buttonBox!.height / 2
        )
        await page.waitForTimeout(200)

        // Check cursor dimensions match button + padding
        const cursor = await page.getByTestId("cursor")
        const cursorBox = await cursor.boundingBox()
        expect(cursorBox).not.toBeNull()

        const buttonWidth = buttonBox!.width + 10
        const buttonHeight = buttonBox!.height + 10
        expect(Math.round(cursorBox!.width)).toBe(Math.round(buttonWidth))
        expect(Math.round(cursorBox!.height)).toBe(Math.round(buttonHeight))
    })

    test("cursor does't match button size when morph is 0", async ({
        page,
    }) => {
        await wakeCursor(page)

        // Get button dimensions first
        const button = await page.getByTestId("pointer-target")
        const buttonBox = await button.boundingBox()
        expect(buttonBox).not.toBeNull()

        // Move to center of button
        await page.mouse.move(
            buttonBox!.x + buttonBox!.width / 2,
            buttonBox!.y + buttonBox!.height / 2
        )
        await page.waitForTimeout(200)

        // Check cursor dimensions match button + padding
        const cursor = await page.getByTestId("cursor-disable-morph")
        const cursorBox = await cursor.boundingBox()
        expect(cursorBox).not.toBeNull()

        expect(Math.round(cursorBox!.width)).toBe(Math.round(31))
        expect(Math.round(cursorBox!.height)).toBe(Math.round(31))
    })

    test("cursor matches button size plus padding", async ({ page }) => {
        await wakeCursor(page)

        // Get button dimensions first
        const button = await page.getByTestId("pointer-target")
        const buttonBox = await button.boundingBox()
        expect(buttonBox).not.toBeNull()

        // Move to center of button
        await page.mouse.move(
            buttonBox!.x + buttonBox!.width / 2,
            buttonBox!.y + buttonBox!.height / 2
        )
        await page.waitForTimeout(200)

        // Check cursor dimensions match button + padding
        const cursor = await page.getByTestId("cursor-add-padding")
        const cursorBox = await cursor.boundingBox()
        expect(cursorBox).not.toBeNull()

        // Button has padding 10px, so total size should match that
        const buttonWidth = buttonBox!.width + 20
        const buttonHeight = buttonBox!.height + 20
        expect(Math.round(cursorBox!.width)).toBe(Math.round(buttonWidth))
        expect(Math.round(cursorBox!.height)).toBe(Math.round(buttonHeight))
    })

    test("cursor centers over pointer when pull is 0, padding 0", async ({
        page,
    }) => {
        await wakeCursor(page)

        // Get button dimensions first
        const button = await page.getByTestId("pointer-target")
        const buttonBox = await button.boundingBox()
        expect(buttonBox).not.toBeNull()

        // Move halfway between center and right edge
        const centerX = buttonBox!.x + buttonBox!.width / 2
        const rightX = buttonBox!.x + buttonBox!.width
        await page.mouse.move(
            centerX + (rightX - centerX) / 2, // Halfway between center and right edge
            buttonBox!.y + buttonBox!.height / 2
        )
        await page.waitForTimeout(800)

        // Check cursor dimensions match button + padding
        const cursor = await page.getByTestId("cursor-no-padding")
        const cursorBox = await cursor.boundingBox()
        expect(cursorBox).not.toBeNull()

        // Button dimensions should match exactly
        expect(Math.round(cursorBox!.width)).toBe(Math.round(buttonBox!.width))
        expect(Math.round(cursorBox!.height)).toBe(
            Math.round(buttonBox!.height)
        )

        // Cursor should be centered over pointer since pull is 0
        const pointerX = centerX + (rightX - centerX) / 2
        expect(Math.round(cursorBox!.x + cursorBox!.width / 2)).toBe(
            Math.round(pointerX)
        )
        expect(Math.round(cursorBox!.y + cursorBox!.height / 2)).toBe(
            Math.round(buttonBox!.y + buttonBox!.height / 2)
        )
    })
})

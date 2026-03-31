import { test, expect, Page, Locator } from "@playwright/test"

test.beforeEach(async ({ page }) => {
    await page.goto("/tests/CursorUseCursorState")
})

async function expectCursorState(
    page: Page,
    element: Locator,
    expectedCursorType: string,
    expectedIsPressed: string = "Yes",
    skipClick = false
) {
    const cursorType = page.getByTestId("cursor-type")
    const isPressed = page.getByTestId("is-pressed")

    await element.hover()

    await expect(cursorType).toHaveText(expectedCursorType)
    await expect(isPressed).toHaveText("No")

    if (skipClick) return

    await page.mouse.down()

    await expect(cursorType).toHaveText(expectedCursorType)
    await expect(isPressed).toHaveText(expectedIsPressed)

    await page.mouse.up()

    await expect(cursorType).toHaveText(expectedCursorType)
    await expect(isPressed).toHaveText("No")
}

test.describe("useCursorState", () => {
    test("default cursor state is correct", async ({ page }) => {
        await expect(page.getByTestId("cursor-type")).toHaveText("default")
        await expect(page.getByTestId("is-pressed")).toHaveText("No")
    })

    test(`input[type="button"] state is correct`, async ({ page }) => {
        const button = page.getByTestId("input-button")

        await expectCursorState(page, button, "pointer")
    })

    test(`button state is correct`, async ({ page }) => {
        const button = page.getByTestId("button")

        await expectCursorState(page, button, "pointer")
    })

    test(`button state with span child is correct`, async ({ page }) => {
        const span = page.getByTestId("button-span")

        await expectCursorState(page, span, "pointer")
    })

    test(`button with data-cursor ancestor state is correct`, async ({
        page,
    }) => {
        const button = page.getByTestId("button-data-ancestor")

        await expectCursorState(page, button, "text")
    })

    test(`button with data-cursor state is correct`, async ({ page }) => {
        const button = page.getByTestId("button-data")

        await expectCursorState(page, button, "text")
    })

    test(`input[type="text"] state is correct`, async ({ page }) => {
        const input = page.getByTestId("input-text")

        await expectCursorState(page, input, "text")
    })

    test(`input[type="text"] disabled state is correct`, async ({ page }) => {
        const input = page.getByTestId("input-text-disabled")

        await expectCursorState(page, input, "default")
    })

    test(`textarea state is correct`, async ({ page }) => {
        const textarea = page.getByTestId("textarea")

        await expectCursorState(page, textarea, "text")
    })

    test(`textarea disabled state is correct`, async ({ page }) => {
        const textarea = page.getByTestId("textarea-disabled")

        await expectCursorState(page, textarea, "default")
    })

    test(`a state is correct`, async ({ page }) => {
        const a = page.getByTestId("a")

        await expectCursorState(page, a, "pointer", "No", true)
    })

    test(`a child state is correct`, async ({ page }) => {
        const a = page.getByTestId("a-div")

        await expectCursorState(page, a, "pointer", "No", true)
    })

    test(`p state is correct`, async ({ page }) => {
        const p = page.getByTestId("p")

        await expectCursorState(page, p, "text")
    })

    test(`p userSelect: none state is correct`, async ({
        page,
        browserName,
    }) => {
        test.skip(
            browserName !== "chromium",
            "user-select only available in Chrome"
        )

        const p = page.getByTestId("p-user-select-none")

        await expectCursorState(page, p, "default")
    })
})

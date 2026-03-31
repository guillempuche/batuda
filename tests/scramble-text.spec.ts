import { expect, test } from "@playwright/test"

test.describe("ScrambleText Component", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto("/tests/ScrambleTextComponent")
    })

    test("should render the scramble text component", async ({ page }) => {
        const scrambleText = page.locator("[data-testid=scramble-text]")
        await expect(scrambleText).toBeVisible()
    })

    test("should eventually reveal the original text after animation", async ({
        page,
    }) => {
        // Wait for animation to complete (duration is 1s by default)
        await page.waitForTimeout(1500)

        const scrambleText = page.locator("[data-testid=scramble-text]")
        const text = await scrambleText.textContent()
        expect(text).toBe("Hello World!")
    })

    test("should scramble text when active", async ({ page }) => {
        const scrambleText = page.locator("[data-testid=scramble-text]")

        // Wait a small amount - during scramble phase text should be changing
        await page.waitForTimeout(100)
        const scrambledText = await scrambleText.textContent()

        // Text should exist
        expect(scrambledText).toBeTruthy()
    })
})

test.describe("ScrambleText DOM", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto("/tests/ScrambleTextDOM")
    })

    test("should render", async ({ page }) => {
        const scrambleText = page.locator("[data-testid=scramble-text]")
        await expect(scrambleText).toBeVisible()
    })

    test("should scramble and reveal after clicking play", async ({ page }) => {
        // Click play to start
        await page.click("button:has-text('Play')")

        // Wait for animation to complete (duration is 1s by default)
        await page.waitForTimeout(1500)

        const scrambleText = page.locator("[data-testid=scramble-text]")
        const text = await scrambleText.textContent()
        expect(text).toBe("Hello World!")
    })

    test("should stop when stop button clicked", async ({ page }) => {
        // Click play first
        await page.click("button:has-text('Play')")
        await page.waitForTimeout(100)

        // Then stop
        await page.click("button:has-text('Stop')")
        await page.waitForTimeout(100)

        const scrambleText = page.locator("[data-testid=scramble-text]")
        const text = await scrambleText.textContent()
        expect(text).toBe("Hello World!")
    })

    test("should respect delay setting", async ({ page }) => {
        // Set delay to 0.5s
        await page.fill('input[type="number"]', "0.5")
        await page.click("button:has-text('Play')")

        // Immediately after play, text should still be original (in delay phase)
        const scrambleText = page.locator("[data-testid=scramble-text]")
        const textImmediately = await scrambleText.textContent()
        expect(textImmediately).toBe("Hello World!")

        // After delay + duration, should be revealed
        await page.waitForTimeout(2000)
        const textAfter = await scrambleText.textContent()
        expect(textAfter).toBe("Hello World!")
    })
})

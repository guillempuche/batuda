import { expect, test } from "@playwright/test"

test("AnimateNumber renders and displays correct aria-label", async ({
    page,
}) => {
    await page.goto("/tests/NumberBasic")

    const basic = page.locator("#number-basic")
    await expect(basic).toBeVisible()

    // Check the aria-label on the inner span
    const ariaLabel = basic.locator("[aria-label]")
    await expect(ariaLabel).toHaveAttribute("aria-label", "5")
})

test("AnimateNumber updates aria-label when value changes", async ({
    page,
}) => {
    await page.goto("/tests/NumberBasic")

    await page.locator("#set-42").click()

    const ariaLabel = page.locator("#number-basic [aria-label]")
    await expect(ariaLabel).toHaveAttribute("aria-label", "42")
})

test("AnimateNumber renders currency format", async ({ page }) => {
    await page.goto("/tests/NumberBasic")

    const ariaLabel = page.locator("#number-currency [aria-label]")
    await expect(ariaLabel).toHaveAttribute("aria-label", "$5.00")

    await page.locator("#set-1000").click()
    await expect(ariaLabel).toHaveAttribute("aria-label", "$1,000.00")
})

test("AnimateNumber renders prefix and suffix", async ({ page }) => {
    await page.goto("/tests/NumberBasic")

    const ariaLabel = page.locator("#number-suffix [aria-label]")
    const label = await ariaLabel.getAttribute("aria-label")
    expect(label).toContain("~")
    expect(label).toContain("/mo")
})

test("AnimateNumber integer section grows when digit count increases", async ({
    page,
}) => {
    await page.goto("/tests/NumberBasic")

    // Measure the inner content span (aria-label span wraps all sections)
    const content = page.locator("#number-basic [aria-label]")
    const initialBox = await content.boundingBox()
    expect(initialBox).not.toBeNull()

    // Change from 5 to 42 (1 digit to 2 digits)
    await page.locator("#set-42").click()

    // Wait for width animation to settle
    await page.waitForTimeout(600)

    const afterBox = await content.boundingBox()
    expect(afterBox).not.toBeNull()
    // 42 should be wider than 5
    expect(afterBox!.width).toBeGreaterThan(initialBox!.width)
})

test("AnimateNumber handles large number transitions", async ({ page }) => {
    await page.goto("/tests/NumberBasic")

    // Go from 5 to 1000
    await page.locator("#set-1000").click()

    const ariaLabel = page.locator("#number-basic [aria-label]")
    await expect(ariaLabel).toHaveAttribute("aria-label", "1,000")

    // Wait for animations
    await page.waitForTimeout(600)

    // Go back to 0
    await page.locator("#set-0").click()
    await expect(ariaLabel).toHaveAttribute("aria-label", "0")
})

test("AnimateNumber with trend prop renders without error", async ({
    page,
}) => {
    await page.goto("/tests/NumberBasic")

    // Both trend variants should be visible
    await expect(page.locator("#number-trend-up")).toBeVisible()
    await expect(page.locator("#number-trend-down")).toBeVisible()

    // Change value and verify labels update
    await page.locator("#set-9").click()

    const upLabel = page.locator("#number-trend-up [aria-label]")
    await expect(upLabel).toHaveAttribute("aria-label", "9")

    const downLabel = page.locator("#number-trend-down [aria-label]")
    await expect(downLabel).toHaveAttribute("aria-label", "9")
})

test("AnimateNumber integer section shrinks when digit count decreases", async ({
    page,
}) => {
    await page.goto("/tests/NumberBasic")

    // Measure the inner content span
    const content = page.locator("#number-basic [aria-label]")

    // Start at 5, go to 1000 first
    await page.locator("#set-1000").click()
    await page.waitForTimeout(600)

    const wideBox = await content.boundingBox()
    expect(wideBox).not.toBeNull()

    // Now go back to 5
    await page.locator("#set-5").click()
    await page.waitForTimeout(600)

    const narrowBox = await content.boundingBox()
    expect(narrowBox).not.toBeNull()

    // Should be narrower again
    expect(narrowBox!.width).toBeLessThan(wideBox!.width)
})

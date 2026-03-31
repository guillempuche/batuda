import { expect, test } from "@playwright/test"

test("Typewriter", async ({ page }) => {
    // Navigate to the page with Typewriter component
    await page.goto("/tests/TypewriterBasic")

    // Wait 200ms for initial animation to start
    await page.waitForTimeout(200)

    // Press #play checkbox to pause the animation
    await page.locator("#play").click()

    // Wait 200ms
    await page.waitForTimeout(50)

    // Check #typewriter span for text content
    const typewriterSpan = page.locator("#typewriter > span").first()
    const initialTextContent = await typewriterSpan.textContent()
    expect(initialTextContent).toBeTruthy()
    expect(initialTextContent).not.toBe("")

    // Wait 200ms
    await page.waitForTimeout(200)

    // Check text content to see that it's the same (and not "")
    const pausedTextContent = await typewriterSpan.textContent()
    expect(pausedTextContent).toBe(initialTextContent)
    expect(pausedTextContent).not.toBe("")

    // Press #play checkbox to resume the animation
    await page.locator("#play").click()

    // Wait 200ms
    await page.waitForTimeout(200)

    // Check animation has resumed and text content is not the same
    const resumedTextContent = await typewriterSpan.textContent()
    expect(resumedTextContent).not.toBe(pausedTextContent)
})

test("Typewriter smart backspace", async ({ page }) => {
    // Navigate to the page with Typewriter component
    await page.goto("/tests/TypewriterBasic")

    // Wait for initial typing to start
    await page.waitForTimeout(300)

    // Get the typewriter span for checking content
    const typewriterSpan = page.locator("#typewriter > span").first()

    // Wait until some text is typed (should be "Hello world! This is a typewriter effect.")
    await page.waitForFunction(
        () => {
            const span = document.querySelector(
                "#typewriter > span"
            ) as HTMLElement
            return span && span.textContent && span.textContent.length > 5
        },
        undefined,
        { timeout: 3000 }
    )

    // Change text to "Hello universe" to test smart backspace
    await page.click('button:has-text("Hello universe")')

    // Wait a bit for the backspace animation to start
    await page.waitForTimeout(200)

    // Check that the text eventually becomes "Hello universe"
    await page.waitForFunction(
        () => {
            const span = document.querySelector(
                "#typewriter > span"
            ) as HTMLElement
            return span && span.textContent === "Hello universe"
        },
        undefined,
        { timeout: 5000 }
    )

    const finalText = await typewriterSpan.textContent()
    expect(finalText).toBe("Hello universe")
})

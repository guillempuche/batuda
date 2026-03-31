import { expect, test } from "@playwright/test"

test.describe("Carousel", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto("/tests/Carousel")
        await page.waitForTimeout(200) // Wait for carousel to initialize
    })

    test("Carousel clones 1 item correctly", async ({ page }) => {
        const ul = page.locator("#one-item ul")
        const firstItem = page.locator("#one-item ul li:first-child")

        // Check that the ul has translateX of -110px (100px width + 10px default gap)
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, -110, 0)")

        // Check that the first item has translateX of 660px
        await expect(firstItem).toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, 660, 0)"
        )

        // Check that there are 6 li children in total
        await expect(page.locator("#one-item ul li")).toHaveCount(6)
    })

    test("Carousel goes next with one item correctly", async ({ page }) => {
        const ul = page.locator("#one-item ul")

        // Test navigation with next button
        await page.click("#one-item .next")
        await page.waitForTimeout(50) // Wait for animation
        // Check is animating
        await expect(ul).not.toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, -110, 0)"
        )
        await page.waitForTimeout(250) // Wait for animation

        // After clicking next, position should change
        // Note: -110 is the initial position, so it should be the same as theres only one item
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, -110, 0)")
    })

    test("Carousel goes prev with one item correctly", async ({ page }) => {
        const ul = page.locator("#one-item ul")

        // Test navigation with prev button
        await page.click("#one-item .prev")
        await page.waitForTimeout(50) // Wait for animation
        // Check is animating
        await expect(ul).not.toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, -110, 0)"
        )
        await page.waitForTimeout(250) // Wait for animation

        // After clicking next, position should change
        // Note: -110 is the initial position, so it should be the same as theres only one item
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, -110, 0)")
    })

    test("Carousel clones 2 items correctly", async ({ page }) => {
        const ul = page.locator("#two-items ul")
        const firstItem = page.locator("#two-items ul li:first-child")

        // Check that the ul has translateX of -110px (100px width + 10px default gap)
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, -220, 0)")

        // Check that the first item has translateX of 660px
        await expect(firstItem).toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, 660, 0)"
        )

        // Check that there are 6 li children in total
        await expect(page.locator("#two-items ul li")).toHaveCount(6)
    })

    test("Carousel goes next with two items correctly", async ({ page }) => {
        const ul = page.locator("#two-items ul")

        // Test navigation with next button
        await page.click("#two-items .next")
        await page.waitForTimeout(50) // Wait for animation
        // Check is animating
        await expect(ul).not.toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, -220, 0)"
        )
        await page.waitForTimeout(250) // Wait for animation

        // After clicking next, position should change
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, -220, 0)")
    })

    test("Carousel goes prev with two items correctly", async ({ page }) => {
        const ul = page.locator("#two-items ul")

        // Test navigation with prev button
        await page.click("#two-items .prev")
        await page.waitForTimeout(50) // Wait for animation
        // Check is animating
        await expect(ul).not.toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, -220, 0)"
        )
        await page.waitForTimeout(400) // Wait for animation

        // After clicking next, position should change
        // Note: -110 is the initial position, so it should be the same as theres only one item
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, -220, 0)")
    })

    test("Carousel clones 12 items correctly", async ({ page }) => {
        const ul = page.locator("#twelve-items ul")
        const firstItem = page.locator("#twelve-items ul li:first-child")

        // Check that the ul has translateX of -1430px
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, -1430, 0)")

        // Check that the first item has translateX of 1430px
        await expect(firstItem).toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, 1430, 0)"
        )

        // Check that there are 12 li children in total
        await expect(page.locator("#twelve-items ul li")).toHaveCount(13)
    })

    test("Carousel goes next with 12 items correctly, pagination works", async ({
        page,
    }) => {
        const ul = page.locator("#twelve-items ul")

        // Test navigation with next button
        await page.click("#twelve-items .next")
        await page.waitForTimeout(50) // Wait for animation
        // Check is animating
        await expect(ul).not.toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, -440, 0)"
        )
        await page.waitForTimeout(250) // Wait for animation

        // After clicking next, position should change
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, -440, 0)")
        const dots = page.locator("#twelve-items .dot")
        await expect(dots).toHaveCount(4)
        await expect(dots.nth(0)).toHaveCSS(
            "background-color",
            "rgba(255, 255, 255, 0.5)"
        )
        await expect(dots.nth(1)).toHaveCSS(
            "background-color",
            "rgb(255, 255, 255)"
        )
        await expect(dots.nth(2)).toHaveCSS(
            "background-color",
            "rgba(255, 255, 255, 0.5)"
        )
        await expect(dots.nth(3)).toHaveCSS(
            "background-color",
            "rgba(255, 255, 255, 0.5)"
        )
    })

    test("Carousel goes prev with 12 items correctly", async ({ page }) => {
        const ul = page.locator("#twelve-items ul")

        // Test navigation with next button
        await page.click("#twelve-items .prev")
        await page.waitForTimeout(50) // Wait for animation
        // Check is animating
        await expect(ul).not.toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, -990, 0)"
        )
        await page.waitForTimeout(250) // Wait for animation

        // After clicking next, position should change
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, -990, 0)")
        const dots = page.locator("#twelve-items .dot")
        await expect(dots).toHaveCount(4)
        await expect(dots.nth(0)).toHaveCSS(
            "background-color",
            "rgba(255, 255, 255, 0.5)"
        )
        await expect(dots.nth(1)).toHaveCSS(
            "background-color",
            "rgba(255, 255, 255, 0.5)"
        )
        await expect(dots.nth(2)).toHaveCSS(
            "background-color",
            "rgb(255, 255, 255)"
        )
        await expect(dots.nth(3)).toHaveCSS(
            "background-color",
            "rgba(255, 255, 255, 0.5)"
        )
    })

    test("Carousel works with goto actions, page 2", async ({ page }) => {
        const ul = page.locator("#twelve-items ul")
        const dots = page.locator("#twelve-items .dot")
        await expect(dots).toHaveCount(4)
        await expect(dots.nth(0)).toHaveCSS(
            "background-color",
            "rgb(255, 255, 255)"
        )

        await page.click("#twelve-items .dot:nth-child(3)")
        await page.waitForTimeout(50) // Wait for animation
        // Check is animating
        await expect(ul).not.toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, -880, 0)"
        )
        await page.waitForTimeout(250) // Wait for animation

        // After clicking next, position should change
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, -880, 0)")
    })

    test("Carousel correctly interrupts pagination with second next command", async ({
        page,
    }) => {
        const ul = page.locator("#twelve-items ul")

        // Test navigation with next button
        await page.click("#twelve-items .next")
        await page.waitForTimeout(50) // Wait for animation
        await page.click("#twelve-items .next")
        // Check is animating
        await expect(ul).not.toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, -880, 0)"
        )
        await page.waitForTimeout(300) // Wait for animation

        // After clicking next, position should change
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, -880, 0)")
        const dots = page.locator("#twelve-items .dot")
        await expect(dots).toHaveCount(4)
        await expect(dots.nth(0)).toHaveCSS(
            "background-color",
            "rgba(255, 255, 255, 0.5)"
        )
        await expect(dots.nth(1)).toHaveCSS(
            "background-color",
            "rgba(255, 255, 255, 0.5)"
        )
        await expect(dots.nth(2)).toHaveCSS(
            "background-color",
            "rgb(255, 255, 255)"
        )
        await expect(dots.nth(3)).toHaveCSS(
            "background-color",
            "rgba(255, 255, 255, 0.5)"
        )
    })

    test("Carousel loops correctly", async ({ page }) => {
        const ul = page.locator("#twelve-items ul")

        // Test navigation with next button
        await page.click("#twelve-items .next")
        await page.waitForTimeout(50) // Wait for animation
        await page.click("#twelve-items .next")
        await page.waitForTimeout(50) // Wait for animation
        await page.click("#twelve-items .next")
        await page.waitForTimeout(50) // Wait for animation
        await page.click("#twelve-items .next")
        // Check is animating
        await expect(ul).not.toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, -330, 0)"
        )
        await page.waitForTimeout(300) // Wait for animation

        // After clicking next, position should change
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, -330, 0)")
        const dots = page.locator("#twelve-items .dot")
        await expect(dots).toHaveCount(4)
        await expect(dots.nth(0)).toHaveCSS(
            "background-color",
            "rgba(255, 255, 255, 0.5)"
        )
        await expect(dots.nth(1)).toHaveCSS(
            "background-color",
            "rgb(255, 255, 255)"
        )
        await expect(dots.nth(2)).toHaveCSS(
            "background-color",
            "rgba(255, 255, 255, 0.5)"
        )
        await expect(dots.nth(3)).toHaveCSS(
            "background-color",
            "rgba(255, 255, 255, 0.5)"
        )
    })

    test("Carousel dots change from 4 to 5 when resize button is clicked", async ({
        page,
    }) => {
        // Initially check that there are 4 dots
        const dots = page.locator("#twelve-items .dot")
        await expect(dots).toHaveCount(4)

        // Click the resize button
        await page.click("#size")
        await page.waitForTimeout(100) // Wait for resize to take effect

        // Check that there are now 5 dots
        await expect(dots).toHaveCount(5)
    })

    test("Carousel wheel scroll works correctly with deltaX 200", async ({
        page,
    }) => {
        const ul = page.locator("#twelve-items ul")

        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, -1430, 0)")

        // Apply wheel scroll with deltaX 200
        await ul.dispatchEvent("wheel", { deltaX: 20 })
        await page.waitForTimeout(250) // Wait for animation

        // Check that it scrolled by the delta amount
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, -20, 0)")
    })

    test("Carousel goes next with 12 items correctly and can be interrupted by wheel scroll", async ({
        page,
    }) => {
        const ul = page.locator("#twelve-items ul")

        // Test navigation with next button
        await page.click("#twelve-items .next")
        await page.waitForTimeout(50) // Wait for animation
        // Check is animating
        await expect(ul).not.toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, -440, 0)"
        )

        // Interrupt animation with wheel scroll
        await ul.dispatchEvent("wheel", { deltaX: 20 })
        await page.waitForTimeout(50)
        // Check that animation is no longer running - final position should be stable
        const finalTransform = await ul.evaluate(
            (el) => getComputedStyle(el).transform
        )
        await page.waitForTimeout(50) // Wait a bit more
        const finalTransform2 = await ul.evaluate(
            (el) => getComputedStyle(el).transform
        )
        // The transform should be stable (not changing)
        expect(finalTransform).toBe(finalTransform2)
    })
})

test.describe("Carousel: RTL", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto("/tests/CarouselRTL")
        await page.waitForTimeout(200) // Wait for carousel to initialize
    })

    test("Carousel clones 1 item correctly", async ({ page }) => {
        const ul = page.locator("#one-item ul")
        const firstItem = page.locator("#one-item ul li:first-child")

        // Check that the ul has translateX of -110px (100px width + 10px default gap)
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, 110, 0)")

        // Check that the first item has translateX of 660px
        await expect(firstItem).toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, -660, 0)"
        )

        // Check that there are 6 li children in total
        await expect(page.locator("#one-item ul li")).toHaveCount(6)
    })

    test("Carousel goes next with one item correctly", async ({ page }) => {
        const ul = page.locator("#one-item ul")

        // Test navigation with next button
        await page.click("#one-item .next")
        await page.waitForTimeout(50) // Wait for animation
        // Check is animating
        await expect(ul).not.toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, 110, 0)"
        )
        await page.waitForTimeout(250) // Wait for animation

        // After clicking next, position should change
        // Note: -110 is the initial position, so it should be the same as theres only one item
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, 110, 0)")
    })

    test("Carousel goes prev with one item correctly", async ({ page }) => {
        const ul = page.locator("#one-item ul")

        // Test navigation with prev button
        await page.click("#one-item .prev")
        await page.waitForTimeout(50) // Wait for animation
        // Check is animating
        await expect(ul).not.toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, 110, 0)"
        )
        await page.waitForTimeout(250) // Wait for animation

        // After clicking next, position should change
        // Note: -110 is the initial position, so it should be the same as theres only one item
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, 110, 0)")
    })

    test("Carousel clones 2 items correctly", async ({ page }) => {
        const ul = page.locator("#two-items ul")
        const firstItem = page.locator("#two-items ul li:first-child")

        // Check that the ul has translateX of -110px (100px width + 10px default gap)
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, 220, 0)")

        // Check that the first item has translateX of 660px
        await expect(firstItem).toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, -660, 0)"
        )

        // Check that there are 6 li children in total
        await expect(page.locator("#two-items ul li")).toHaveCount(6)
    })

    test("Carousel goes next with two items correctly", async ({ page }) => {
        const ul = page.locator("#two-items ul")

        // Test navigation with next button
        await page.click("#two-items .next")
        await page.waitForTimeout(50) // Wait for animation
        // Check is animating
        await expect(ul).not.toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, 220, 0)"
        )
        await page.waitForTimeout(250) // Wait for animation

        // After clicking next, position should change
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, 220, 0)")
    })

    test("Carousel goes prev with two items correctly", async ({ page }) => {
        const ul = page.locator("#two-items ul")

        // Test navigation with prev button
        await page.click("#two-items .prev")
        await page.waitForTimeout(50) // Wait for animation
        // Check is animating
        await expect(ul).not.toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, 220, 0)"
        )
        await page.waitForTimeout(400) // Wait for animation

        // After clicking next, position should change
        // Note: -110 is the initial position, so it should be the same as theres only one item
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, 220, 0)")
    })

    test("Carousel clones 12 items correctly", async ({ page }) => {
        const ul = page.locator("#twelve-items ul")
        const firstItem = page.locator("#twelve-items ul li:first-child")

        // Check that the ul has translateX of -1430px
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, 1430, 0)")

        // Check that the first item has translateX of 1430px
        await expect(firstItem).toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, -1430, 0)"
        )

        // Check that there are 12 li children in total
        await expect(page.locator("#twelve-items ul li")).toHaveCount(13)
    })

    test("Carousel goes next with 12 items correctly, pagination works", async ({
        page,
    }) => {
        const ul = page.locator("#twelve-items ul")

        await expect(page.locator("#twelve-items .prev")).toHaveCSS(
            "opacity",
            "1"
        )

        // Test navigation with next button
        await page.click("#twelve-items .next")
        await page.waitForTimeout(50) // Wait for animation
        // Check is animating
        await expect(ul).not.toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, 440, 0)"
        )
        await page.waitForTimeout(250) // Wait for animation

        // After clicking next, position should change
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, 440, 0)")
        const dots = page.locator("#twelve-items .dot")
        await expect(dots).toHaveCount(4)
        await expect(dots.nth(0)).toHaveCSS(
            "background-color",
            "rgba(255, 255, 255, 0.5)"
        )
        await expect(dots.nth(1)).toHaveCSS(
            "background-color",
            "rgb(255, 255, 255)"
        )
        await expect(dots.nth(2)).toHaveCSS(
            "background-color",
            "rgba(255, 255, 255, 0.5)"
        )
        await expect(dots.nth(3)).toHaveCSS(
            "background-color",
            "rgba(255, 255, 255, 0.5)"
        )

        await expect(page.locator("#twelve-items .prev")).toHaveCSS(
            "opacity",
            "1"
        )
    })
    test("Carousel goes next with 12 items correctly, pagination works, loop disabled", async ({
        page,
    }) => {
        const ul = page.locator("#loop-disabled ul")

        await expect(page.locator("#loop-disabled .prev")).toHaveCSS(
            "opacity",
            "0.5"
        )

        // Test navigation with next button
        await page.click("#loop-disabled .next")
        await page.waitForTimeout(50) // Wait for animation
        // Check is animating
        await expect(ul).not.toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, 330, 0)"
        )
        await page.waitForTimeout(250) // Wait for animation

        // After clicking next, position should change
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, 330, 0)")
        const dots = page.locator("#loop-disabled .dot")
        await expect(dots).toHaveCount(4)
        await expect(dots.nth(0)).toHaveCSS(
            "background-color",
            "rgba(255, 255, 255, 0.5)"
        )
        await expect(dots.nth(1)).toHaveCSS(
            "background-color",
            "rgb(255, 255, 255)"
        )
        await expect(dots.nth(2)).toHaveCSS(
            "background-color",
            "rgba(255, 255, 255, 0.5)"
        )
        await expect(dots.nth(3)).toHaveCSS(
            "background-color",
            "rgba(255, 255, 255, 0.5)"
        )

        await expect(page.locator("#loop-disabled .prev")).toHaveCSS(
            "opacity",
            "1"
        )
    })

    test("Carousel goes prev with 12 items correctly", async ({ page }) => {
        const ul = page.locator("#twelve-items ul")

        await page.click("#twelve-items .next")
        await page.waitForTimeout(300) // Wait for animation

        // Test navigation with next button
        await page.click("#twelve-items .prev")
        await page.waitForTimeout(50) // Wait for animation
        // Check is animating
        await expect(ul).not.toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, 1430, 0)"
        )
        await page.waitForTimeout(250) // Wait for animation

        // After clicking next, position should change
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, 1430, 0)")
        const dots = page.locator("#twelve-items .dot")
        await expect(dots).toHaveCount(4)
        await expect(dots.nth(0)).toHaveCSS(
            "background-color",
            "rgb(255, 255, 255)"
        )
        await expect(dots.nth(1)).toHaveCSS(
            "background-color",
            "rgba(255, 255, 255, 0.5)"
        )
        await expect(dots.nth(2)).toHaveCSS(
            "background-color",
            "rgba(255, 255, 255, 0.5)"
        )
        await expect(dots.nth(3)).toHaveCSS(
            "background-color",
            "rgba(255, 255, 255, 0.5)"
        )
    })

    test("Carousel goes prev with 12 items correctly, loop disabled", async ({
        page,
    }) => {
        const ul = page.locator("#loop-disabled ul")

        await page.click("#loop-disabled .next")
        await page.waitForTimeout(300) // Wait for animation

        // Test navigation with prev button
        await page.click("#loop-disabled .prev")
        await page.waitForTimeout(50) // Wait for animation
        // Check is animating
        await expect(ul).not.toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, 330, 0)"
        )
        await page.waitForTimeout(250) // Wait for animation

        // After clicking next, position should change
        await expect(ul).toHaveCSS("transform", "none")
        const dots = page.locator("#loop-disabled .dot")
        await expect(dots).toHaveCount(4)
        await expect(dots.nth(0)).toHaveCSS(
            "background-color",
            "rgb(255, 255, 255)"
        )
        await expect(dots.nth(1)).toHaveCSS(
            "background-color",
            "rgba(255, 255, 255, 0.5)"
        )
        await expect(dots.nth(2)).toHaveCSS(
            "background-color",
            "rgba(255, 255, 255, 0.5)"
        )
        await expect(dots.nth(3)).toHaveCSS(
            "background-color",
            "rgba(255, 255, 255, 0.5)"
        )

        await expect(page.locator("#loop-disabled .prev")).toHaveCSS(
            "opacity",
            "0.5"
        )
    })

    test("Carousel goes disables next correctly, loop disabled", async ({
        page,
    }) => {
        const ul = page.locator("#loop-disabled ul")

        await page.click("#loop-disabled .next")
        await page.waitForTimeout(50)
        await page.click("#loop-disabled .next")
        await page.waitForTimeout(50)
        await page.click("#loop-disabled .next")
        await page.waitForTimeout(50)
        await page.click("#loop-disabled .next")
        await page.waitForTimeout(50)

        await expect(page.locator("#loop-disabled .next")).toHaveCSS(
            "opacity",
            "0.5"
        )
    })

    test("Carousel works with goto actions, page 2", async ({ page }) => {
        const ul = page.locator("#twelve-items ul")
        const dots = page.locator("#twelve-items .dot")
        await expect(dots).toHaveCount(4)
        await expect(dots.nth(0)).toHaveCSS(
            "background-color",
            "rgb(255, 255, 255)"
        )

        await page.click("#twelve-items .dot:nth-child(3)")
        await page.waitForTimeout(50) // Wait for animation
        // Check is animating
        await expect(ul).not.toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, 880, 0)"
        )
        await page.waitForTimeout(250) // Wait for animation

        // After clicking next, position should change
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, 880, 0)")
    })

    test("Carousel correctly interrupts pagination with second next command", async ({
        page,
    }) => {
        const ul = page.locator("#twelve-items ul")

        // Test navigation with next button
        await page.click("#twelve-items .next")
        await page.waitForTimeout(50) // Wait for animation
        await page.click("#twelve-items .next")
        // Check is animating
        await expect(ul).not.toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, 880, 0)"
        )
        await page.waitForTimeout(300) // Wait for animation

        // After clicking next, position should change
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, 880, 0)")
        const dots = page.locator("#twelve-items .dot")
        await expect(dots).toHaveCount(4)
        await expect(dots.nth(0)).toHaveCSS(
            "background-color",
            "rgba(255, 255, 255, 0.5)"
        )
        await expect(dots.nth(1)).toHaveCSS(
            "background-color",
            "rgba(255, 255, 255, 0.5)"
        )
        await expect(dots.nth(2)).toHaveCSS(
            "background-color",
            "rgb(255, 255, 255)"
        )
        await expect(dots.nth(3)).toHaveCSS(
            "background-color",
            "rgba(255, 255, 255, 0.5)"
        )
    })

    test("Carousel dots change from 4 to 5 when resize button is clicked", async ({
        page,
    }) => {
        // Initially check that there are 4 dots
        const dots = page.locator("#twelve-items .dot")
        await expect(dots).toHaveCount(4)

        // Click the resize button
        await page.click("#size")
        await page.waitForTimeout(100) // Wait for resize to take effect

        // Check that there are now 5 dots
        await expect(dots).toHaveCount(5)
    })

    test("Carousel wheel scroll works correctly", async ({ page }) => {
        const ul = page.locator("#twelve-items ul")

        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, 1430, 0)")

        // Apply wheel scroll with deltaX 200
        await ul.dispatchEvent("wheel", { deltaX: -20 })
        await page.waitForTimeout(250) // Wait for animation

        // Check that it scrolled by the delta amount
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, 20, 0)")
    })

    test("Carousel wheel swipe works correctly", async ({ page }) => {
        const ul = page.locator("#twelve-items ul")

        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, 1430, 0)")

        // Apply wheel scroll with deltaX 200
        await ul.dispatchEvent("wheel", { deltaX: -200 })
        await page.waitForTimeout(500) // Wait for animation

        // Check that it scrolled by the delta amount
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, 440, 0)")
        await ul.dispatchEvent("wheel", { deltaX: 200 })
        await page.waitForTimeout(500) // Wait for animation
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, 1430, 0)")
    })
})

test.describe("CarouselY", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto("/tests/CarouselY")
        await page.waitForTimeout(200) // Wait for carousel to initialize
    })

    test("CarouselY clones 1 item correctly", async ({ page }) => {
        const ul = page.locator("#one-item ul")
        const firstItem = page.locator("#one-item ul li:first-child")

        // Check that the ul has translateY of -150px (140px height + 10px default gap)
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, -150)")

        // Check that the first item has translateY of 900px
        await expect(firstItem).toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, 0, 750)"
        )

        // Check that there are 6 li children in total
        await expect(page.locator("#one-item ul li")).toHaveCount(5)
    })

    test("CarouselY goes next with one item correctly", async ({ page }) => {
        const ul = page.locator("#one-item ul")

        // Test navigation with next button
        await page.click("#one-item .next")
        await page.waitForTimeout(50) // Wait for animation
        // Check is animating
        await expect(ul).not.toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, 0, -150)"
        )
        await page.waitForTimeout(250) // Wait for animation

        // After clicking next, position should change
        // Note: -150 is the initial position, so it should be the same as theres only one item
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, -150)")
    })

    test("CarouselY goes prev with one item correctly", async ({ page }) => {
        const ul = page.locator("#one-item ul")

        // Test navigation with prev button
        await page.click("#one-item .prev")
        await page.waitForTimeout(50) // Wait for animation
        // Check is animating
        await expect(ul).not.toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, 0, -150)"
        )
        await page.waitForTimeout(250) // Wait for animation

        // After clicking prev, position should change
        // Note: -150 is the initial position, so it should be the same as theres only one item
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, -150)")
    })

    test("CarouselY clones 2 items correctly", async ({ page }) => {
        const ul = page.locator("#two-items ul")
        const firstItem = page.locator("#two-items ul li:first-child")

        // Check that the ul has translateY of -150px (140px height + 10px default gap)
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, -300)")

        // Check that the first item has translateY of 900px
        await expect(firstItem).toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, 0, 900)"
        )

        // Check that there are 6 li children in total
        await expect(page.locator("#two-items ul li")).toHaveCount(6)
    })

    test("CarouselY goes next with two items correctly", async ({ page }) => {
        const ul = page.locator("#two-items ul")

        // Test navigation with next button
        await page.click("#two-items .next")
        await page.waitForTimeout(50) // Wait for animation
        // Check is animating
        await expect(ul).not.toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, 0, -150)"
        )
        await page.waitForTimeout(250) // Wait for animation

        // After clicking next, position should change
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, -150)")
    })

    test("CarouselY goes prev with two items correctly", async ({ page }) => {
        const ul = page.locator("#two-items ul")

        // Test navigation with prev button
        await page.click("#two-items .prev")
        await page.waitForTimeout(50) // Wait for animation
        // Check is animating
        await expect(ul).not.toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, 0, -150)"
        )
        await page.waitForTimeout(250) // Wait for animation

        // After clicking prev, position should change
        // Note: -150 is the initial position, so it should be the same as theres only one item
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, -150)")
    })

    test("CarouselY clones 12 items correctly", async ({ page }) => {
        const ul = page.locator("#twelve-items ul")
        const firstItem = page.locator("#twelve-items ul li:first-child")

        // Check that the ul has translateY of -1950px
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, -1950)")

        // Check that the first item has translateY of 1950px
        await expect(firstItem).toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, 0, 1950)"
        )

        // Check that there are 12 li children in total
        await expect(page.locator("#twelve-items ul li")).toHaveCount(13)
    })

    test("CarouselY goes next with 12 items correctly, pagination works", async ({
        page,
    }) => {
        const ul = page.locator("#twelve-items ul")

        // Test navigation with next button
        await page.click("#twelve-items .next")
        await page.waitForTimeout(50) // Wait for animation
        // Check is animating
        await expect(ul).not.toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, 0, -450)"
        )
        await page.waitForTimeout(250) // Wait for animation

        // After clicking next, position should change
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, -450)")
        const dots = page.locator("#twelve-items .dot")
        await expect(dots).toHaveCount(5)
        await expect(dots.nth(0)).toHaveCSS(
            "background-color",
            "rgba(255, 255, 255, 0.5)"
        )
        await expect(dots.nth(1)).toHaveCSS(
            "background-color",
            "rgb(255, 255, 255)"
        )
        await expect(dots.nth(2)).toHaveCSS(
            "background-color",
            "rgba(255, 255, 255, 0.5)"
        )
        await expect(dots.nth(3)).toHaveCSS(
            "background-color",
            "rgba(255, 255, 255, 0.5)"
        )
    })

    test("CarouselY goes prev with 12 items correctly", async ({ page }) => {
        const ul = page.locator("#twelve-items ul")

        // Test navigation with next button
        await page.click("#twelve-items .prev")
        await page.waitForTimeout(50) // Wait for animation
        // Check is animating
        await expect(ul).not.toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, 0, -1500)"
        )
        await page.waitForTimeout(250) // Wait for animation

        // After clicking next, position should change
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, -1500)")
        const dots = page.locator("#twelve-items .dot")
        await expect(dots).toHaveCount(5)
        await expect(dots.nth(0)).toHaveCSS(
            "background-color",
            "rgba(255, 255, 255, 0.5)"
        )
        await expect(dots.nth(1)).toHaveCSS(
            "background-color",
            "rgba(255, 255, 255, 0.5)"
        )
        await expect(dots.nth(2)).toHaveCSS(
            "background-color",
            "rgba(255, 255, 255, 0.5)"
        )
        await expect(dots.nth(3)).toHaveCSS(
            "background-color",
            "rgb(255, 255, 255)"
        )
    })

    test("CarouselY works with goto actions, page 2", async ({ page }) => {
        const ul = page.locator("#twelve-items ul")
        const dots = page.locator("#twelve-items .dot")
        await expect(dots).toHaveCount(5)
        await expect(dots.nth(0)).toHaveCSS(
            "background-color",
            "rgb(255, 255, 255)"
        )

        await page.click("#twelve-items .dot:nth-child(3)")
        await page.waitForTimeout(50) // Wait for animation
        // Check is animating
        await expect(ul).not.toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, 0, -900)"
        )
        await page.waitForTimeout(250) // Wait for animation

        // After clicking next, position should change
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, -900)")
    })

    test("CarouselY correctly interrupts pagination with second next command", async ({
        page,
    }) => {
        const ul = page.locator("#twelve-items ul")

        // Test navigation with next button
        await page.click("#twelve-items .next")
        await page.waitForTimeout(50) // Wait for animation
        await page.click("#twelve-items .next")
        // Check is animating
        await expect(ul).not.toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, 0, -900)"
        )
        await page.waitForTimeout(300) // Wait for animation

        // After clicking next, position should change
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, -900)")
        const dots = page.locator("#twelve-items .dot")
        await expect(dots).toHaveCount(5)
        await expect(dots.nth(0)).toHaveCSS(
            "background-color",
            "rgba(255, 255, 255, 0.5)"
        )
        await expect(dots.nth(1)).toHaveCSS(
            "background-color",
            "rgba(255, 255, 255, 0.5)"
        )
        await expect(dots.nth(2)).toHaveCSS(
            "background-color",
            "rgb(255, 255, 255)"
        )
        await expect(dots.nth(3)).toHaveCSS(
            "background-color",
            "rgba(255, 255, 255, 0.5)"
        )
    })

    test("CarouselY loops correctly", async ({ page }) => {
        const ul = page.locator("#twelve-items ul")

        // Test navigation with next button
        await page.click("#twelve-items .next")
        await page.waitForTimeout(50) // Wait for animation
        await page.click("#twelve-items .next")
        await page.waitForTimeout(50) // Wait for animation
        await page.click("#twelve-items .next")
        await page.waitForTimeout(50) // Wait for animation
        await page.click("#twelve-items .next")
        await page.waitForTimeout(50) // Wait for animation
        await page.click("#twelve-items .next")
        // Check is animating
        await expect(ul).not.toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, 0, -300)"
        )
        await page.waitForTimeout(300) // Wait for animation

        // After clicking next, position should change
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, -300)")
        const dots = page.locator("#twelve-items .dot")
        await expect(dots).toHaveCount(5)
        await expect(dots.nth(0)).toHaveCSS(
            "background-color",
            "rgba(255, 255, 255, 0.5)"
        )
        await expect(dots.nth(1)).toHaveCSS(
            "background-color",
            "rgb(255, 255, 255)"
        )
        await expect(dots.nth(2)).toHaveCSS(
            "background-color",
            "rgba(255, 255, 255, 0.5)"
        )
        await expect(dots.nth(3)).toHaveCSS(
            "background-color",
            "rgba(255, 255, 255, 0.5)"
        )
    })

    test("CarouselY dots change from 4 to 5 when resize button is clicked", async ({
        page,
    }) => {
        // Initially check that there are 5 dots
        const dots = page.locator("#twelve-items .dot")
        await expect(dots).toHaveCount(5)

        // Click the resize button
        await page.click("#size")
        await page.waitForTimeout(100) // Wait for resize to take effect

        // Check that there are now 13 dots
        await expect(dots).toHaveCount(13)
    })

    test("CarouselY wheel scroll works correctly with deltaY 200", async ({
        page,
    }) => {
        const ul = page.locator("#twelve-items ul")

        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, -1950)")

        // Apply wheel scroll with deltaY 20
        await ul.dispatchEvent("wheel", { deltaY: 20 })
        await page.waitForTimeout(250) // Wait for animation

        // Check that it scrolled by the delta amount (should be -1950 + 200 = -1750)
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, -20)")
    })

    test("CarouselY goes next with 12 items correctly and can be interrupted by wheel scroll", async ({
        page,
    }) => {
        const ul = page.locator("#twelve-items ul")

        // Test navigation with next button
        await page.click("#twelve-items .next")
        await page.waitForTimeout(50) // Wait for animation
        // Check is animating
        await expect(ul).not.toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, 0, -450)"
        )

        // Interrupt animation with wheel scroll
        await ul.dispatchEvent("wheel", { deltaY: 20 })
        await page.waitForTimeout(50)
        // Check that animation is no longer running - final position should be stable
        const finalTransform = await ul.evaluate(
            (el) => getComputedStyle(el).transform
        )
        await page.waitForTimeout(20) // Wait a bit more
        const finalTransform2 = await ul.evaluate(
            (el) => getComputedStyle(el).transform
        )
        // The transform should be stable (not changing)
        expect(finalTransform).toBe(finalTransform2)
    })
})

test.describe("CarouselFullWidth", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto("/tests/CarouselFullWidth")
        await page.waitForTimeout(200) // Wait for carousel to initialize
    })

    test("Carousel clones 1 item correctly", async ({ page }) => {
        const ul = page.locator("#one-item ul")
        const firstItem = page.locator("#one-item ul li:first-child")

        const dots = page.locator("#one-item .dot")
        await expect(dots).toHaveCount(1)

        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, -530, 0)")

        await expect(firstItem).toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, 1060, 0)"
        )

        await expect(page.locator("#one-item ul li")).toHaveCount(2)
    })

    test("Carousel goes next with one item correctly", async ({ page }) => {
        const ul = page.locator("#one-item ul")

        // Test navigation with next button
        await page.click("#one-item .next")
        await page.waitForTimeout(50) // Wait for animation
        // Check is animating
        await expect(ul).not.toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, -530, 0)"
        )
        await page.waitForTimeout(250) // Wait for animation

        // After clicking next, position should change
        // Note: -110 is the initial position, so it should be the same as theres only one item
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, -530, 0)")
    })

    test("Carousel goes prev with one item correctly", async ({ page }) => {
        const ul = page.locator("#one-item ul")

        // Test navigation with prev button
        await page.click("#one-item .prev")
        await page.waitForTimeout(50) // Wait for animation
        // Check is animating
        await expect(ul).not.toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, -530, 0)"
        )
        await page.waitForTimeout(250) // Wait for animation

        // After clicking next, position should change
        // Note: -110 is the initial position, so it should be the same as theres only one item
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, -530, 0)")
    })

    test("Carousel clones 2 items correctly", async ({ page }) => {
        const ul = page.locator("#two-items ul")
        const firstItem = page.locator("#two-items ul li:first-child")

        const dots = page.locator("#two-items .dot")
        await expect(dots).toHaveCount(2)

        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, -1060, 0)")

        await expect(firstItem).toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, 1060, 0)"
        )

        await expect(page.locator("#two-items ul li")).toHaveCount(2)
    })

    test("Carousel goes next with two items correctly", async ({ page }) => {
        const ul = page.locator("#two-items ul")

        // Test navigation with next button
        await page.click("#two-items .next")
        await page.waitForTimeout(50) // Wait for animation
        // Check is animating
        await expect(ul).not.toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, -1060, 0)"
        )
        await page.waitForTimeout(250) // Wait for animation

        // After clicking next, position should change
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, -530, 0)")
    })

    test("Carousel goes prev with two items correctly", async ({ page }) => {
        const ul = page.locator("#two-items ul")

        // Test navigation with prev button
        await page.click("#two-items .prev")
        await page.waitForTimeout(50) // Wait for animation
        // Check is animating
        await expect(ul).not.toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, -1060, 0)"
        )
        await page.waitForTimeout(250) // Wait for animation

        // After clicking next, position should change
        // Note: -110 is the initial position, so it should be the same as theres only one item
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, -530, 0)")
    })

    test("Carousel clones 12 items correctly", async ({ page }) => {
        const ul = page.locator("#twelve-items ul")
        const firstItem = page.locator("#twelve-items ul li:first-child")

        const dots = page.locator("#twelve-items .dot")
        await expect(dots).toHaveCount(13)

        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, -6890, 0)")

        await expect(firstItem).toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, 6890, 0)"
        )

        await expect(page.locator("#twelve-items ul li")).toHaveCount(13)
    })

    test("Carousel goes next with 12 items correctly, pagination works", async ({
        page,
    }) => {
        const ul = page.locator("#twelve-items ul")
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, -6890, 0)")
        // Test navigation with next button
        await page.click("#twelve-items .next")
        await page.waitForTimeout(50) // Wait for animation
        // Check is animating
        await expect(ul).not.toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, -6890, 0)"
        )
        await page.waitForTimeout(250) // Wait for animation

        // After clicking next, position should change
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, -530, 0)")
        const dots = page.locator("#twelve-items .dot")
        await expect(dots).toHaveCount(13)
        await expect(dots.nth(0)).toHaveCSS(
            "background-color",
            "rgba(255, 255, 255, 0.5)"
        )
        await expect(dots.nth(1)).toHaveCSS(
            "background-color",
            "rgb(255, 255, 255)"
        )
        await expect(dots.nth(2)).toHaveCSS(
            "background-color",
            "rgba(255, 255, 255, 0.5)"
        )
        await expect(dots.nth(3)).toHaveCSS(
            "background-color",
            "rgba(255, 255, 255, 0.5)"
        )
    })

    test("Carousel goes prev with 12 items correctly", async ({ page }) => {
        const ul = page.locator("#twelve-items ul")

        // Test navigation with next button
        await page.click("#twelve-items .prev")
        await page.waitForTimeout(50) // Wait for animation
        // Check is animating
        await expect(ul).not.toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, -6890, 0)"
        )
        await page.waitForTimeout(250) // Wait for animation

        // After clicking next, position should change
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, -6360, 0)")
        const dots = page.locator("#twelve-items .dot")
        await expect(dots).toHaveCount(13)
        await expect(dots.nth(0)).toHaveCSS(
            "background-color",
            "rgba(255, 255, 255, 0.5)"
        )
        await expect(dots.nth(1)).toHaveCSS(
            "background-color",
            "rgba(255, 255, 255, 0.5)"
        )
        await expect(dots.nth(12)).toHaveCSS(
            "background-color",
            "rgb(255, 255, 255)"
        )
    })

    test("Carousel works with goto actions, page 2", async ({ page }) => {
        const ul = page.locator("#twelve-items ul")
        const dots = page.locator("#twelve-items .dot")
        await expect(dots).toHaveCount(13)
        await expect(dots.nth(0)).toHaveCSS(
            "background-color",
            "rgb(255, 255, 255)"
        )

        await page.click("#twelve-items .dot:nth-child(3)")
        await page.waitForTimeout(50) // Wait for animation
        // Check is animating
        await expect(ul).not.toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, -1060, 0)"
        )
        await page.waitForTimeout(250) // Wait for animation

        // After clicking next, position should change
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, -1060, 0)")
    })

    test("Carousel correctly interrupts pagination with second next command", async ({
        page,
    }) => {
        const ul = page.locator("#twelve-items ul")

        // Test navigation with next button
        await page.click("#twelve-items .next")
        await page.waitForTimeout(50) // Wait for animation
        await page.click("#twelve-items .next")
        // Check is animating
        await expect(ul).not.toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, -1060, 0)"
        )
        await page.waitForTimeout(300) // Wait for animation

        // After clicking next, position should change
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, -1060, 0)")
        const dots = page.locator("#twelve-items .dot")
        await expect(dots).toHaveCount(13)
        await expect(dots.nth(0)).toHaveCSS(
            "background-color",
            "rgba(255, 255, 255, 0.5)"
        )
        await expect(dots.nth(1)).toHaveCSS(
            "background-color",
            "rgba(255, 255, 255, 0.5)"
        )
        await expect(dots.nth(2)).toHaveCSS(
            "background-color",
            "rgb(255, 255, 255)"
        )
        await expect(dots.nth(3)).toHaveCSS(
            "background-color",
            "rgba(255, 255, 255, 0.5)"
        )
    })

    test("Carousel loops correctly", async ({ page }) => {
        const ul = page.locator("#twelve-items ul")

        // Test navigation with next button
        await page.click("#twelve-items .next")
        await page.waitForTimeout(50) // Wait for animation
        await page.click("#twelve-items .next")
        await page.waitForTimeout(50) // Wait for animation
        await page.click("#twelve-items .next")
        await page.waitForTimeout(50) // Wait for animation
        await page.click("#twelve-items .next")
        // Check is animating
        await expect(ul).not.toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, -2120, 0)"
        )
        await page.waitForTimeout(300) // Wait for animation

        // After clicking next, position should change
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, -2120, 0)")
        const dots = page.locator("#twelve-items .dot")
        await expect(dots).toHaveCount(13)
        await expect(dots.nth(4)).toHaveCSS(
            "background-color",
            "rgb(255, 255, 255)"
        )
        await expect(dots.nth(1)).toHaveCSS(
            "background-color",
            "rgba(255, 255, 255, 0.5)"
        )
        await expect(dots.nth(2)).toHaveCSS(
            "background-color",
            "rgba(255, 255, 255, 0.5)"
        )
        await expect(dots.nth(3)).toHaveCSS(
            "background-color",
            "rgba(255, 255, 255, 0.5)"
        )
    })

    test("Number of carousel dots doesn't change when resize button is clicked (as same number of pages)", async ({
        page,
    }) => {
        const dots = page.locator("#twelve-items .dot")
        await expect(dots).toHaveCount(13)

        // Click the resize button
        await page.click("#size")
        await page.waitForTimeout(100) // Wait for resize to take effect

        // Check that there are now 5 dots
        await expect(dots).toHaveCount(13)
    })

    test("Carousel styles children with correct width and height", async ({
        page,
    }) => {
        const firstItem = page.locator("#one-item ul li:first-child")

        // Check computed width and height of child
        await expect(firstItem).toHaveCSS("width", "520px")
        await expect(firstItem).toHaveCSS("height", "140px")
    })
})

test.describe("Carousel: Loop disabled", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto("/tests/CarouselLoopDisabled")
        await page.waitForTimeout(200) // Wait for carousel to initialize
    })

    test("Carousel doesn't clone one item", async ({ page }) => {
        const ul = page.locator("#one-item ul")
        const firstItem = page.locator("#one-item ul li:first-child")

        await expect(ul).toHaveCSS("transform", "none")
        await expect(firstItem).toHaveCSS("transform", "none")

        await expect(page.locator("#one-item ul li")).toHaveCount(1)
    })

    test("Carousel with one item has disabled navigation", async ({ page }) => {
        const prev = page.locator("#one-item .prev")
        const next = page.locator("#one-item .next")

        await expect(prev).toHaveCSS("opacity", "0.5")
        await expect(next).toHaveCSS("opacity", "0.5")
    })

    test("Carousel doesn't clone two items", async ({ page }) => {
        const ul = page.locator("#two-items ul")
        const firstItem = page.locator("#two-items ul li:first-child")

        await expect(ul).toHaveCSS("transform", "none")
        await expect(firstItem).toHaveCSS("transform", "none")

        await expect(page.locator("#two-items ul li")).toHaveCount(2)
    })

    test("Carousel with two items has disabled navigation", async ({
        page,
    }) => {
        const prev = page.locator("#two-items .prev")
        const next = page.locator("#two-items .next")

        await expect(prev).toHaveCSS("opacity", "0.5")
        await expect(next).toHaveCSS("opacity", "0.5")
    })

    test("Carousel doesn't clone 12 items or reproject", async ({ page }) => {
        const ul = page.locator("#twelve-items ul")
        const firstItem = page.locator("#twelve-items ul li:first-child")

        // Ensure transforms are none
        await expect(ul).toHaveCSS("transform", "none")
        await expect(firstItem).toHaveCSS("transform", "none")

        // Check that there are 12 li children in total
        await expect(page.locator("#twelve-items ul li")).toHaveCount(13)
    })

    test("Carousel goes next with 12 items correctly, pagination works", async ({
        page,
    }) => {
        const ul = page.locator("#twelve-items ul")
        const prev = page.locator("#twelve-items .prev")
        const next = page.locator("#twelve-items .next")

        await expect(prev).toHaveCSS("opacity", "0.5")
        await expect(next).toHaveCSS("opacity", "1")

        // Test navigation with next button
        await page.click("#twelve-items .next")
        await page.waitForTimeout(50) // Wait for animation
        // Check is animating
        await expect(ul).not.toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, -330, 0)"
        )
        await page.waitForTimeout(250) // Wait for animation

        // After clicking next, position should change
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, -330, 0)")
        const dots = page.locator("#twelve-items .dot")
        await expect(dots).toHaveCount(4)
        await expect(dots.nth(0)).toHaveCSS(
            "background-color",
            "rgba(255, 255, 255, 0.5)"
        )
        await expect(dots.nth(1)).toHaveCSS(
            "background-color",
            "rgb(255, 255, 255)"
        )
        await expect(dots.nth(2)).toHaveCSS(
            "background-color",
            "rgba(255, 255, 255, 0.5)"
        )
        await expect(dots.nth(3)).toHaveCSS(
            "background-color",
            "rgba(255, 255, 255, 0.5)"
        )
    })

    test("Carousel goes prev with 12 items correctly", async ({ page }) => {
        const ul = page.locator("#twelve-items ul")

        // Test navigation with next button
        await page.click("#twelve-items .prev")
        await page.waitForTimeout(50) // Wait for animation
        await page.waitForTimeout(250) // Wait for animation

        // After clicking next, position should change
        await expect(ul).toHaveCSS("transform", "none")
    })

    test("Carousel works with goto actions, page 2", async ({ page }) => {
        const ul = page.locator("#twelve-items ul")
        const dots = page.locator("#twelve-items .dot")
        await expect(dots).toHaveCount(4)
        await expect(dots.nth(0)).toHaveCSS(
            "background-color",
            "rgb(255, 255, 255)"
        )

        await page.click("#twelve-items .dot:nth-child(3)")
        await page.waitForTimeout(50) // Wait for animation
        // Check is animating
        await expect(ul).not.toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, -660, 0)"
        )
        await page.waitForTimeout(250) // Wait for animation

        // After clicking next, position should change
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, -660, 0)")
    })

    test("Carousel works with goto actions, last page", async ({ page }) => {
        const ul = page.locator("#twelve-items ul")
        const dots = page.locator("#twelve-items .dot")
        await expect(dots).toHaveCount(4)
        await expect(dots.nth(0)).toHaveCSS(
            "background-color",
            "rgb(255, 255, 255)"
        )

        await page.click("#twelve-items .dot:nth-child(4)")
        await page.waitForTimeout(50) // Wait for animation
        // Check is animating
        await expect(ul).not.toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, -900, 0)"
        )
        await page.waitForTimeout(250) // Wait for animation

        // After clicking next, position should change
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, -900, 0)")
    })

    test("Carousel correctly interrupts pagination with second next command", async ({
        page,
    }) => {
        const ul = page.locator("#twelve-items ul")

        // Test navigation with next button
        await page.click("#twelve-items .next")
        await page.waitForTimeout(50) // Wait for animation
        await page.click("#twelve-items .next")
        // Check is animating
        await expect(ul).not.toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, -660, 0)"
        )
        await page.waitForTimeout(300) // Wait for animation

        // After clicking next, position should change
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, -660, 0)")
        const dots = page.locator("#twelve-items .dot")
        await expect(dots).toHaveCount(4)
        await expect(dots.nth(0)).toHaveCSS(
            "background-color",
            "rgba(255, 255, 255, 0.5)"
        )
        await expect(dots.nth(1)).toHaveCSS(
            "background-color",
            "rgba(255, 255, 255, 0.5)"
        )
        await expect(dots.nth(2)).toHaveCSS(
            "background-color",
            "rgb(255, 255, 255)"
        )
        await expect(dots.nth(3)).toHaveCSS(
            "background-color",
            "rgba(255, 255, 255, 0.5)"
        )
    })

    test("Carousel loops correctly", async ({ page }) => {
        const ul = page.locator("#twelve-items ul")

        // Test navigation with next button
        await page.click("#twelve-items .next")
        await page.waitForTimeout(50) // Wait for animation
        await page.click("#twelve-items .next")
        await page.waitForTimeout(50) // Wait for animation
        await page.click("#twelve-items .next")

        // Check is animating
        await expect(ul).not.toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, -900, 0)"
        )
        await page.waitForTimeout(300) // Wait for animation

        // After clicking next, position should change
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, -900, 0)")
        const dots = page.locator("#twelve-items .dot")
        await expect(dots).toHaveCount(4)
        await expect(dots.nth(0)).toHaveCSS(
            "background-color",
            "rgba(255, 255, 255, 0.5)"
        )
        await expect(dots.nth(1)).toHaveCSS(
            "background-color",
            "rgba(255, 255, 255, 0.5)"
        )
        await expect(dots.nth(2)).toHaveCSS(
            "background-color",
            "rgba(255, 255, 255, 0.5)"
        )
        await expect(dots.nth(3)).toHaveCSS(
            "background-color",
            "rgb(255, 255, 255)"
        )
    })

    test("Carousel dots change from 4 to 5 when resize button is clicked", async ({
        page,
    }) => {
        // Initially check that there are 4 dots
        const dots = page.locator("#twelve-items .dot")
        await expect(dots).toHaveCount(4)

        // Click the resize button
        await page.click("#size")
        await page.waitForTimeout(100) // Wait for resize to take effect

        // Check that there are now 5 dots
        await expect(dots).toHaveCount(5)
    })

    test("Carousel with one item doesn't move with wheel scroll deltaX -200 and 200", async ({
        page,
    }) => {
        const ul = page.locator("#one-item ul")

        // Verify initial position (should be no transform)
        await expect(ul).toHaveCSS("transform", "none")

        // Apply wheel scroll with deltaX -200
        await ul.dispatchEvent("wheel", { deltaX: -200 })
        await page.waitForTimeout(250) // Wait for any potential animation

        // Verify position hasn't changed
        await expect(ul).toHaveCSS("transform", "none")

        // Apply wheel scroll with deltaX 200
        await ul.dispatchEvent("wheel", { deltaX: 200 })
        await page.waitForTimeout(250) // Wait for any potential animation

        // Verify position still hasn't changed
        await expect(ul).toHaveCSS("transform", "none")
    })

    test("Carousel with two items doesn't move with wheel scroll deltaX -200 and 200", async ({
        page,
    }) => {
        const ul = page.locator("#two-items ul")

        // Verify initial position (should be no transform)
        await expect(ul).toHaveCSS("transform", "none")

        // Apply wheel scroll with deltaX -200
        await ul.dispatchEvent("wheel", { deltaX: -200 })
        await page.waitForTimeout(250) // Wait for any potential animation

        // Verify position hasn't changed
        await expect(ul).toHaveCSS("transform", "none")

        // Apply wheel scroll with deltaX 200
        await ul.dispatchEvent("wheel", { deltaX: 200 })
        await page.waitForTimeout(250) // Wait for any potential animation

        // Verify position still hasn't changed
        await expect(ul).toHaveCSS("transform", "none")
    })

    test("Carousel with 12 items wheel scroll deltaX -200 doesn't move from initial position", async ({
        page,
    }) => {
        const ul = page.locator("#twelve-items ul")

        // Verify initial position (should be no transform)
        await expect(ul).toHaveCSS("transform", "none")

        // Apply wheel scroll with deltaX -200
        await ul.dispatchEvent("wheel", { deltaX: -200 })
        await page.waitForTimeout(250) // Wait for any potential animation

        // Verify position hasn't changed (still at beginning)
        await expect(ul).toHaveCSS("transform", "none")
    })

    test("Carousel with 12 items wheel scroll deltaX 1000 reaches max offset with next disabled and fourth dot highlighted", async ({
        page,
    }) => {
        const ul = page.locator("#twelve-items ul")
        const next = page.locator("#twelve-items .next")
        const dots = page.locator("#twelve-items .dot")

        // Verify initial state
        await expect(ul).toHaveCSS("transform", "none")
        await expect(next).toBeEnabled()

        // Apply large wheel scroll to reach maximum
        await ul.dispatchEvent("wheel", { deltaX: 1000 })
        await page.waitForTimeout(10) // Wait for animation
        await ul.dispatchEvent("wheel", { deltaX: 10 })
        await ul.dispatchEvent("wheel", { deltaX: 20 })
        await ul.dispatchEvent("wheel", { deltaX: 30 })
        await ul.dispatchEvent("wheel", { deltaX: 1000 })
        await page.waitForTimeout(10) // Wait for animation
        await ul.dispatchEvent("wheel", { deltaX: 10 })
        await ul.dispatchEvent("wheel", { deltaX: 20 })
        await ul.dispatchEvent("wheel", { deltaX: 30 })
        await ul.dispatchEvent("wheel", { deltaX: 1000 })
        await page.waitForTimeout(10) // Wait for animation
        await ul.dispatchEvent("wheel", { deltaX: 10 })
        await ul.dispatchEvent("wheel", { deltaX: 20 })
        await ul.dispatchEvent("wheel", { deltaX: 30 })
        await ul.dispatchEvent("wheel", { deltaX: 1000 })
        await page.waitForTimeout(250) // Wait for animation

        // Verify we're at the maximum offset (last page)
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, -900, 0)")

        // Verify next button is disabled at the end
        await expect(next).toHaveCSS("opacity", "0.5")

        // Verify fourth dot is highlighted (last page)
        await expect(dots).toHaveCount(4)
        await expect(dots.nth(0)).toHaveCSS(
            "background-color",
            "rgba(255, 255, 255, 0.5)"
        )
        await expect(dots.nth(1)).toHaveCSS(
            "background-color",
            "rgba(255, 255, 255, 0.5)"
        )
        await expect(dots.nth(2)).toHaveCSS(
            "background-color",
            "rgba(255, 255, 255, 0.5)"
        )
        await expect(dots.nth(3)).toHaveCSS(
            "background-color",
            "rgb(255, 255, 255)"
        )
    })

    test("Carousel with 12 items wheel scroll deltaX 1px doesn't move position", async ({
        page,
    }) => {
        const ul = page.locator("#twelve-items ul")

        // Verify initial position (should be no transform)
        await expect(ul).toHaveCSS("transform", "none")

        // Apply minimal wheel scroll with deltaX 1
        await ul.dispatchEvent("wheel", { deltaX: 1 })
        await page.waitForTimeout(20)

        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, -1, 0)")
        // Check that the "prev" button is no longer disabled after scrolling
        const prev = page.locator("#twelve-items .prev")
        await expect(prev).toBeEnabled()
    })
})

test.describe("Carousel: Set offset via context", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto("/tests/CarouselOffsetViaContext")
        await page.waitForTimeout(200) // Wait for carousel to initialize
    })

    test("Carousel offset is set correctly via context", async ({ page }) => {
        const ul = page.locator("#twelve-items ul")
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, -930, 0)")
    })

    test("Carousel offset can be updated via wheel after being set by context", async ({
        page,
    }) => {
        const ul = page.locator("#twelve-items ul")
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, -930, 0)")
        await ul.dispatchEvent("wheel", { deltaX: 20 })
        await page.waitForTimeout(30)
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, -950, 0)")
    })
})

test.describe("Carousel: Initial page prop", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto("/tests/CarouselInitialPage")
        await page.waitForTimeout(200) // Wait for carousel to initialize
    })

    test("Carousel with page={0} starts at first page (default behavior)", async ({
        page,
    }) => {
        const ul = page.locator("#page-0 ul")
        const dots = page.locator("#page-0 .dot")

        // Should start at page 0 offset
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, -1430, 0)")

        // First dot should be highlighted
        await expect(dots.nth(0)).toHaveCSS(
            "background-color",
            "rgb(255, 255, 255)"
        )
        await expect(dots.nth(1)).toHaveCSS(
            "background-color",
            "rgba(255, 255, 255, 0.5)"
        )
    })

    test("Carousel with page={2} starts at third page", async ({ page }) => {
        const ul = page.locator("#page-2 ul")
        const dots = page.locator("#page-2 .dot")

        // Should start at page 2 offset (third page)
        // Page 0 is 0, page 1 is 440, page 2 is 880
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, -880, 0)")

        // Third dot should be highlighted
        await expect(dots.nth(0)).toHaveCSS(
            "background-color",
            "rgba(255, 255, 255, 0.5)"
        )
        await expect(dots.nth(1)).toHaveCSS(
            "background-color",
            "rgba(255, 255, 255, 0.5)"
        )
        await expect(dots.nth(2)).toHaveCSS(
            "background-color",
            "rgb(255, 255, 255)"
        )
    })

    test("Carousel with page={3} and loop={false} starts at last page", async ({
        page,
    }) => {
        const ul = page.locator("#page-3-loop-disabled ul")
        const dots = page.locator("#page-3-loop-disabled .dot")
        const next = page.locator("#page-3-loop-disabled .next")
        const prev = page.locator("#page-3-loop-disabled .prev")

        // Should start at page 3 offset (fourth/last page)
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, -900, 0)")

        // Fourth dot should be highlighted
        await expect(dots.nth(3)).toHaveCSS(
            "background-color",
            "rgb(255, 255, 255)"
        )

        // Next should be disabled, prev should be enabled
        await expect(next).toHaveCSS("opacity", "0.5")
        await expect(prev).toHaveCSS("opacity", "1")
    })

    test("Carousel with page={2} can navigate after initial load", async ({
        page,
    }) => {
        const ul = page.locator("#page-2 ul")
        const dots = page.locator("#page-2 .dot")

        // Verify we start at page 2
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, -880, 0)")

        // Click prev to go to page 1
        await page.click("#page-2 .prev")
        await page.waitForTimeout(400) // Wait for animation

        // Should now be at page 1
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, -440, 0)")
        await expect(dots.nth(1)).toHaveCSS(
            "background-color",
            "rgb(255, 255, 255)"
        )
    })

    test("Carousel with page={2} responds to wheel scroll", async ({ page }) => {
        const ul = page.locator("#page-2 ul")

        // Verify we start at page 2
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, -880, 0)")

        // Apply wheel scroll
        await ul.dispatchEvent("wheel", { deltaX: 20 })
        await page.waitForTimeout(100)

        // Should have scrolled from initial position
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, -900, 0)")
    })

    test("Carousel page prop is reactive to changes", async ({ page }) => {
        const ul = page.locator("#reactive-page ul")
        const dots = page.locator("#reactive-page .dot")

        // Starts at page 0
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, -1430, 0)")
        await expect(dots.nth(0)).toHaveCSS(
            "background-color",
            "rgb(255, 255, 255)"
        )

        // Click to change to page 2
        await page.click("#set-page-2")
        await page.waitForTimeout(100)

        // Should now be at page 2
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, -880, 0)")
        await expect(dots.nth(2)).toHaveCSS(
            "background-color",
            "rgb(255, 255, 255)"
        )

        // Click to change to page 1
        await page.click("#set-page-1")
        await page.waitForTimeout(100)

        // Should now be at page 1
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, -440, 0)")
        await expect(dots.nth(1)).toHaveCSS(
            "background-color",
            "rgb(255, 255, 255)"
        )

        // Click to change back to page 0
        await page.click("#set-page-0")
        await page.waitForTimeout(100)

        // Should be back at page 0
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, -1430, 0)")
        await expect(dots.nth(0)).toHaveCSS(
            "background-color",
            "rgb(255, 255, 255)"
        )
    })
})

test.describe("Carousel: Accessibility", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto("/tests/Carousel")
        await page.waitForTimeout(200) // Wait for carousel to initialize
    })

    test("Carousel items have correct aria-posinset and aria-setsize", async ({
        page,
    }) => {
        const items = page.locator("#twelve-items ul li")
        // total items = 13 so setsize should be 13 for all
        const count = await items.count()
        expect(count).toBe(13)
        for (let index = 0; index < count; index++) {
            const item = items.nth(index)
            await expect(item).toHaveAttribute("aria-setsize", "13")
            await expect(item).toHaveAttribute(
                "aria-posinset",
                (index + 1).toString()
            )
        }
    })

    test("Clones are aria-hidden and dont have posinset or setsize attributes", async ({
        page,
    }) => {
        const items = page.locator("#one-item ul li")
        await expect(items).toHaveCount(6)

        // Check first item is not aria-hidden, has posinset 1 and setsize 1
        const first = items.nth(0)
        await expect(first).toHaveAttribute("aria-hidden", "false")
        await expect(first).toHaveAttribute("aria-posinset", "1")
        await expect(first).toHaveAttribute("aria-setsize", "1")

        // Check second item is aria-hidden, has no posinset/setsize attributes
        const second = items.nth(1)
        await expect(second).toHaveAttribute("aria-hidden", "true")
        await expect(second).not.toHaveAttribute("aria-posinset")
        await expect(second).not.toHaveAttribute("aria-setsize")
    })
})

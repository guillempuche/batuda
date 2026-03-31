import { expect, test } from "@playwright/test"

test.describe("Ticker cloning and positioning, x axis", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto("/tests/TickerCloneX")
        await page.waitForTimeout(200) // Wait for ticker to initialize
    })

    test("Ticker clones 1 item correctly", async ({ page }) => {
        const ul = page.locator("#one-item ul")
        const firstItem = page.locator("#one-item ul li:first-child")

        // Check that the ul has translateX of -110px (100px width + 10px default gap)
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, -110, 0)")

        // Check that the first item has translateX of 660px
        await expect(firstItem).toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, 660, 0)"
        )

        // Check that there are 5 li children in total
        await expect(page.locator("#one-item ul li")).toHaveCount(6)

        // Check the carousel responds to changes in width
        await page.click("#size")
        await page.waitForTimeout(50) // Wait for animation frame
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, -110, 0)")
        await expect(firstItem).toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, 440, 0)"
        )
        await expect(page.locator("#one-item ul li")).toHaveCount(4)
    })

    test("Ticker clones 2 items correctly", async ({ page }) => {
        const ul = page.locator("#two-items ul")
        // Check that the ul has translateX of -110px (100px width + 10px default gap)
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, -220, 0)")

        const firstItem = page.locator("#two-items ul li:first-child")
        const secondItem = page.locator("#two-items ul li:nth-child(2)")

        // Check that the first item has translateX of 550px
        await expect(firstItem).toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, 660, 0)"
        )

        // Check that the second item has translateX of 660px
        await expect(secondItem).toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, 660, 0)"
        )

        // Check that there are 6 li children in total
        await expect(page.locator("#two-items ul li")).toHaveCount(6)

        await page.click("#move")
        await page.waitForTimeout(50) // Wait for animation frame
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, -100, 0)")
        await expect(firstItem).toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, 660, 0)"
        )
        await expect(secondItem).toHaveCSS("transform", "none")

        // Check the carousel responds to changes in width
        await page.click("#size")
        await page.waitForTimeout(50) // Wait for animation frame
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, -100, 0)")
        await expect(firstItem).toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, 440, 0)"
        )
        await expect(page.locator("#two-items ul li")).toHaveCount(4)
    })

    test("Ticker doesn't clone children when it can translate items to fill the space", async ({
        page,
    }) => {
        const ul = page.locator("#six-items ul")
        // Check that the ul has translateX of -110px (100px width + 10px default gap)
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, -660, 0)")

        const firstItem = page.locator("#six-items ul li:first-child")
        const lastItem = page.locator("#six-items ul li:last-child")

        // Check that the first item has translateX of 550px
        await expect(firstItem).toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, 660, 0)"
        )

        // Check that the last item has translateX of 660px
        await expect(lastItem).toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, 660, 0)"
        )

        // Check that there are 6 li children in total
        await expect(page.locator("#six-items ul li")).toHaveCount(6)
    })
})

test.describe("Ticker cloning and positioning, x axis, RTL", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto("/tests/TickerCloneXRTL")
        await page.waitForTimeout(200) // Wait for ticker to initialize
    })

    test("Ticker clones 1 item correctly", async ({ page }) => {
        const ul = page.locator("#one-item ul")
        const firstItem = page.locator("#one-item ul li:first-child")

        // Check that the ul has translateX of -110px (100px width + 10px default gap)
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, 110, 0)")

        // Check that the first item has translateX of 660px
        await expect(firstItem).toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, -660, 0)"
        )

        // Check that there are 5 li children in total
        await expect(page.locator("#one-item ul li")).toHaveCount(6)

        // Check the carousel responds to changes in width
        await page.click("#size")
        await page.waitForTimeout(50) // Wait for animation frame
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, 110, 0)")
        await expect(firstItem).toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, -440, 0)"
        )
        await expect(page.locator("#one-item ul li")).toHaveCount(4)
    })

    test("Ticker clones 2 items correctly", async ({ page }) => {
        const ul = page.locator("#two-items ul")
        // Check that the ul has translateX of -110px (100px width + 10px default gap)
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, 220, 0)")

        const firstItem = page.locator("#two-items ul li:first-child")
        const secondItem = page.locator("#two-items ul li:nth-child(2)")

        // Check that the first item has translateX of 550px
        await expect(firstItem).toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, -660, 0)"
        )

        // Check that the second item has translateX of 660px
        await expect(secondItem).toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, -660, 0)"
        )

        // Check that there are 6 li children in total
        await expect(page.locator("#two-items ul li")).toHaveCount(6)

        await page.click("#move")
        await page.waitForTimeout(50) // Wait for animation frame
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, 120, 0)")
        await expect(firstItem).toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, -660, 0)"
        )
        await expect(secondItem).toHaveCSS("transform", "none")

        // Check the carousel responds to changes in width
        await page.click("#size")
        await page.waitForTimeout(50) // Wait for animation frame
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, 120, 0)")
        await expect(firstItem).toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, -440, 0)"
        )
        await expect(page.locator("#two-items ul li")).toHaveCount(4)
    })

    test("Ticker doesn't clone children when it can translate items to fill the space", async ({
        page,
    }) => {
        const ul = page.locator("#six-items ul")
        // Check that the ul has translateX of -110px (100px width + 10px default gap)
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, 660, 0)")

        const firstItem = page.locator("#six-items ul li:first-child")
        const lastItem = page.locator("#six-items ul li:last-child")

        // Check that the first item has translateX of 550px
        await expect(firstItem).toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, -660, 0)"
        )

        // Check that the last item has translateX of 660px
        await expect(lastItem).toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, -660, 0)"
        )

        // Check that there are 6 li children in total
        await expect(page.locator("#six-items ul li")).toHaveCount(6)
    })
})

test.describe("Ticker cloning and positioning, x axis, overflow visible", () => {
    test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 1000, height: 1000 })
        await page.goto("/tests/TickerCloneXOverflowVisible")
        await page.waitForTimeout(200) // Wait for ticker to initialize
    })

    test("Ticker clones 1 item correctly", async ({ page }) => {
        const ul = page.locator("#one-item ul")
        const firstItem = page.locator("#one-item ul li:first-child")

        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, -330, 0)")

        await expect(page.locator("#one-item ul li")).toHaveCount(10)

        await page.click("#size")
        await page.waitForTimeout(50) // Wait for animation frame
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, -440, 0)")
        await expect(firstItem).toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, 1100, 0)"
        )
        await expect(page.locator("#one-item ul li")).toHaveCount(10)

        await page.click("#size")
        await page.waitForTimeout(50) // Wait for animation frame
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, -550, 0)")
        await expect(firstItem).toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, 1100, 0)"
        )
        await expect(page.locator("#one-item ul li")).toHaveCount(10)
    })

    test("Ticker clones 1 stretched item correctly", async ({ page }) => {
        const ul = page.locator("#one-item-stretch ul")
        const firstItem = page.locator("#one-item-stretch ul li:first-child")

        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, -530, 0)")

        await expect(page.locator("#one-item-stretch ul li")).toHaveCount(3)

        await page.click("#size")
        await page.waitForTimeout(50) // Wait for animation frame
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, -660, 0)")
        await expect(firstItem).toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, 1320, 0)"
        )
        await expect(page.locator("#one-item-stretch ul li")).toHaveCount(4)

        await page.click("#size")
        await page.waitForTimeout(50) // Wait for animation frame
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, -520, 0)")
        await expect(page.locator("#one-item-stretch ul li")).toHaveCount(9)
    })

    test("Ticker clones 2 items correctly", async ({ page }) => {
        const ul = page.locator("#two-items ul")
        const firstItem = page.locator("#two-items ul li:first-child")
        const secondItem = page.locator("#two-items ul li:nth-child(2)")

        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, -440, 0)")

        await expect(page.locator("#one-item ul li")).toHaveCount(10)

        await page.click("#size")
        await page.waitForTimeout(50) // Wait for animation frame
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, -440, 0)")
        await expect(firstItem).toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, 1100, 0)"
        )
        await expect(page.locator("#one-item ul li")).toHaveCount(10)

        await page.click("#size")
        await page.waitForTimeout(50) // Wait for animation frame
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, -660, 0)")
        await expect(firstItem).toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, 1100, 0)"
        )
        expect(secondItem).toHaveCSS("transform", "matrix(1, 0, 0, 1, 1100, 0)")
        await expect(page.locator("#two-items ul li")).toHaveCount(10)
    })

    test("Ticker clones 6 items correctly", async ({ page }) => {
        const ul = page.locator("#six-items ul")
        // Check that the ul has translateX of -110px (100px width + 10px default gap)
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, -660, 0)")

        const firstItem = page.locator("#six-items ul li:first-child")
        const lastItem = page.locator("#six-items ul li:last-child")

        // Check that the first item has translateX of 550px
        await expect(firstItem).toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, 1320, 0)"
        )

        // Check that the last item has translateX of 660px
        await expect(lastItem).toHaveCSS("transform", "none")

        // Check that there are 6 li children in total
        await expect(page.locator("#six-items ul li")).toHaveCount(12)
    })
})
test.describe("Ticker cloning and positioning, x axis, RTL, overflow visible", () => {
    test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 1000, height: 1000 })
        await page.goto("/tests/TickerCloneXOverflowVisibleRTL")
        await page.waitForTimeout(200) // Wait for ticker to initialize
    })

    test("Ticker clones 1 item correctly", async ({ page }) => {
        const ul = page.locator("#one-item ul")
        const firstItem = page.locator("#one-item ul li:first-child")

        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, 330, 0)")

        await expect(page.locator("#one-item ul li")).toHaveCount(10)

        await page.click("#size")
        await page.waitForTimeout(50) // Wait for animation frame
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, 440, 0)")
        await expect(firstItem).toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, -1100, 0)"
        )
        await expect(page.locator("#one-item ul li")).toHaveCount(10)

        await page.click("#size")
        await page.waitForTimeout(50) // Wait for animation frame
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, 550, 0)")
        await expect(firstItem).toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, -1100, 0)"
        )
        await expect(page.locator("#one-item ul li")).toHaveCount(10)
    })

    test("Ticker clones 1 stretched item correctly", async ({ page }) => {
        const ul = page.locator("#one-item-stretch ul")
        const firstItem = page.locator("#one-item-stretch ul li:first-child")

        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, 530, 0)")

        await expect(page.locator("#one-item-stretch ul li")).toHaveCount(3)

        await page.click("#size")
        await page.waitForTimeout(50) // Wait for animation frame
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, 660, 0)")
        await expect(firstItem).toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, -1320, 0)"
        )
        await expect(page.locator("#one-item-stretch ul li")).toHaveCount(4)

        await page.click("#size")
        await page.waitForTimeout(50) // Wait for animation frame
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, 520, 0)")
        await expect(page.locator("#one-item-stretch ul li")).toHaveCount(9)
    })

    test("Ticker clones 2 items correctly", async ({ page }) => {
        const ul = page.locator("#two-items ul")
        const firstItem = page.locator("#two-items ul li:first-child")
        const secondItem = page.locator("#two-items ul li:nth-child(2)")

        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, 440, 0)")

        await expect(page.locator("#one-item ul li")).toHaveCount(10)

        await page.click("#size")
        await page.waitForTimeout(50) // Wait for animation frame
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, 440, 0)")
        await expect(firstItem).toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, -1100, 0)"
        )
        await expect(page.locator("#one-item ul li")).toHaveCount(10)

        await page.click("#size")
        await page.waitForTimeout(50) // Wait for animation frame
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, 660, 0)")
        await expect(firstItem).toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, -1100, 0)"
        )
        expect(secondItem).toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, -1100, 0)"
        )
        await expect(page.locator("#two-items ul li")).toHaveCount(10)
    })

    test("Ticker clones 6 items correctly", async ({ page }) => {
        const ul = page.locator("#six-items ul")
        // Check that the ul has translateX of -110px (100px width + 10px default gap)
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, 660, 0)")

        const firstItem = page.locator("#six-items ul li:first-child")
        const lastItem = page.locator("#six-items ul li:last-child")

        // Check that the first item has translateX of 550px
        await expect(firstItem).toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, -1320, 0)"
        )

        // Check that the last item has translateX of 660px
        await expect(lastItem).toHaveCSS("transform", "none")

        // Check that there are 6 li children in total
        await expect(page.locator("#six-items ul li")).toHaveCount(12)
    })
})

test.describe("Ticker cloning and positioning, y axis", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto("/tests/TickerCloneY")
        await page.waitForTimeout(200) // Wait for ticker to initialize
    })

    test("Ticker clones 1 item correctly, responds to resize", async ({
        page,
    }) => {
        const ul = page.locator("#one-item ul")
        const firstItem = page.locator("#one-item ul li:first-child")

        // Check that the ul has translateY of -150px (140px height + 10px default gap)
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, -150)")

        // Check that the first item has translateY of 550px
        await expect(firstItem).toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, 0, 750)"
        )

        // Check that there are 5 li children in total
        await expect(page.locator("#one-item ul li")).toHaveCount(5)

        await page.click("#move")
        await page.waitForTimeout(50) // Wait for animation frame
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, -100)")
        await expect(firstItem).toHaveCSS("transform", "none")

        // Check the carousel responds to changes in height
        await page.click("#size")
        await page.waitForTimeout(50) // Wait for animation frame
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, -100)")
        await expect(firstItem).toHaveCSS("transform", "none")
        await expect(page.locator("#one-item ul li")).toHaveCount(4)
    })

    test("Ticker clones 2 items correctly, responds to resize", async ({
        page,
    }) => {
        const ul = page.locator("#two-items ul")
        // Check that the ul has translateY of -300px (140px height + 10px default gap) * 2
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, -300)")

        const firstItem = page.locator("#two-items ul li:first-child")
        const secondItem = page.locator("#two-items ul li:nth-child(2)")

        // Check that the first item has translateY of 900px
        await expect(firstItem).toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, 0, 900)"
        )

        // Check that the second item has translateY of 900px
        await expect(secondItem).toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, 0, 900)"
        )

        // Check that there are 6 li children in total
        await expect(page.locator("#two-items ul li")).toHaveCount(6)

        // Check the ticker responds to changes in offset
        await page.click("#move")
        await page.waitForTimeout(50) // Wait for animation frame
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, -100)")
        await expect(firstItem).toHaveCSS("transform", "none")

        // Check the carousel responds to changes in height
        await page.click("#size")
        await page.waitForTimeout(50) // Wait for animation frame
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, -100)")
        await expect(firstItem).toHaveCSS("transform", "none")
        await expect(page.locator("#two-items ul li")).toHaveCount(4)
    })

    test("Ticker doesn't clone children when it can translate items to fill the space, responds to resize", async ({
        page,
    }) => {
        const ul = page.locator("#six-items ul")
        // Check that the ul has translateY of -900px (140px height + 10px default gap) * 6
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, -900)")

        const firstItem = page.locator("#six-items ul li:first-child")
        const lastItem = page.locator("#six-items ul li:last-child")

        // Check that the first item has translateY of 900px
        await expect(firstItem).toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, 0, 900)"
        )

        // Check that the last item has translateY of 900px
        await expect(lastItem).toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, 0, 900)"
        )

        // Check that there are 6 li children in total
        await expect(page.locator("#six-items ul li")).toHaveCount(6)
    })
})

test.describe("Ticker cap clone amounts", () => {
    test("Ticker doesn't infinite clone when parent width is unbounded", async ({
        page,
    }) => {
        await page.goto("/tests/TickerInfiniteClone")
        await page.waitForTimeout(1000)
        const li = page.locator("#infinite-clone li")
        const count = await li.count()
        expect(count).toBeLessThan(20)
    })
})

test.describe("Ticker animation", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto("/tests/TickerAnimation")
        await page.waitForTimeout(200) // Wait for ticker to initialize
    })

    test("On-screen ticker autoplays, stops when out of view", async ({
        page,
    }) => {
        const ul = page.locator("#autoplay ul")

        // Get initial transform value
        const initialTransform = await ul.evaluate(
            (el) => getComputedStyle(el).transform
        )

        // Wait for animation to progress
        await page.waitForTimeout(100)

        // Get transform value after 40ms
        const laterTransform = await ul.evaluate(
            (el) => getComputedStyle(el).transform
        )

        // Ensure the transform values are different (ticker is animating)
        expect(initialTransform).not.toBe(laterTransform)

        await expect(page.locator("#autoplay ul li")).toHaveCount(6)

        // Scroll to bottom to move on-screen ticker out of view
        await page.evaluate(() =>
            window.scrollTo(0, document.body.scrollHeight)
        )
        await page.waitForTimeout(100) // Wait for scroll and potential animation end

        await expect(page.locator("#autoplay ul li")).toHaveCount(6)

        // Now get transform values after scrolling into view
        const afterScrollInitialTransform = await ul.evaluate(
            (el) => getComputedStyle(el).transform
        )

        await page.waitForTimeout(100)

        const afterScrollLaterTransform = await ul.evaluate(
            (el) => getComputedStyle(el).transform
        )

        // Ensure the ticker is not animating after being scrolled out of view
        expect(afterScrollInitialTransform).toBe(afterScrollLaterTransform)
    })

    test("Off-screen ticker doesn't play when off-screen, starts when on-screen", async ({
        page,
    }) => {
        const ul = page.locator("#off-screen ul")

        // Get initial transform value
        const initialTransform = await ul.evaluate(
            (el) => getComputedStyle(el).transform
        )

        // Wait for animation to progress
        await page.waitForTimeout(40)

        // Get transform value after 40ms
        const laterTransform = await ul.evaluate(
            (el) => getComputedStyle(el).transform
        )

        // Ensure the transform values are the same (ticker is not animating)
        expect(initialTransform).toBe(laterTransform)

        await expect(page.locator("#off-screen ul li")).toHaveCount(2)

        // Scroll to bottom to bring the off-screen ticker into view
        await page.evaluate(() =>
            window.scrollTo(0, document.body.scrollHeight)
        )
        await page.waitForTimeout(100) // Wait for scroll and potential animation start

        await expect(page.locator("#off-screen ul li")).toHaveCount(6)

        // Now get transform values after scrolling into view
        const afterScrollInitialTransform = await ul.evaluate(
            (el) => getComputedStyle(el).transform
        )

        await page.waitForTimeout(100)

        const afterScrollLaterTransform = await ul.evaluate(
            (el) => getComputedStyle(el).transform
        )

        // Ensure the ticker is now animating after being scrolled into view
        expect(afterScrollInitialTransform).not.toBe(afterScrollLaterTransform)
    })
})

test.describe("Ticker animation, RTL", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto("/tests/TickerAnimationRTL")
        await page.waitForTimeout(200) // Wait for ticker to initialize
    })

    test("Ticker animation is reversed in RTL mode", async ({ page }) => {
        const ul = page.locator("#autoplay ul")

        // Get initial bounding box (left position)
        const initialBox = await ul.boundingBox()
        // Wait for animation to progress a little
        await page.waitForTimeout(20)
        // Get bounding box again
        const laterBox = await ul.boundingBox()

        // In RTL mode, animation should move the ticker to the right (larger x)
        expect(laterBox!.x).toBeGreaterThan(initialBox!.x)
    })
})

test.describe("Ticker keyboard accessibility", () => {
    test.skip(
        ({ browserName }) => browserName === "webkit",
        "Skipping test in WebKit, focus detection doesn't work"
    )

    test.beforeEach(async ({ page }) => {
        await page.goto("/tests/TickerKeyboard")
        await page.waitForTimeout(200) // Wait for ticker to initialize
    })

    test("Tab will only focus the first focusable item", async ({ page }) => {
        const firstButton = page.locator("#a")
        const lastButton = page.locator("#b")
        const firstLink = page.locator(
            ".ticker-item > div > [data-linkid='link-0-a']"
        )

        await page.keyboard.press("Tab") // Tab to h1
        await page.keyboard.press("Tab")
        await expect(firstButton).toBeFocused()

        await page.keyboard.press("Tab")
        await expect(firstLink).toBeFocused()

        // Ensure ticker stops animating with focus
        const ul = page.locator("#ticker ul")
        // Now get transform values after scrolling into view
        const focusedInitialTransform = await ul.evaluate(
            (el) => getComputedStyle(el).transform
        )

        await page.waitForTimeout(100)

        const focusedLaterTransform = await ul.evaluate(
            (el) => getComputedStyle(el).transform
        )

        // Ensure the ticker is not animating after being tabbed into
        expect(focusedInitialTransform).toBe(focusedLaterTransform)

        await page.keyboard.press("Tab")
        await expect(lastButton).toBeFocused()

        // Now get transform values after scrolling into view
        const blurredInitialTransform = await ul.evaluate(
            (el) => getComputedStyle(el).transform
        )

        await page.waitForTimeout(100)

        const blurredLaterTransform = await ul.evaluate(
            (el) => getComputedStyle(el).transform
        )

        // Ensure the ticker is animating again after being tabbed out
        expect(blurredInitialTransform).not.toBe(blurredLaterTransform)
    })

    test("Shift-tab will tab back out of ticker", async ({ page }) => {
        const firstButton = page.locator("#a")
        const firstLink = page.locator(
            ".ticker-item > div > [data-linkid='link-0-a']"
        )

        await page.keyboard.press("Tab") // Tab to h1
        await page.keyboard.press("Tab")
        await expect(firstButton).toBeFocused()

        await page.keyboard.press("Tab")
        await expect(firstLink).toBeFocused()

        await page.keyboard.press("Shift+Tab")
        await expect(firstButton).toBeFocused()
    })

    test("Arrow right will focus the next focusable item, loop within ticker", async ({
        page,
    }) => {
        const firstButton = page.locator("#a")
        const links = page.locator("[data-linkid]")

        await page.keyboard.press("Tab") // Tab to h1
        await page.keyboard.press("Tab")
        await expect(firstButton).toBeFocused()

        await page.keyboard.press("Tab")
        await expect(links.first()).toBeFocused()

        await page.keyboard.press("ArrowRight")
        await expect(links.nth(1)).toBeFocused()

        await page.keyboard.press("ArrowRight")
        await expect(links.nth(2)).toBeFocused()

        await page.keyboard.press("ArrowRight")
        await expect(links.nth(3)).toBeFocused()

        await page.keyboard.press("ArrowRight")
        await expect(links.first()).toBeFocused()
    })

    test("Arrow left will focus the next focusable item, loop within ticker", async ({
        page,
    }) => {
        const firstButton = page.locator("#a")
        const links = page.locator("[data-linkid]")

        await page.keyboard.press("Tab") // Tab to h1
        await page.keyboard.press("Tab")
        await expect(firstButton).toBeFocused()

        await page.keyboard.press("Tab")
        await expect(links.first()).toBeFocused()

        await page.keyboard.press("ArrowLeft")
        await expect(links.nth(3)).toBeFocused()

        await page.keyboard.press("ArrowLeft")
        await expect(links.nth(2)).toBeFocused()

        await page.keyboard.press("ArrowLeft")
        await expect(links.nth(1)).toBeFocused()

        await page.keyboard.press("ArrowLeft")
        await expect(links.first()).toBeFocused()
    })
})

test.describe("Ticker useTickerItem", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto("/tests/TickerUseTickerItem")
        await page.waitForTimeout(200) // Wait for ticker to initialize
    })

    test("Check opacity is set correctly", async ({ page }) => {
        const item = page.locator("#item").first()
        await expect(item).toHaveCSS("opacity", "0")
        const item2 = page.locator("#item").nth(1)
        await expect(item2).toHaveCSS("opacity", "1")
        const item3 = page.locator("#item").nth(2)
        await expect(item3).toHaveCSS("opacity", "0.725")
        const item4 = page.locator("#item").nth(3)
        await expect(item4).toHaveCSS("opacity", "0.45")
        const item5 = page.locator("#item").nth(4)
        await expect(item5).toHaveCSS("opacity", "0.175")
        const item6 = page.locator("#item").nth(5)
        await expect(item6).toHaveCSS("opacity", "0")

        await page.click("#move")
        await expect(item).toHaveCSS("opacity", "0")
        await expect(item2).toHaveCSS("opacity", "0.975")
        await expect(item3).toHaveCSS("opacity", "0.7")
        await expect(item4).toHaveCSS("opacity", "0.425")
        await expect(item5).toHaveCSS("opacity", "0.15")
        await expect(item6).toHaveCSS("opacity", "0")
    })
})

test.describe("Ticker useTickerItem RTL", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto("/tests/TickerUseTickerItemRTL")
        await page.waitForTimeout(200) // Wait for ticker to initialize
    })

    test("Check opacity is set correctly", async ({ page }) => {
        const item = page.locator("#item").first()
        await expect(item).toHaveCSS("opacity", "0")
        const item2 = page.locator("#item").nth(1)
        await expect(item2).toHaveCSS("opacity", "1")
        const item3 = page.locator("#item").nth(2)
        await expect(item3).toHaveCSS("opacity", "0.725")
        const item4 = page.locator("#item").nth(3)
        await expect(item4).toHaveCSS("opacity", "0.45")
        const item5 = page.locator("#item").nth(4)
        await expect(item5).toHaveCSS("opacity", "0.175")
        const item6 = page.locator("#item").nth(5)
        await expect(item6).toHaveCSS("opacity", "0")

        await page.click("#move")
        await expect(item).toHaveCSS("opacity", "1")
        await expect(item2).toHaveCSS("opacity", "0.75")
        await expect(item3).toHaveCSS("opacity", "0.475")
        await expect(item4).toHaveCSS("opacity", "0.2")
        await expect(item5).toHaveCSS("opacity", "0")
        await expect(item6).toHaveCSS("opacity", "0")
    })
})

test.describe("Ticker change children size", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto("/tests/TickerChangeChildren")
        await page.waitForTimeout(200) // Wait for ticker to initialize
    })

    test("Check item is in correct place after changing size", async ({
        page,
    }) => {
        const ul = page.locator("#one-item ul")
        const firstItem = page.locator("#one-item ul li:first-child")
        await expect(firstItem).toHaveCSS("width", "100px")

        await page.click("#size")
        await expect(firstItem).toHaveCSS("width", "200px")

        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, -210, 0)")

        await expect(firstItem).toHaveCSS(
            "transform",
            "matrix(1, 0, 0, 1, 840, 0)"
        )
        const secondItem = page.locator("#one-item ul li:nth-child(2)")
        await expect(secondItem).toHaveCSS("width", "200px")
        await expect(secondItem).toHaveCSS("transform", "none")
    })
})

test.describe("Ticker with padding", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto("/tests/TickerPadding")
        await page.waitForTimeout(200) // Wait for ticker to initialize
    })

    test("Clones the correct number of items and positions correctly, x axis", async ({
        page,
    }) => {
        const ul = page.locator("#x ul")
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, -110, 0)")
        await expect(page.locator("#x ul li")).toHaveCount(6)
        const firstItem = page.locator("#x ul li:first-child")
        await expect(firstItem).toHaveCSS("transform", "none")
    })

    test("Clones the correct number of items and positions correctly, y axis", async ({
        page,
    }) => {
        const ul = page.locator("#y ul")
        await expect(ul).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, -110)")
        await expect(page.locator("#x ul li")).toHaveCount(6)
        const firstItem = page.locator("#y ul li:first-child")
        await expect(firstItem).toHaveCSS("transform", "none")
    })

    test("Max inset is calculated correctly", async ({ page }) => {
        const firstItem = page.locator("#x-loop-disabled ul li:first-child")
        await expect(firstItem).not.toHaveText("390")
        await expect(firstItem).toHaveText("790")
    })
})

test.describe("Ticker static mode", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto("/tests/TickerStatic")
        await page.waitForTimeout(200) // Wait for ticker to initialize
    })

    test("Check ticker is not animating or has measured size", async ({
        page,
    }) => {
        const ul = page.locator("#x ul")

        // Get initial transform value
        const initialTransform = await ul.evaluate(
            (el) => getComputedStyle(el).transform
        )

        // Wait for animation to progress
        await page.waitForTimeout(100)

        // Get transform value after 40ms
        const laterTransform = await ul.evaluate(
            (el) => getComputedStyle(el).transform
        )

        // Ensure the transform values are different (ticker is animating)
        expect(initialTransform).toBe(laterTransform)
        expect(initialTransform).toBe("none")
    })

    test("Check initial ticker opacity is 1", async ({ page }) => {
        const ul = page.locator("#x ul")
        await expect(ul).toHaveCSS("opacity", "1")
    })

    test("Check only one child is visible", async ({ page }) => {
        await expect(page.locator("#x ul li")).toHaveCount(1)
    })
})

test.describe("Ticker alignment settings", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto("/tests/TickerAlign")
        await page.waitForTimeout(200) // Wait for ticker to initialize
    })

    test("Check ticker is aligned correctly: x flex-start", async ({
        page,
    }) => {
        const items = page.locator("#x-start li")
        await expect(items).toHaveCount(6)

        // Get the first three items
        const firstItem = items.nth(0)
        const secondItem = items.nth(1)
        const thirdItem = items.nth(2)

        // Check that all items have the same top position (aligned to start)
        const firstTop = await firstItem.evaluate(
            (el) => el.getBoundingClientRect().top
        )
        const secondTop = await secondItem.evaluate(
            (el) => el.getBoundingClientRect().top
        )
        const thirdTop = await thirdItem.evaluate(
            (el) => el.getBoundingClientRect().top
        )

        expect(firstTop).toBe(secondTop)
        expect(secondTop).toBe(thirdTop)

        // Check that all items have different bottom positions (different heights)
        const firstBottom = await firstItem.evaluate(
            (el) => el.getBoundingClientRect().bottom
        )
        const secondBottom = await secondItem.evaluate(
            (el) => el.getBoundingClientRect().bottom
        )
        const thirdBottom = await thirdItem.evaluate(
            (el) => el.getBoundingClientRect().bottom
        )

        expect(firstBottom).not.toBe(secondBottom)
        expect(secondBottom).not.toBe(thirdBottom)
        expect(firstBottom).not.toBe(thirdBottom)
    })

    test("Check ticker is aligned correctly: x center", async ({ page }) => {
        const items = page.locator("#x-center li")
        await expect(items).toHaveCount(6)

        // Get the first three items
        const firstItem = items.nth(0)
        const secondItem = items.nth(1)
        const thirdItem = items.nth(2)

        // Check that all items have the same top position (aligned to start)
        const firstTop = await firstItem.evaluate(
            (el) => el.getBoundingClientRect().top
        )
        const secondTop = await secondItem.evaluate(
            (el) => el.getBoundingClientRect().top
        )
        const thirdTop = await thirdItem.evaluate(
            (el) => el.getBoundingClientRect().top
        )

        expect(firstTop).not.toBe(secondTop)
        expect(secondTop).not.toBe(thirdTop)
        expect(firstTop).not.toBe(thirdTop)

        // Check that all items have different bottom positions (different heights)
        const firstBottom = await firstItem.evaluate(
            (el) => el.getBoundingClientRect().bottom
        )
        const secondBottom = await secondItem.evaluate(
            (el) => el.getBoundingClientRect().bottom
        )
        const thirdBottom = await thirdItem.evaluate(
            (el) => el.getBoundingClientRect().bottom
        )

        expect(firstBottom).not.toBe(secondBottom)
        expect(secondBottom).not.toBe(thirdBottom)
        expect(firstBottom).not.toBe(thirdBottom)
    })

    test("Check ticker is aligned correctly: x flex-end", async ({ page }) => {
        const items = page.locator("#x-end li")
        await expect(items).toHaveCount(6)

        // Get the first three items
        const firstItem = items.nth(0)
        const secondItem = items.nth(1)
        const thirdItem = items.nth(2)

        // Check that all items have the same top position (aligned to start)
        const firstTop = await firstItem.evaluate(
            (el) => el.getBoundingClientRect().top
        )
        const secondTop = await secondItem.evaluate(
            (el) => el.getBoundingClientRect().top
        )
        const thirdTop = await thirdItem.evaluate(
            (el) => el.getBoundingClientRect().top
        )

        expect(firstTop).not.toBe(secondTop)
        expect(secondTop).not.toBe(thirdTop)
        expect(firstTop).not.toBe(thirdTop)

        // Check that all items have different bottom positions (different heights)
        const firstBottom = await firstItem.evaluate(
            (el) => el.getBoundingClientRect().bottom
        )
        const secondBottom = await secondItem.evaluate(
            (el) => el.getBoundingClientRect().bottom
        )
        const thirdBottom = await thirdItem.evaluate(
            (el) => el.getBoundingClientRect().bottom
        )

        expect(firstBottom).toBe(secondBottom)
        expect(secondBottom).toBe(thirdBottom)
        expect(firstBottom).toBe(thirdBottom)
    })

    test("Check ticker is aligned correctly: x stretch", async ({ page }) => {
        const items = page.locator("#x-stretch li")
        await expect(items).toHaveCount(6)

        // Get the first three items
        const firstItem = items.nth(0)
        const secondItem = items.nth(1)
        const thirdItem = items.nth(2)

        // Check that all items have the same top position (aligned to start)
        const firstTop = await firstItem.evaluate(
            (el) => el.getBoundingClientRect().top
        )
        const secondTop = await secondItem.evaluate(
            (el) => el.getBoundingClientRect().top
        )
        const thirdTop = await thirdItem.evaluate(
            (el) => el.getBoundingClientRect().top
        )

        expect(firstTop).toBe(secondTop)
        expect(secondTop).toBe(thirdTop)
        expect(firstTop).toBe(thirdTop)

        // Check that all items have different bottom positions (different heights)
        const firstBottom = await firstItem.evaluate(
            (el) => el.getBoundingClientRect().bottom
        )
        const secondBottom = await secondItem.evaluate(
            (el) => el.getBoundingClientRect().bottom
        )
        const thirdBottom = await thirdItem.evaluate(
            (el) => el.getBoundingClientRect().bottom
        )

        expect(firstBottom).toBe(secondBottom)
        expect(secondBottom).toBe(thirdBottom)
        expect(firstBottom).toBe(thirdBottom)
    })

    test("Check ticker is aligned correctly: y flex-start", async ({
        page,
    }) => {
        await page.evaluate(() => window.scrollTo(0, 10000))
        await page.waitForTimeout(100)
        const items = page.locator("#y-start li")
        await expect(items).toHaveCount(6)

        // Get the first three items
        const firstItem = items.nth(0)
        const secondItem = items.nth(1)
        const thirdItem = items.nth(2)

        // Check that all items have the same left position (aligned to start)
        const firstLeft = await firstItem.evaluate(
            (el) => el.getBoundingClientRect().left
        )
        const secondLeft = await secondItem.evaluate(
            (el) => el.getBoundingClientRect().left
        )
        const thirdLeft = await thirdItem.evaluate(
            (el) => el.getBoundingClientRect().left
        )

        expect(firstLeft).toBe(secondLeft)
        expect(secondLeft).toBe(thirdLeft)

        // Check that all items have different right positions (different heights)
        const firstRight = await firstItem.evaluate(
            (el) => el.getBoundingClientRect().right
        )
        const secondRight = await secondItem.evaluate(
            (el) => el.getBoundingClientRect().right
        )
        const thirdRight = await thirdItem.evaluate(
            (el) => el.getBoundingClientRect().right
        )

        expect(firstRight).not.toBe(secondRight)
        expect(secondRight).not.toBe(thirdRight)
        expect(firstRight).not.toBe(thirdRight)
    })

    test("Check ticker is aligned correctly: y center", async ({ page }) => {
        await page.evaluate(() => window.scrollTo(0, 10000))
        await page.waitForTimeout(100)
        const items = page.locator("#y-center li")
        await expect(items).toHaveCount(6)

        // Get the first three items
        const firstItem = items.nth(0)
        const secondItem = items.nth(1)
        const thirdItem = items.nth(2)

        // Check that all items have the same left position (aligned to start)
        const firstLeft = await firstItem.evaluate(
            (el) => el.getBoundingClientRect().left
        )
        const secondLeft = await secondItem.evaluate(
            (el) => el.getBoundingClientRect().left
        )
        const thirdLeft = await thirdItem.evaluate(
            (el) => el.getBoundingClientRect().left
        )

        expect(firstLeft).not.toBe(secondLeft)
        expect(secondLeft).not.toBe(thirdLeft)
        expect(firstLeft).not.toBe(thirdLeft)

        // Check that all items have different right positions (different heights)
        const firstRight = await firstItem.evaluate(
            (el) => el.getBoundingClientRect().right
        )
        const secondRight = await secondItem.evaluate(
            (el) => el.getBoundingClientRect().right
        )
        const thirdRight = await thirdItem.evaluate(
            (el) => el.getBoundingClientRect().right
        )

        expect(firstRight).not.toBe(secondRight)
        expect(secondRight).not.toBe(thirdRight)
        expect(firstRight).not.toBe(thirdRight)
    })

    test("Check ticker is aligned correctly: y flex-end", async ({ page }) => {
        await page.evaluate(() => window.scrollTo(0, 10000))
        await page.waitForTimeout(100)
        const items = page.locator("#y-end li")
        await expect(items).toHaveCount(6)

        // Get the first three items
        const firstItem = items.nth(0)
        const secondItem = items.nth(1)
        const thirdItem = items.nth(2)

        // Check that all items have the same left position (aligned to start)
        const firstLeft = await firstItem.evaluate(
            (el) => el.getBoundingClientRect().left
        )
        const secondLeft = await secondItem.evaluate(
            (el) => el.getBoundingClientRect().left
        )
        const thirdLeft = await thirdItem.evaluate(
            (el) => el.getBoundingClientRect().left
        )

        expect(firstLeft).not.toBe(secondLeft)
        expect(secondLeft).not.toBe(thirdLeft)
        expect(firstLeft).not.toBe(thirdLeft)

        // Check that all items have different right positions (different heights)
        const firstRight = await firstItem.evaluate(
            (el) => el.getBoundingClientRect().right
        )
        const secondRight = await secondItem.evaluate(
            (el) => el.getBoundingClientRect().right
        )
        const thirdRight = await thirdItem.evaluate(
            (el) => el.getBoundingClientRect().right
        )

        expect(firstRight).toBe(secondRight)
        expect(secondRight).toBe(thirdRight)
        expect(firstRight).toBe(thirdRight)
    })

    test("Check ticker is aligned correctly: y stretch", async ({ page }) => {
        await page.evaluate(() => window.scrollTo(0, 10000))
        await page.waitForTimeout(100)
        const items = page.locator("#y-stretch li")
        await expect(items).toHaveCount(6)

        // Get the first three items
        const firstItem = items.nth(0)
        const secondItem = items.nth(1)
        const thirdItem = items.nth(2)

        // Check that all items have the same left position (aligned to start)
        const firstLeft = await firstItem.evaluate(
            (el) => el.getBoundingClientRect().left
        )
        const secondLeft = await secondItem.evaluate(
            (el) => el.getBoundingClientRect().left
        )
        const thirdLeft = await thirdItem.evaluate(
            (el) => el.getBoundingClientRect().left
        )

        expect(firstLeft).toBe(secondLeft)
        expect(secondLeft).toBe(thirdLeft)
        expect(firstLeft).toBe(thirdLeft)

        // Check that all items have different right positions (different heights)
        const firstRight = await firstItem.evaluate(
            (el) => el.getBoundingClientRect().right
        )
        const secondRight = await secondItem.evaluate(
            (el) => el.getBoundingClientRect().right
        )
        const thirdRight = await thirdItem.evaluate(
            (el) => el.getBoundingClientRect().right
        )

        expect(firstRight).toBe(secondRight)
        expect(secondRight).toBe(thirdRight)
        expect(firstRight).toBe(thirdRight)
    })
})

test.describe("Ticker item size settings", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto("/tests/TickerItemSize")
        await page.waitForTimeout(200) // Wait for ticker to initialize
    })

    test("Check ticker is aligned correctly: x fill", async ({ page }) => {
        const container = page.locator("#x-start ul")
        const items = page.locator("#x-start li")

        await expect(items).toHaveCount(3)

        // Get the first item and container
        const firstItem = items.nth(0)
        const containerRect = await container.evaluate((el) =>
            el.getBoundingClientRect()
        )
        const firstItemRect = await firstItem.evaluate((el) =>
            el.getBoundingClientRect()
        )

        // Check that the first item has the same width as the container
        expect(firstItemRect.width).toBe(containerRect.width)
    })

    test("Check ticker is aligned correctly: y fill", async ({ page }) => {
        const container = page.locator("#y-start ul")
        const items = page.locator("#y-start li")

        await expect(items).toHaveCount(3)

        // Get the first item and container
        const firstItem = items.nth(0)
        const containerRect = await container.evaluate((el) =>
            el.getBoundingClientRect()
        )
        const firstItemRect = await firstItem.evaluate((el) =>
            el.getBoundingClientRect()
        )

        // Check that the first item has the same width as the container
        expect(firstItemRect.height).toBe(containerRect.height)
    })
})

test.describe("Ticker relative children", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto("/tests/TickerRelativeChildren")
        await page.waitForTimeout(200) // Wait for ticker to initialize
    })

    test("Check ticker items can be manually sized relative to the container", async ({
        page,
    }) => {
        const firstItem = page.locator("#one-item li:first-child")
        await expect(firstItem).toHaveCSS("width", "52px")

        const secondItem = page.locator("#two-items li:nth-child(2)")
        await expect(secondItem).toHaveCSS("width", "104px")

        const thirdItem = page.locator("#six-items li:nth-child(3)")
        await expect(thirdItem).toHaveCSS("width", "156px")
    })
})

test.describe("Ticker safe margin", () => {
    test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 1000, height: 1000 })
        await page.goto("/tests/TickerSafeMargin")
        await page.waitForTimeout(200) // Wait for ticker to initialize
    })

    test("Check ticker clones the correct number of items: X axis", async ({
        page,
    }) => {
        const items = page.locator("#x ul li")
        await expect(items).toHaveCount(10)
    })

    test("Check ticker clones the correct number of items: X axis overflow", async ({
        page,
    }) => {
        const items = page.locator("#x-overflow ul li")
        await expect(items).toHaveCount(14)
    })

    test("Check ticker clones the correct number of items: Y axis", async ({
        page,
    }) => {
        const items = page.locator("#y ul li")
        await expect(items).toHaveCount(10)
    })

    // Helper to DRY getting the x or y transform value (in px) or "none"
    async function getMatrixTransforms(itemsLocator, axis = "x") {
        // axis: "x" for translateX, "y" for translateY
        return itemsLocator.evaluateAll(
            (els, axisArg) =>
                els.map((el) => {
                    const transform = getComputedStyle(el).transform
                    // Matrix: matrix(1, 0, 0, 1, tx, ty)
                    if (transform && transform !== "none") {
                        const match = transform.match(
                            /matrix\(.*?,.*?,.*?,.*?, ([-\d.]+), ([-\d.]+)\)/
                        )
                        if (!match) return transform
                        // For x axis, use match[1]; for y axis, use match[2]
                        if (axisArg === "x") {
                            return `${parseFloat(match[1])}px`
                        } else {
                            return `${parseFloat(match[2])}px`
                        }
                    }
                    return "none"
                }),
            axis
        )
    }

    test("Check ticker projects items backwards if they fall outside the right boundary: X axis", async ({
        page,
    }) => {
        const items = page.locator("#x ul li")
        const transforms = await getMatrixTransforms(items, "x")
        expect(transforms[transforms.length - 3]).toBe("none")
        expect(transforms[transforms.length - 2]).toBe("-1100px")
        expect(transforms[transforms.length - 1]).toBe("-1100px")
    })

    test("Check ticker projects items backwards if they fall outside the right boundary: X axis overflow", async ({
        page,
    }) => {
        const items = page.locator("#x-overflow ul li")
        const transforms = await getMatrixTransforms(items, "x")
        expect(transforms[transforms.length - 3]).toBe("none")
        expect(transforms[transforms.length - 2]).toBe("-1540px")
        expect(transforms[transforms.length - 1]).toBe("-1540px")
    })

    test("Check ticker projects items backwards if they fall outside the right boundary: Y axis", async ({
        page,
    }) => {
        const items = page.locator("#y ul li")
        const transforms = await getMatrixTransforms(items, "y")
        expect(transforms[transforms.length - 3]).toBe("none")
        expect(transforms[transforms.length - 2]).toBe("-1100px")
        expect(transforms[transforms.length - 1]).toBe("-1100px")
    })
})

test.describe("Ticker fade", () => {
    test("Check ticker has the correct fade styles: X axis", async ({
        page,
    }) => {
        await page.goto("/tests/TickerFadeX")
        await page.waitForTimeout(200) // Wait for ticker to initialize

        const noneContainer = page.locator("#fade-none")
        await expect(noneContainer).toHaveCSS("mask-image", "none")

        const pxContainer = page.locator("#fade-px")
        // Check the mask-image style applied directly in the style attribute
        const pxMaskImage = await pxContainer.evaluate(
            (el) => el.style.maskImage
        )
        expect(pxMaskImage).toBe(
            "linear-gradient(to right, rgba(0, 0, 0, 0) 0px, black 10px, black calc(100% - 10px), rgba(0, 0, 0, 0) 100%)"
        )

        const percentContainer = page.locator("#fade-percent")
        const percentMaskImage = await percentContainer.evaluate(
            (el) => el.style.maskImage
        )
        expect(percentMaskImage).toBe(
            "linear-gradient(to right, rgba(0, 0, 0, 0) 0px, black 10%, black calc(90%), rgba(0, 0, 0, 0) 100%)"
        )

        const loopDisabledContainer = page.locator("#fade-edge")
        // Check the mask-image style applied directly in the style attribute
        const loopDisabledMaskImage = await loopDisabledContainer.evaluate(
            (el) => el.style.maskImage
        )
        expect(loopDisabledMaskImage).toBe(
            "linear-gradient(to right, rgb(0, 0, 0) 0px, black 10px, black calc(100% - 10px), rgba(0, 0, 0, 0) 100%)"
        )

        // Click the "move" button, wait 300ms, then check new mask-image for fade-px (should fade out on the right)
        await page.click("#move")
        await page.waitForTimeout(300)
        const pxMaskImageAfterMove = await pxContainer.evaluate(
            (el) => el.style.maskImage
        )
        expect(pxMaskImageAfterMove).toBe(
            "linear-gradient(to right, rgba(0, 0, 0, 0) 0px, black 10px, black calc(100% - 10px), rgba(0, 0, 0, 0) 100%)"
        )

        const disabledMaskAfterMove = await loopDisabledContainer.evaluate(
            (el) => el.style.maskImage
        )
        expect(disabledMaskAfterMove).toBe(
            "linear-gradient(to right, rgba(0, 0, 0, 0) 0px, black 10px, black calc(100% - 10px), rgba(0, 0, 0, 0) 100%)"
        )

        await page.click("#move-back")
        await page.waitForTimeout(300)

        const disabledMaskAfterMoveBack = await loopDisabledContainer.evaluate(
            (el) => el.style.maskImage
        )
        expect(disabledMaskAfterMoveBack).toBe(
            "linear-gradient(to right, rgb(0, 0, 0) 0px, black 10px, black calc(100% - 10px), rgba(0, 0, 0, 0) 100%)"
        )
        await page.click("#move")
        await page.click("#move")
        await page.click("#move")
        await page.waitForTimeout(300)
        const disabledMaskAfterFinalMove = await loopDisabledContainer.evaluate(
            (el) => el.style.maskImage
        )
        expect(disabledMaskAfterFinalMove).toBe(
            "linear-gradient(to right, rgba(0, 0, 0, 0) 0px, black 10px, black calc(100% - 10px), rgb(0, 0, 0) 100%)"
        )
        await page.click("#move-back")
        await page.waitForTimeout(300)

        const disabledMaskAfterFinalMoveBack =
            await loopDisabledContainer.evaluate((el) => el.style.maskImage)
        expect(disabledMaskAfterFinalMoveBack).toBe(
            "linear-gradient(to right, rgba(0, 0, 0, 0) 0px, black 10px, black calc(100% - 10px), rgba(0, 0, 0, 0) 100%)"
        )
    })

    test("Check ticker has the correct fade styles: Y axis", async ({
        page,
    }) => {
        await page.goto("/tests/TickerFadeY")
        await page.waitForTimeout(200) // Wait for ticker to initialize

        const noneContainer = page.locator("#fade-none")
        await expect(noneContainer).toHaveCSS("mask-image", "none")

        const pxContainer = page.locator("#fade-px")
        // Check the mask-image style applied directly in the style attribute
        const pxMaskImage = await pxContainer.evaluate(
            (el) => el.style.maskImage
        )
        expect(pxMaskImage).toBe(
            "linear-gradient(rgba(0, 0, 0, 0) 0px, black 10px, black calc(100% - 10px), rgba(0, 0, 0, 0) 100%)"
        )

        const percentContainer = page.locator("#fade-percent")
        const percentMaskImage = await percentContainer.evaluate(
            (el) => el.style.maskImage
        )
        expect(percentMaskImage).toBe(
            "linear-gradient(rgba(0, 0, 0, 0) 0px, black 10%, black calc(90%), rgba(0, 0, 0, 0) 100%)"
        )

        const loopDisabledContainer = page.locator("#fade-edge")
        // Check the mask-image style applied directly in the style attribute
        const loopDisabledMaskImage = await loopDisabledContainer.evaluate(
            (el) => el.style.maskImage
        )
        expect(loopDisabledMaskImage).toBe(
            "linear-gradient(rgb(0, 0, 0) 0px, black 10px, black calc(100% - 10px), rgba(0, 0, 0, 0) 100%)"
        )

        // Click the "move" button, wait 300ms, then check new mask-image for fade-px (should fade out on the right)
        await page.click("#move")
        await page.waitForTimeout(300)
        const pxMaskImageAfterMove = await pxContainer.evaluate(
            (el) => el.style.maskImage
        )
        expect(pxMaskImageAfterMove).toBe(
            "linear-gradient(rgba(0, 0, 0, 0) 0px, black 10px, black calc(100% - 10px), rgba(0, 0, 0, 0) 100%)"
        )

        const disabledMaskAfterMove = await loopDisabledContainer.evaluate(
            (el) => el.style.maskImage
        )
        expect(disabledMaskAfterMove).toBe(
            "linear-gradient(rgba(0, 0, 0, 0) 0px, black 10px, black calc(100% - 10px), rgba(0, 0, 0, 0) 100%)"
        )

        await page.click("#move-back")
        await page.waitForTimeout(300)

        const disabledMaskAfterMoveBack = await loopDisabledContainer.evaluate(
            (el) => el.style.maskImage
        )
        expect(disabledMaskAfterMoveBack).toBe(
            "linear-gradient(rgb(0, 0, 0) 0px, black 10px, black calc(100% - 10px), rgba(0, 0, 0, 0) 100%)"
        )
        await page.click("#move")
        await page.click("#move")
        await page.click("#move")
        await page.click("#move")
        await page.waitForTimeout(300)
        const disabledMaskAfterFinalMove = await loopDisabledContainer.evaluate(
            (el) => el.style.maskImage
        )
        expect(disabledMaskAfterFinalMove).toBe(
            "linear-gradient(rgba(0, 0, 0, 0) 0px, black 10px, black calc(100% - 10px), rgb(0, 0, 0) 100%)"
        )
        await page.click("#move-back")
        await page.waitForTimeout(300)

        const disabledMaskAfterFinalMoveBack =
            await loopDisabledContainer.evaluate((el) => el.style.maskImage)
        expect(disabledMaskAfterFinalMoveBack).toBe(
            "linear-gradient(rgba(0, 0, 0, 0) 0px, black 10px, black calc(100% - 10px), rgba(0, 0, 0, 0) 100%)"
        )
    })
    test("Check ticker has the correct fade styles: X axis RTL", async ({
        page,
    }) => {
        await page.goto("/tests/TickerFadeXRTL")
        await page.waitForTimeout(200) // Wait for ticker to initialize

        const noneContainer = page.locator("#fade-none")
        await expect(noneContainer).toHaveCSS("mask-image", "none")

        const pxContainer = page.locator("#fade-px")
        // Check the mask-image style applied directly in the style attribute
        const pxMaskImage = await pxContainer.evaluate(
            (el) => el.style.maskImage
        )
        expect(pxMaskImage).toBe(
            "linear-gradient(to left, rgba(0, 0, 0, 0) 0px, black 10px, black calc(100% - 10px), rgba(0, 0, 0, 0) 100%)"
        )

        const percentContainer = page.locator("#fade-percent")
        const percentMaskImage = await percentContainer.evaluate(
            (el) => el.style.maskImage
        )
        expect(percentMaskImage).toBe(
            "linear-gradient(to left, rgba(0, 0, 0, 0) 0px, black 10%, black calc(90%), rgba(0, 0, 0, 0) 100%)"
        )

        const loopDisabledContainer = page.locator("#fade-edge")
        // Check the mask-image style applied directly in the style attribute
        const loopDisabledMaskImage = await loopDisabledContainer.evaluate(
            (el) => el.style.maskImage
        )
        expect(loopDisabledMaskImage).toBe(
            "linear-gradient(to left, rgb(0, 0, 0) 0px, black 10px, black calc(100% - 10px), rgba(0, 0, 0, 0) 100%)"
        )

        // Click the "move" button, wait 300ms, then check new mask-image for fade-px (should fade out on the right)
        await page.click("#move")
        await page.waitForTimeout(300)
        const pxMaskImageAfterMove = await pxContainer.evaluate(
            (el) => el.style.maskImage
        )
        expect(pxMaskImageAfterMove).toBe(
            "linear-gradient(to left, rgba(0, 0, 0, 0) 0px, black 10px, black calc(100% - 10px), rgba(0, 0, 0, 0) 100%)"
        )

        const disabledMaskAfterMove = await loopDisabledContainer.evaluate(
            (el) => el.style.maskImage
        )
        expect(disabledMaskAfterMove).toBe(
            "linear-gradient(to left, rgba(0, 0, 0, 0) 0px, black 10px, black calc(100% - 10px), rgba(0, 0, 0, 0) 100%)"
        )

        await page.click("#move-back")
        await page.waitForTimeout(300)

        const disabledMaskAfterMoveBack = await loopDisabledContainer.evaluate(
            (el) => el.style.maskImage
        )
        expect(disabledMaskAfterMoveBack).toBe(
            "linear-gradient(to left, rgb(0, 0, 0) 0px, black 10px, black calc(100% - 10px), rgba(0, 0, 0, 0) 100%)"
        )
        await page.click("#move")
        await page.click("#move")
        await page.click("#move")
        await page.waitForTimeout(300)
        const disabledMaskAfterFinalMove = await loopDisabledContainer.evaluate(
            (el) => el.style.maskImage
        )
        expect(disabledMaskAfterFinalMove).toBe(
            "linear-gradient(to left, rgba(0, 0, 0, 0) 0px, black 10px, black calc(100% - 10px), rgb(0, 0, 0) 100%)"
        )
        await page.click("#move-back")
        await page.waitForTimeout(300)

        const disabledMaskAfterFinalMoveBack =
            await loopDisabledContainer.evaluate((el) => el.style.maskImage)
        expect(disabledMaskAfterFinalMoveBack).toBe(
            "linear-gradient(to left, rgba(0, 0, 0, 0) 0px, black 10px, black calc(100% - 10px), rgba(0, 0, 0, 0) 100%)"
        )
    })
})

import { expect, test } from "@playwright/test"

test("AnimateNumber should reposition when sibling is removed", async ({
    page,
}) => {
    // Navigate to the page with NumberLayoutDependency component
    await page.goto("/tests/NumberLayoutDependency")

    // Get initial positions of the box elements (control group)
    const boxLayoutDependencyInitial = await page
        .locator("#box-layout-dependency")
        .boundingBox()
    const boxLayoutRootInitial = await page
        .locator("#box-layout-root")
        .boundingBox()

    // Get initial positions of the number elements
    const numberLayoutDependencyInitial = await page
        .locator("#number-layout-dependency")
        .boundingBox()
    const numberLayoutRootInitial = await page
        .locator("#number-layout-root")
        .boundingBox()

    // Ensure we have all the elements
    expect(boxLayoutDependencyInitial).not.toBeNull()
    expect(boxLayoutRootInitial).not.toBeNull()
    expect(numberLayoutDependencyInitial).not.toBeNull()
    expect(numberLayoutRootInitial).not.toBeNull()

    // Click the toggle button to remove the 200px div
    await page.locator("#toggle").click()

    // Wait for DOM update
    await page.waitForTimeout(200)

    // Get new positions of box elements after toggle
    const boxLayoutDependencyAfter = await page
        .locator("#box-layout-dependency")
        .boundingBox()
    const boxLayoutRootAfter = await page
        .locator("#box-layout-root")
        .boundingBox()

    // Verify box elements have moved up by exactly 200px
    expect(boxLayoutDependencyAfter!.y).toBeCloseTo(
        boxLayoutDependencyInitial!.y - 200,
        0
    )
    expect(boxLayoutRootAfter!.y).toBeCloseTo(boxLayoutRootInitial!.y - 200, 0)

    // Get new positions of number elements after toggle
    const numberLayoutDependencyAfter = await page
        .locator("#number-layout-dependency")
        .boundingBox()
    const numberLayoutRootAfter = await page
        .locator("#number-layout-root")
        .boundingBox()

    // Verify number elements have moved up by exactly 200px
    // (AnimateNumber no longer uses layout animations, so it snaps instantly)
    expect(numberLayoutDependencyAfter!.y).toBeCloseTo(
        numberLayoutDependencyInitial!.y - 200,
        0
    )
    expect(numberLayoutRootAfter!.y).toBeCloseTo(
        numberLayoutRootInitial!.y - 200,
        0
    )
})

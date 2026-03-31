import { calcCurrentPage } from "../calc-current-page"

describe("calcCurrentPage", () => {
    describe("halfDistance boundary calculations", () => {
        const insets = [0, 100, 200, 300]
        const wrapInset = 500
        const maxInset = 400

        it("should calculate halfDistances correctly for page boundaries", () => {
            expect(calcCurrentPage(0, insets, wrapInset, maxInset)).toEqual(0)
            expect(calcCurrentPage(-49, insets, wrapInset, maxInset)).toEqual(0)
            expect(calcCurrentPage(49, insets, wrapInset, maxInset)).toEqual(0)
        })

        it("should handle transitions between pages correctly", () => {
            expect(calcCurrentPage(-50, insets, wrapInset, maxInset)).toEqual(1)
            expect(calcCurrentPage(-149, insets, wrapInset, maxInset)).toEqual(
                1
            )
            expect(calcCurrentPage(-150, insets, wrapInset, maxInset)).toEqual(
                2
            )
        })
    })

    describe("non-looping carousel (maxInset provided)", () => {
        const insets = [0, 100, 200, 300]
        const wrapInset = 500
        const maxInset = 400

        it("should correctly calculate page index for standard negative offsets", () => {
            expect(calcCurrentPage(0, insets, wrapInset, maxInset)).toEqual(0)
            expect(calcCurrentPage(-10, insets, wrapInset, maxInset)).toEqual(0)
            expect(calcCurrentPage(-49, insets, wrapInset, maxInset)).toEqual(0)
            expect(calcCurrentPage(-50, insets, wrapInset, maxInset)).toEqual(1)
            expect(calcCurrentPage(-100, insets, wrapInset, maxInset)).toEqual(
                1
            )
            expect(calcCurrentPage(-149, insets, wrapInset, maxInset)).toEqual(
                1
            )
            expect(calcCurrentPage(-150, insets, wrapInset, maxInset)).toEqual(
                2
            )
            expect(calcCurrentPage(-200, insets, wrapInset, maxInset)).toEqual(
                2
            )
            expect(calcCurrentPage(-249, insets, wrapInset, maxInset)).toEqual(
                2
            )
            expect(calcCurrentPage(-250, insets, wrapInset, maxInset)).toEqual(
                3
            )
            expect(calcCurrentPage(-300, insets, wrapInset, maxInset)).toEqual(
                3
            )
        })

        it("should handle positive offsets correctly", () => {
            expect(calcCurrentPage(50, insets, wrapInset, maxInset)).toEqual(0)
            expect(calcCurrentPage(100, insets, wrapInset, maxInset)).toEqual(0)
            expect(calcCurrentPage(200, insets, wrapInset, maxInset)).toEqual(0)
            expect(calcCurrentPage(300, insets, wrapInset, maxInset)).toEqual(0)
        })

        it("should handle edge cases", () => {
            expect(calcCurrentPage(-400, insets, wrapInset, maxInset)).toEqual(
                0
            )
            expect(calcCurrentPage(-500, insets, wrapInset, maxInset)).toEqual(
                0
            )
        })
    })

    describe("looping carousel (maxInset is null)", () => {
        const insets = [0, 100, 200, 300]
        const wrapInset = 500
        const maxInset = null

        it("should correctly calculate page index for negative offsets (forward navigation)", () => {
            expect(calcCurrentPage(0, insets, wrapInset, maxInset)).toEqual(0)
            expect(calcCurrentPage(-100, insets, wrapInset, maxInset)).toEqual(
                1
            )
            expect(calcCurrentPage(-200, insets, wrapInset, maxInset)).toEqual(
                2
            )
            expect(calcCurrentPage(-300, insets, wrapInset, maxInset)).toEqual(
                3
            )
        })

        it("should handle wrapping iterations correctly", () => {
            expect(calcCurrentPage(-500, insets, wrapInset, maxInset)).toEqual(
                0
            )
            expect(calcCurrentPage(-600, insets, wrapInset, maxInset)).toEqual(
                1
            )
            expect(calcCurrentPage(-700, insets, wrapInset, maxInset)).toEqual(
                2
            )
            expect(calcCurrentPage(-800, insets, wrapInset, maxInset)).toEqual(
                3
            )
        })

        it("should handle positive offsets (backwards navigation)", () => {
            expect(calcCurrentPage(100, insets, wrapInset, maxInset)).toEqual(0)
            expect(calcCurrentPage(200, insets, wrapInset, maxInset)).toEqual(3)
            expect(calcCurrentPage(300, insets, wrapInset, maxInset)).toEqual(2)
            expect(calcCurrentPage(400, insets, wrapInset, maxInset)).toEqual(1)
            expect(calcCurrentPage(500, insets, wrapInset, maxInset)).toEqual(0)
        })

        it("should handle multiple backwards iterations", () => {
            expect(calcCurrentPage(600, insets, wrapInset, maxInset)).toEqual(0)
            expect(calcCurrentPage(700, insets, wrapInset, maxInset)).toEqual(3)
            expect(calcCurrentPage(800, insets, wrapInset, maxInset)).toEqual(2)
            expect(calcCurrentPage(1000, insets, wrapInset, maxInset)).toEqual(
                0
            )
        })
    })

    describe("edge cases and boundary conditions", () => {
        const wrapInset = 500
        const maxInset = null

        it("should handle empty page insets", () => {
            expect(calcCurrentPage(0, [], wrapInset, maxInset)).toEqual(0)
            expect(calcCurrentPage(-100, [], wrapInset, maxInset)).toEqual(0)
            expect(calcCurrentPage(100, [], wrapInset, maxInset)).toEqual(0)
        })

        it("should handle single page", () => {
            const singlePage = [0]
            expect(calcCurrentPage(0, singlePage, wrapInset, maxInset)).toEqual(
                0
            )
            expect(
                calcCurrentPage(-50, singlePage, wrapInset, maxInset)
            ).toEqual(0)
            expect(
                calcCurrentPage(50, singlePage, wrapInset, maxInset)
            ).toEqual(0)
        })

        it("should handle irregular page spacing", () => {
            const irregularInsets = [0, 50, 180, 250]
            expect(
                calcCurrentPage(0, irregularInsets, wrapInset, maxInset)
            ).toEqual(0)
            expect(
                calcCurrentPage(-50, irregularInsets, wrapInset, maxInset)
            ).toEqual(1)
            expect(
                calcCurrentPage(-180, irregularInsets, wrapInset, maxInset)
            ).toEqual(2)
            expect(
                calcCurrentPage(-250, irregularInsets, wrapInset, maxInset)
            ).toEqual(3)
        })

        it("should handle negative starting positions", () => {
            const negativeInsets = [-200, -100, 0, 100]
            expect(
                calcCurrentPage(0, negativeInsets, wrapInset, maxInset)
            ).toEqual(2)
            expect(
                calcCurrentPage(100, negativeInsets, wrapInset, maxInset)
            ).toEqual(0)
            expect(
                calcCurrentPage(200, negativeInsets, wrapInset, maxInset)
            ).toEqual(0)
        })

        it("should handle very large wrap insets", () => {
            const largeWrapInset = 10000
            const insets = [0, 1000, 2000, 3000]
            expect(
                calcCurrentPage(-1000, insets, largeWrapInset, maxInset)
            ).toEqual(1)
            expect(
                calcCurrentPage(-2000, insets, largeWrapInset, maxInset)
            ).toEqual(2)
            expect(
                calcCurrentPage(-3000, insets, largeWrapInset, maxInset)
            ).toEqual(3)
        })

        it("should handle small wrap insets with multiple iterations", () => {
            const smallWrapInset = 200
            const insets = [0, 50, 100, 150]
            expect(
                calcCurrentPage(-200, insets, smallWrapInset, maxInset)
            ).toEqual(0)
            expect(
                calcCurrentPage(-250, insets, smallWrapInset, maxInset)
            ).toEqual(1)
        })
    })

    describe("consistency and mathematical properties", () => {
        const insets = [0, 100, 200, 300]
        const wrapInset = 500
        const maxInset = null

        it("should maintain consistency across wrap boundaries", () => {
            const page0 = calcCurrentPage(0, insets, wrapInset, maxInset)
            const pageWrapped = calcCurrentPage(
                -500,
                insets,
                wrapInset,
                maxInset
            )
            expect(page0).toEqual(pageWrapped)
        })

        it("should handle fractional-like offsets consistently", () => {
            expect(calcCurrentPage(-50, insets, wrapInset, maxInset)).toEqual(1)
            expect(calcCurrentPage(-150, insets, wrapInset, maxInset)).toEqual(
                2
            )
            expect(calcCurrentPage(-250, insets, wrapInset, maxInset)).toEqual(
                3
            )
        })

        it("should be deterministic", () => {
            const testOffset = -175
            const result1 = calcCurrentPage(
                testOffset,
                insets,
                wrapInset,
                maxInset
            )
            const result2 = calcCurrentPage(
                testOffset,
                insets,
                wrapInset,
                maxInset
            )
            expect(result1).toEqual(result2)
        })
    })

    describe("real-world carousel scenarios", () => {
        it("should handle typical 5-item carousel", () => {
            const insets = [0, 120, 240, 360, 480]
            const wrapInset = 600
            const maxInset = null

            expect(calcCurrentPage(0, insets, wrapInset, maxInset)).toEqual(0)
            expect(calcCurrentPage(-120, insets, wrapInset, maxInset)).toEqual(
                1
            )
            expect(calcCurrentPage(-240, insets, wrapInset, maxInset)).toEqual(
                2
            )
            expect(calcCurrentPage(-360, insets, wrapInset, maxInset)).toEqual(
                3
            )
            expect(calcCurrentPage(-480, insets, wrapInset, maxInset)).toEqual(
                4
            )
            expect(calcCurrentPage(-600, insets, wrapInset, maxInset)).toEqual(
                0
            )
        })

        it("should handle non-looping carousel limits", () => {
            const insets = [0, 100, 200, 300, 400]
            const wrapInset = 500
            const totalItemLength = 500
            const containerLength = 200
            const maxInset = totalItemLength - containerLength

            expect(calcCurrentPage(-350, insets, wrapInset, maxInset)).toEqual(
                4
            )
            expect(calcCurrentPage(-400, insets, wrapInset, maxInset)).toEqual(
                4
            )
        })

        it("should handle carousel with gaps", () => {
            const insets = [0, 110, 230, 340]
            const wrapInset = 460
            const maxInset = null

            expect(calcCurrentPage(-110, insets, wrapInset, maxInset)).toEqual(
                1
            )
            expect(calcCurrentPage(-230, insets, wrapInset, maxInset)).toEqual(
                2
            )
            expect(calcCurrentPage(-340, insets, wrapInset, maxInset)).toEqual(
                3
            )
        })
    })

    describe("comprehensive halfDistance edge cases", () => {
        const insets = [0, 100, 200, 300]
        const wrapInset = 500

        it("should handle exact boundary conditions", () => {
            const maxInset = 400
            expect(calcCurrentPage(-50, insets, wrapInset, maxInset)).toEqual(1)
            expect(calcCurrentPage(-49.9, insets, wrapInset, maxInset)).toEqual(
                0
            )
            expect(calcCurrentPage(-150, insets, wrapInset, maxInset)).toEqual(
                2
            )
            expect(
                calcCurrentPage(-149.9, insets, wrapInset, maxInset)
            ).toEqual(1)
        })

        it("should handle asymmetric halfDistances", () => {
            const maxInset = 400
            const irregularInsets = [0, 80, 220, 300]

            expect(
                calcCurrentPage(-39, irregularInsets, wrapInset, maxInset)
            ).toEqual(0)
            expect(
                calcCurrentPage(-40, irregularInsets, wrapInset, maxInset)
            ).toEqual(1)
            expect(
                calcCurrentPage(-149, irregularInsets, wrapInset, maxInset)
            ).toEqual(1)
            expect(
                calcCurrentPage(-150, irregularInsets, wrapInset, maxInset)
            ).toEqual(2)
        })

        it("should handle iteration effects in looping mode", () => {
            const loopingMaxInset = null

            expect(
                calcCurrentPage(200, insets, wrapInset, loopingMaxInset)
            ).toEqual(3)
            expect(
                calcCurrentPage(700, insets, wrapInset, loopingMaxInset)
            ).toEqual(3)
            expect(
                calcCurrentPage(500, insets, wrapInset, loopingMaxInset)
            ).toEqual(0)
            expect(
                calcCurrentPage(1000, insets, wrapInset, loopingMaxInset)
            ).toEqual(0)
        })

        it("should maintain consistent halfDistance behavior across wrapping", () => {
            const loopingMaxInset = null
            const page1ForwardOffset = -100
            const page1BackwardOffset = 400

            expect(
                calcCurrentPage(
                    page1ForwardOffset,
                    insets,
                    wrapInset,
                    loopingMaxInset
                )
            ).toEqual(1)
            expect(
                calcCurrentPage(
                    page1BackwardOffset,
                    insets,
                    wrapInset,
                    loopingMaxInset
                )
            ).toEqual(1)
        })
    })
})

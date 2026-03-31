import { ItemPosition } from "../../../Ticker/types"
import { findPrevItemInset, findPrevPageInset } from "../find-prev-page"

describe("findPrevPageInset", () => {
    const itemPositions: ItemPosition[] = [
        { start: 0, end: 100 },
        { start: 100, end: 200 },
        { start: 200, end: 300 },
        { start: 300, end: 400 },
    ]

    const itemPositionsWithGap: ItemPosition[] = [
        { start: 0, end: 100 },
        { start: 110, end: 210 },
        { start: 220, end: 320 },
        { start: 330, end: 430 },
    ]

    const singleItem: ItemPosition[] = [{ start: 0, end: 100 }]

    it("should return 0 if there are no item positions", () => {
        const prevPageInset = findPrevPageInset(0, 100, [], 0)
        expect(prevPageInset).toBe(0)
    })

    describe("single item", () => {
        it("no gap, itemWidth > containerLength, offset 0", () => {
            const prevPageInset = findPrevPageInset(0, 50, singleItem, 0)
            expect(prevPageInset).toBe(-100)
        })

        it("no gap, itemWidth < containerLength, offset 0", () => {
            const prevPageInset = findPrevPageInset(0, 200, singleItem, 0)
            expect(prevPageInset).toBe(-200)
        })

        it("no gap, itemWidth === containerLength, offset 0", () => {
            const prevPageInset = findPrevPageInset(0, 100, singleItem, 0)
            expect(prevPageInset).toBe(-100)
        })

        it("gap, itemWidth > containerLength, offset 0", () => {
            const prevPageInset = findPrevPageInset(0, 50, singleItem, 10)
            expect(prevPageInset).toBe(-110)
        })

        it("gap, itemWidth < containerLength, offset 0", () => {
            const prevPageInset = findPrevPageInset(0, 200, singleItem, 10)
            expect(prevPageInset).toBe(-110)
        })

        it("gap, itemWidth < containerLength + 1 gap, offset 0", () => {
            const prevPageInset = findPrevPageInset(0, 210, singleItem, 10)
            expect(prevPageInset).toBe(-220)
        })

        it("gap, itemWidth === containerLength, offset 0", () => {
            const prevPageInset = findPrevPageInset(0, 100, singleItem, 10)
            expect(prevPageInset).toBe(-110)
        })

        it("no gap, itemWidth > containerLength, offset 5", () => {
            const prevPageInset = findPrevPageInset(5, 50, singleItem, 0)
            expect(prevPageInset).toBe(-100)
        })

        it("no gap, itemWidth < containerLength, offset 5", () => {
            const prevPageInset = findPrevPageInset(5, 200, singleItem, 0)
            expect(prevPageInset).toBe(-100)
        })

        it("no gap, itemWidth < containerLength, offset -5", () => {
            const prevPageInset = findPrevPageInset(-5, 200, singleItem, 0)
            expect(prevPageInset).toBe(-200)
        })

        it("no gap, itemWidth === containerLength, offset 5", () => {
            const prevPageInset = findPrevPageInset(5, 100, singleItem, 0)
            expect(prevPageInset).toBe(0)
        })

        it("no gap, itemWidth === containerLength, offset -5", () => {
            const prevPageInset = findPrevPageInset(-5, 100, singleItem, 0)
            expect(prevPageInset).toBe(-100)
        })

        it("gap, itemWidth > containerLength, offset 5", () => {
            const prevPageInset = findPrevPageInset(5, 50, singleItem, 10)
            expect(prevPageInset).toBe(-110)
        })

        it("gap, itemWidth < containerLength, offset 5", () => {
            const prevPageInset = findPrevPageInset(5, 200, singleItem, 10)
            expect(prevPageInset).toBe(-110)
        })

        it("gap, itemWidth < containerLength + 1 gap, offset -5", () => {
            const prevPageInset = findPrevPageInset(-5, 210, singleItem, 10)
            expect(prevPageInset).toBe(-220)
        })

        it("gap, itemWidth === containerLength, offset 5", () => {
            const prevPageInset = findPrevPageInset(5, 100, singleItem, 10)
            expect(prevPageInset).toBe(0)
        })

        it("should correctly return previous page inset", () => {
            const prevPageInset = findPrevPageInset(
                -20,
                520,
                [{ start: 0, end: 520 }],
                10
            )
            expect(prevPageInset).toBe(-530)
        })
    })

    describe("multiple items", () => {
        it("no gap, itemWidth > containerLength, offset 0", () => {
            const prevPageInset = findPrevPageInset(0, 50, itemPositions, 0)
            expect(prevPageInset).toBe(-100)
        })

        it("no gap, itemWidth < containerLength, offset 0", () => {
            const prevPageInset = findPrevPageInset(0, 200, itemPositions, 0)
            expect(prevPageInset).toBe(-200)
        })

        it("no gap, itemWidth === containerLength, offset 0", () => {
            const prevPageInset = findPrevPageInset(0, 100, itemPositions, 0)
            expect(prevPageInset).toBe(-100)
        })

        it("gap, itemWidth > containerLength, offset 0", () => {
            const prevPageInset = findPrevPageInset(
                0,
                50,
                itemPositionsWithGap,
                10
            )
            expect(prevPageInset).toBe(-110)
        })

        it("gap, itemWidth < containerLength, offset 0", () => {
            const prevPageInset = findPrevPageInset(
                0,
                200,
                itemPositionsWithGap,
                10
            )
            expect(prevPageInset).toBe(-110)
        })

        it("gap, itemWidth === containerLength, offset 0", () => {
            const prevPageInset = findPrevPageInset(
                0,
                100,
                itemPositionsWithGap,
                10
            )
            expect(prevPageInset).toBe(-110)
        })

        it("no gap, itemWidth > containerLength, offset 5", () => {
            const prevPageInset = findPrevPageInset(5, 50, itemPositions, 0)
            expect(prevPageInset).toBe(-100)
        })

        it("no gap, itemWidth < containerLength, offset 5", () => {
            const prevPageInset = findPrevPageInset(5, 200, itemPositions, 0)
            expect(prevPageInset).toBe(-100)
        })

        it("no gap, itemWidth < containerLength, offset -5", () => {
            const prevPageInset = findPrevPageInset(-5, 200, itemPositions, 0)
            expect(prevPageInset).toBe(-200)
        })

        it("no gap, itemWidth === containerLength, offset 5", () => {
            const prevPageInset = findPrevPageInset(5, 100, itemPositions, 0)
            expect(prevPageInset).toBe(0)
        })

        it("gap, itemWidth > containerLength, offset 5", () => {
            const prevPageInset = findPrevPageInset(
                5,
                50,
                itemPositionsWithGap,
                10
            )
            expect(prevPageInset).toBe(-110)
        })

        it("gap, itemWidth < containerLength, offset 5", () => {
            const prevPageInset = findPrevPageInset(
                5,
                200,
                itemPositionsWithGap,
                10
            )
            expect(prevPageInset).toBe(-110)
        })

        it("gap, itemWidth === containerLength, offset 5", () => {
            const prevPageInset = findPrevPageInset(
                5,
                100,
                itemPositionsWithGap,
                10
            )
            expect(prevPageInset).toBe(0)
        })

        it("gap, itemWidth < containerWidth, page 2", () => {
            const prevPageInset = findPrevPageInset(
                440,
                150,
                [
                    { start: 0, end: 100 },
                    { start: 110, end: 210 },
                    { start: 220, end: 320 },
                    { start: 330, end: 430 },
                    { start: 440, end: 540 },
                    { start: 550, end: 650 },
                ],
                10
            )
            expect(prevPageInset).toBe(330)
        })
    })
})

describe("findPrevItemInset", () => {
    it("should correctly return previous page inset", () => {
        expect(
            findPrevItemInset(-20, [{ start: 0, end: 520 }], 10, -100, 520)
        ).toBe(-530)

        expect(
            findPrevItemInset(
                -20,
                [
                    { start: 0, end: 100 },
                    { start: 110, end: 210 },
                    { start: 220, end: 320 },
                ],
                10,
                -50,
                520
            )
        ).toBe(-110)
    })
})

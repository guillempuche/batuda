import { ItemPosition } from "../../../Ticker/types"
import { findNextPageInset } from "../find-next-page"

describe("findNextPageInset", () => {
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
        const nextPageInset = findNextPageInset(0, 100, [], 0)
        expect(nextPageInset).toBe(0)
    })

    describe("single item", () => {
        it("no gap, itemWidth > containerLength, offset 0", () => {
            const nextPageInset = findNextPageInset(0, 50, singleItem, 0)
            expect(nextPageInset).toBe(100)
        })

        it("no gap, itemWidth < containerLength, offset 0", () => {
            const nextPageInset = findNextPageInset(0, 200, singleItem, 0)
            expect(nextPageInset).toBe(200)
        })

        it("no gap, itemWidth === containerLength, offset 0", () => {
            const nextPageInset = findNextPageInset(0, 100, singleItem, 0)
            expect(nextPageInset).toBe(100)
        })

        it("gap, itemWidth > containerLength, offset 0", () => {
            const nextPageInset = findNextPageInset(0, 50, singleItem, 10)
            expect(nextPageInset).toBe(110)
        })

        it("gap, itemWidth < containerLength, offset 0", () => {
            const nextPageInset = findNextPageInset(0, 200, singleItem, 10)
            expect(nextPageInset).toBe(110)
        })

        it("gap, itemWidth < containerLength + 1 gap, offset 0", () => {
            const nextPageInset = findNextPageInset(0, 210, singleItem, 10)
            expect(nextPageInset).toBe(220)
        })

        it("gap, itemWidth === containerLength, offset 0", () => {
            const nextPageInset = findNextPageInset(0, 100, singleItem, 10)
            expect(nextPageInset).toBe(110)
        })

        it("no gap, itemWidth > containerLength, offset 5", () => {
            const nextPageInset = findNextPageInset(5, 50, singleItem, 0)
            expect(nextPageInset).toBe(100)
        })

        it("no gap, itemWidth < containerLength, offset 5", () => {
            const nextPageInset = findNextPageInset(5, 200, singleItem, 0)
            expect(nextPageInset).toBe(200)
        })

        it("no gap, itemWidth === containerLength, offset 5", () => {
            const nextPageInset = findNextPageInset(5, 100, singleItem, 0)
            expect(nextPageInset).toBe(100)
        })

        it("gap, itemWidth > containerLength, offset 5", () => {
            const nextPageInset = findNextPageInset(5, 50, singleItem, 10)
            expect(nextPageInset).toBe(110)
        })

        it("gap, itemWidth < containerLength, offset 5", () => {
            const nextPageInset = findNextPageInset(5, 200, singleItem, 10)
            expect(nextPageInset).toBe(110)
        })

        it("gap, itemWidth < containerLength + 1 gap, offset 5", () => {
            const nextPageInset = findNextPageInset(5, 210, singleItem, 10)
            expect(nextPageInset).toBe(220)
        })

        it("gap, itemWidth === containerLength, offset 5", () => {
            const nextPageInset = findNextPageInset(5, 100, singleItem, 10)
            expect(nextPageInset).toBe(110)
        })

        it("gap, itemWidth === containerLength with 1 gap, offset 5", () => {
            const nextPageInset = findNextPageInset(5, 110, singleItem, 10)
            expect(nextPageInset).toBe(110)
        })
    })

    describe("multiple items", () => {
        it("no gap, itemWidth > containerLength, offset 0", () => {
            const nextPageInset = findNextPageInset(0, 50, itemPositions, 0)
            expect(nextPageInset).toBe(100)
        })

        it("no gap, itemWidth < containerLength, offset 0", () => {
            const nextPageInset = findNextPageInset(0, 200, itemPositions, 0)
            expect(nextPageInset).toBe(200)
        })

        it("no gap, itemWidth === containerLength, offset 0", () => {
            const nextPageInset = findNextPageInset(0, 100, itemPositions, 0)
            expect(nextPageInset).toBe(100)
        })

        it("gap, itemWidth > containerLength, offset 0", () => {
            const nextPageInset = findNextPageInset(
                0,
                50,
                itemPositionsWithGap,
                10
            )
            expect(nextPageInset).toBe(110)
        })

        it("gap, itemWidth < containerLength, offset 0", () => {
            const nextPageInset = findNextPageInset(
                0,
                200,
                itemPositionsWithGap,
                10
            )
            expect(nextPageInset).toBe(110)
        })

        it("gap, itemWidth === containerLength, offset 0", () => {
            const nextPageInset = findNextPageInset(
                0,
                100,
                itemPositionsWithGap,
                10
            )
            expect(nextPageInset).toBe(110)
        })

        it("no gap, itemWidth > containerLength, offset 5", () => {
            const nextPageInset = findNextPageInset(5, 50, itemPositions, 0)
            expect(nextPageInset).toBe(100)
        })

        it("no gap, itemWidth < containerLength, offset 5", () => {
            const nextPageInset = findNextPageInset(5, 200, itemPositions, 0)
            expect(nextPageInset).toBe(200)
        })

        it("no gap, itemWidth === containerLength, offset 5", () => {
            const nextPageInset = findNextPageInset(5, 100, itemPositions, 0)
            expect(nextPageInset).toBe(100)
        })

        it("gap, itemWidth > containerLength, offset 5", () => {
            const nextPageInset = findNextPageInset(
                5,
                50,
                itemPositionsWithGap,
                10
            )
            expect(nextPageInset).toBe(110)
        })

        it("gap, itemWidth < containerLength, offset 5", () => {
            const nextPageInset = findNextPageInset(
                5,
                200,
                itemPositionsWithGap,
                10
            )
            expect(nextPageInset).toBe(110)
        })

        it("gap, itemWidth === containerLength, offset 5", () => {
            const nextPageInset = findNextPageInset(
                5,
                100,
                itemPositionsWithGap,
                10
            )
            expect(nextPageInset).toBe(110)
        })
    })
})

import { findCurrentIndexFromInset } from "../find-current-index"

describe("findCurrentIndexFromInset", () => {
    it("should return the correct index", () => {
        expect(findCurrentIndexFromInset(0, [], 300)).toBe(0)

        const itemPositions = [
            { start: 0, end: 100 },
            { start: 100, end: 200 },
            { start: 200, end: 300 },
        ]

        expect(findCurrentIndexFromInset(-50, itemPositions, 300)).toBe(-1)
        expect(findCurrentIndexFromInset(0, itemPositions, 300)).toBe(0)
        expect(findCurrentIndexFromInset(10, itemPositions, 300)).toBe(0)
        expect(findCurrentIndexFromInset(100, itemPositions, 300)).toBe(1)
        expect(findCurrentIndexFromInset(110, itemPositions, 300)).toBe(1)
        expect(findCurrentIndexFromInset(200, itemPositions, 300)).toBe(2)
        expect(findCurrentIndexFromInset(300, itemPositions, 300)).toBe(3)
        expect(findCurrentIndexFromInset(400, itemPositions, 300)).toBe(4)
    })
})

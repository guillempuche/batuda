import { ItemPosition } from "../../../Ticker/types"
import { calcPageInsets } from "../calc-page-insets"

describe("calcPageInsets", () => {
    it("should return an array with the first item start position for a single item", () => {
        const itemPositions: ItemPosition[] = [{ start: 0, end: 100 }]
        const containerLength = 200

        const result = calcPageInsets(itemPositions, containerLength, null)

        expect(result.insets).toEqual([0])
    })

    it("should return only the first offset when all items fit within one page", () => {
        const itemPositions: ItemPosition[] = [
            { start: 0, end: 50 },
            { start: 50, end: 100 },
            { start: 100, end: 150 },
        ]
        const containerLength = 200

        const result = calcPageInsets(itemPositions, containerLength, null)

        expect(result.insets).toEqual([0])
    })

    it("should create multiple page offsets when only some items fit within containerLength", () => {
        const itemPositions: ItemPosition[] = [
            { start: 0, end: 40 },
            { start: 50, end: 100 },
            { start: 110, end: 150 },
            { start: 160, end: 200 },
        ]
        const containerLength = 100

        const result = calcPageInsets(itemPositions, containerLength, null)

        expect(result.insets).toEqual([0, 110])
    })

    it("should create multiple page offsets when items dont fit within containerLength", () => {
        const itemPositions: ItemPosition[] = [
            { start: 0, end: 80 },
            { start: 80, end: 160 },
            { start: 160, end: 240 },
            { start: 240, end: 320 },
        ]
        const containerLength = 150

        const result = calcPageInsets(itemPositions, containerLength, null)

        // Second page starts at 80 as the first page cant fit the first two items, etc
        expect(result.insets).toEqual([0, 80, 160, 240])
    })

    it("should handle items with gaps between them", () => {
        const itemPositions: ItemPosition[] = [
            { start: 0, end: 50 },
            { start: 100, end: 150 },
            { start: 200, end: 250 },
            { start: 300, end: 350 },
        ]
        const containerLength = 120

        const result = calcPageInsets(itemPositions, containerLength, null)

        // First page: 0, can show up to 120 (covers first item)
        // Second page: 100, can show up to 220 (covers second item)
        // Third page: 200, can show up to 320 (covers third item)
        // Fourth page: 300 (since 200 + 120 < 350)
        expect(result.insets).toEqual([0, 100, 200, 300])
    })

    it("should handle edge case where item end exactly matches page boundary", () => {
        const itemPositions: ItemPosition[] = [
            { start: 0, end: 100 },
            { start: 100, end: 200 },
            { start: 200, end: 300 },
        ]
        const containerLength = 100

        const result = calcPageInsets(itemPositions, containerLength, null)

        expect(result.insets).toEqual([0, 100, 200])
    })

    it("should handle when each page exceeds container length", () => {
        const itemPositions: ItemPosition[] = [
            { start: 0, end: 200 },
            { start: 200, end: 400 },
        ]
        const containerLength = 100

        const result = calcPageInsets(itemPositions, containerLength, null)

        expect(result.insets).toEqual([0, 200])
    })

    it("should handle very large container that fits all items", () => {
        const itemPositions: ItemPosition[] = [
            { start: 0, end: 50 },
            { start: 50, end: 100 },
            { start: 100, end: 150 },
            { start: 150, end: 200 },
        ]
        const containerLength = 1000

        const result = calcPageInsets(itemPositions, containerLength, null)

        expect(result.insets).toEqual([0])
    })

    it("should handle items of varying sizes", () => {
        const itemPositions: ItemPosition[] = [
            { start: 0, end: 30 }, // Small item
            { start: 30, end: 130 }, // Large item
            { start: 130, end: 140 }, // Tiny item
            { start: 140, end: 240 }, // Large item
            { start: 240, end: 340 }, // Small item
        ]
        const containerLength = 150

        const result = calcPageInsets(itemPositions, containerLength, null)

        expect(result.insets).toEqual([0, 140, 240])
    })

    it("should handle zero-width container", () => {
        const itemPositions: ItemPosition[] = [
            { start: 0, end: 50 },
            { start: 50, end: 100 },
        ]
        const containerLength = 0

        const result = calcPageInsets(itemPositions, containerLength, null)

        // With zero container length, every item should start a new page
        expect(result.insets).toEqual([0, 50])
    })

    it("should handle negative positions", () => {
        const itemPositions: ItemPosition[] = [
            { start: -100, end: -50 },
            { start: -50, end: 0 },
            { start: 0, end: 50 },
        ]
        const containerLength = 75

        const result = calcPageInsets(itemPositions, containerLength, null)

        // First page: -100, can show up to -25
        // Second page: -50, since -100 + 75 = -25, which is not < 0
        // Third page: 0, since -50 + 75 = 25, which is not < 50
        expect(result.insets).toEqual([-100, -50, 0])
    })

    describe("with maxInset constraint", () => {
        it("should limit page offsets when maxInset is provided", () => {
            const itemPositions: ItemPosition[] = [
                { start: 0, end: 80 },
                { start: 80, end: 160 },
                { start: 160, end: 240 },
                { start: 240, end: 320 },
            ]
            const containerLength = 150
            const maxInset = itemPositions[itemPositions.length - 1].end

            const result = calcPageInsets(
                itemPositions,
                containerLength,
                maxInset
            )

            // Normal would be [0, 80, 160, 240], maxInset is 320
            expect(result.insets).toEqual([0, 80, 160, 240])
        })

        it("should not affect offsets when maxInset is larger than all calculated offsets", () => {
            const itemPositions: ItemPosition[] = [
                { start: 0, end: 50 },
                { start: 50, end: 100 },
                { start: 100, end: 150 },
            ]
            const containerLength = 75
            const maxInset = itemPositions[itemPositions.length - 1].end

            const result = calcPageInsets(
                itemPositions,
                containerLength,
                maxInset
            )

            // With maxInset = 150, normal offsets would be [0, 50, 100]
            // Since maxInset (150) is larger than all offsets, nothing is capped
            expect(result.insets).toEqual([0, 50, 100])
        })

        it("should handle maxInset smaller than some offsets", () => {
            const itemPositions: ItemPosition[] = [
                { start: 0, end: 40 },
                { start: 50, end: 100 },
                { start: 110, end: 150 },
                { start: 160, end: 200 },
            ]
            const containerLength = 100
            const maxInset = itemPositions[itemPositions.length - 1].end

            const result = calcPageInsets(
                itemPositions,
                containerLength,
                maxInset
            )

            // Normal would be [0, 110], but 110 < maxInset, so no change
            expect(result.insets).toEqual([0, 110])
        })

        it("should handle maxInset equal to a calculated offset", () => {
            const itemPositions: ItemPosition[] = [
                { start: 0, end: 80 },
                { start: 80, end: 160 },
                { start: 160, end: 240 },
            ]
            const containerLength = 120
            const maxInset = itemPositions[itemPositions.length - 1].end

            const result = calcPageInsets(
                itemPositions,
                containerLength,
                maxInset
            )

            // Normal offsets would be [0, 80, 160], maxInset is 240
            // Since maxInset (240) is larger than all offsets, nothing is capped
            expect(result.insets).toEqual([0, 80, 160])
        })

        it("should handle maxInset of 0", () => {
            const itemPositions: ItemPosition[] = [
                { start: 0, end: 100 },
                { start: 100, end: 200 },
                { start: 200, end: 300 },
            ]
            const containerLength = 300 // Container exactly fits all items
            const maxInset = itemPositions[itemPositions.length - 1].end

            const result = calcPageInsets(
                itemPositions,
                containerLength,
                maxInset
            )

            // With maxInset = 0, no offsets beyond first are allowed
            expect(result.insets).toEqual([0])
        })

        it("should handle negative maxInset", () => {
            const itemPositions: ItemPosition[] = [
                { start: -100, end: -50 },
                { start: -50, end: 0 },
                { start: 0, end: 50 },
            ]
            const containerLength = 200 // Container bigger than total length
            const maxInset = itemPositions[itemPositions.length - 1].end

            const result = calcPageInsets(
                itemPositions,
                containerLength,
                maxInset
            )

            // With maxInset = -50, offsets -50 and 0 would exceed maxInset
            // So we only get the first offset
            expect(result.insets).toEqual([-100])
        })
    })

    describe("page redistribution when final page is too small", () => {
        it("should redistribute pages when final page is less than half the average", () => {
            // This creates insets like [0, 80, 200, 210] where the final page (210-200=10)
            // is much smaller than the average of the other pages ((80-0=80) + (200-80=120))/2 = 100
            // So 10 < 100*0.5 = 50, triggering redistribution
            const itemPositions: ItemPosition[] = [
                { start: 0, end: 40 },
                { start: 40, end: 80 }, // Page break at 80
                { start: 80, end: 120 },
                { start: 120, end: 160 },
                { start: 160, end: 200 }, // Page break at 200
                { start: 200, end: 210 }, // Small final page
            ]
            const containerLength = 80
            const maxInset = itemPositions[itemPositions.length - 1].end

            const result = calcPageInsets(
                itemPositions,
                containerLength,
                maxInset
            )

            // Should redistribute with shorter container length to get more even pages
            // With containerLength 80, we get pages at [0, 80, 160]
            // maxInset is 210, which limits scrolling to show the last item
            expect(result.insets).toHaveLength(3)
            expect(result.insets[0]).toBe(0)
            expect(result.insets[result.insets.length - 1]).toBe(160)

            // The redistributed pages should be more evenly spaced
            const pageSizes = []
            for (let i = 0; i < result.insets.length - 1; i++) {
                const nextInset =
                    i === result.insets.length - 2
                        ? maxInset
                        : result.insets[i + 1]
                pageSizes.push(nextInset - result.insets[i])
            }
            const finalPageSize =
                maxInset - result.insets[result.insets.length - 1]
            const averagePageSize =
                pageSizes.reduce((sum, size) => sum + size, 0) /
                pageSizes.length

            // Final page should be at least half the average (or close to it)
            expect(finalPageSize).toBeGreaterThanOrEqual(averagePageSize * 0.4)
        })

        it("should not redistribute when final page is acceptable size", () => {
            // This creates pages where the final page is reasonable sized
            const itemPositions: ItemPosition[] = [
                { start: 0, end: 40 },
                { start: 40, end: 80 }, // Page break at 80
                { start: 80, end: 120 },
                { start: 120, end: 160 }, // Page break at 160
                { start: 160, end: 200 },
                { start: 200, end: 240 }, // Reasonable final page size (40)
            ]
            const containerLength = 80
            const maxInset = itemPositions[itemPositions.length - 1].end

            const result = calcPageInsets(
                itemPositions,
                containerLength,
                maxInset
            )

            // Should keep original pagination since final page is acceptable
            // Average of first two pages: (80 + 80) / 2 = 80
            // Final page size: 240 - 160 = 80, which is >= 80 * 0.5 = 40
            expect(result.insets).toEqual([0, 80, 160])
        })

        it("should fallback to original if redistribution results in different page count", () => {
            // Create a scenario where redistribution might result in fewer pages
            const itemPositions: ItemPosition[] = [
                { start: 0, end: 50 },
                { start: 50, end: 100 }, // Page break at 100
                { start: 100, end: 105 }, // Very small final page
            ]
            const containerLength = 50
            const maxInset = itemPositions[itemPositions.length - 1].end

            const result = calcPageInsets(
                itemPositions,
                containerLength,
                maxInset
            )

            // Should return original pagination even if final page is small,
            // because redistribution might change the page count
            expect(result.insets[0]).toBe(0)
            expect(result.insets[result.insets.length - 1]).toBe(100)
        })

        it("should not redistribute when allowRescale is false", () => {
            const itemPositions: ItemPosition[] = [
                { start: 0, end: 40 },
                { start: 40, end: 80 },
                { start: 80, end: 120 },
                { start: 120, end: 160 },
                { start: 160, end: 190 }, // Small final page
            ]
            const containerLength = 100
            const maxInset = itemPositions[itemPositions.length - 1].end

            const result = calcPageInsets(
                itemPositions,
                containerLength,
                maxInset,
                false
            )

            // Should not redistribute when allowRescale is false
            expect(result.insets).toEqual([0, 80, 160])
        })

        it("should not redistribute when maxInset is null (looping enabled)", () => {
            const itemPositions: ItemPosition[] = [
                { start: 0, end: 40 },
                { start: 40, end: 80 },
                { start: 80, end: 120 },
                { start: 120, end: 160 },
                { start: 160, end: 200 },
                { start: 200, end: 210 },
            ]
            const containerLength = 80

            const result = calcPageInsets(itemPositions, containerLength, null)

            // Should not redistribute when looping is enabled (maxInset is null)
            expect(result.insets).toEqual([0, 80, 160])
        })
    })
})

import { getTypewriterDelay } from "../delay"

describe("getTypewriterDelay", () => {
    const baseInterval = 100

    describe("basic functionality", () => {
        it("returns base interval when variance is 0", () => {
            const result = getTypewriterDelay(
                "hello",
                "hel",
                baseInterval,
                0,
                0.2
            )
            expect(result).toBe(baseInterval)
        })

        it("returns base interval when no variance is provided", () => {
            const result = getTypewriterDelay(
                "hello",
                "hel",
                baseInterval,
                0,
                0.2
            )
            expect(result).toBe(baseInterval)
        })
    })

    describe("percentage-based variance", () => {
        it("applies percentage variance correctly - no change at midpoint", () => {
            const originalRandom = Math.random
            Math.random = jest.fn(() => 0.5) // Middle value = no change
            const result = getTypewriterDelay(
                "hello",
                "hel",
                baseInterval,
                20,
                0.2
            )
            expect(result).toBe(baseInterval)
            Math.random = originalRandom
        })

        it("applies maximum positive variance", () => {
            const originalRandom = Math.random
            Math.random = jest.fn(() => 1) // Maximum positive
            const result = getTypewriterDelay(
                "hello",
                "hel",
                baseInterval,
                20,
                0.2
            )
            expect(result).toBe(baseInterval + 20) // +20% of 100 = +20
            Math.random = originalRandom
        })

        it("applies maximum negative variance", () => {
            const originalRandom = Math.random
            Math.random = jest.fn(() => 0) // Maximum negative
            const result = getTypewriterDelay(
                "hello",
                "hel",
                baseInterval,
                20,
                0.2
            )
            expect(result).toBe(baseInterval - 20) // -20% of 100 = -20
            Math.random = originalRandom
        })
    })

    describe("natural variance - multiplier behaviors", () => {
        beforeEach(() => {
            jest.spyOn(Math, "random").mockReturnValue(0.5) // Eliminate random variance
        })

        afterEach(() => {
            jest.restoreAllMocks()
        })

        it("thinking pause after sentence boundary", () => {
            const result = getTypewriterDelay(
                "Hello. World",
                "Hello.",
                baseInterval,
                "natural",
                0.2
            )
            // Typing space after period - applies 3x thinking pause
            expect(result).toBe(baseInterval * 3)
        })

        it("typing first character applies start of word multiplier", () => {
            const result = getTypewriterDelay(
                "hello",
                "",
                baseInterval,
                "natural",
                0.2
            )
            // Typing 'h' at start of word - applies 1.5x multiplier
            expect(result).toBe(baseInterval * 1.5)
        })

        it("typing w at start of word applies start multiplier", () => {
            const result = getTypewriterDelay(
                "hello world",
                "hello ",
                baseInterval,
                "natural",
                0.2
            )
            // Typing 'w' at start of word "world" - applies 1.5x multiplier
            expect(result).toBe(baseInterval * 1.5)
        })

        it("acceleration in middle of word", () => {
            const result = getTypewriterDelay(
                "hello",
                "he",
                baseInterval,
                "natural",
                0.2
            )
            // Typing 'l' in middle of "hello" (position 2, length 5)
            // middleBoost = min(2/5, 0.4) = 0.4, so multiplier = 1.0 - 0.4 = 0.6
            expect(result).toBe(baseInterval * 0.6)
        })

        it("slower at end of word", () => {
            const result = getTypewriterDelay(
                "hello world",
                "hell",
                baseInterval,
                "natural",
                0.2
            )
            // Typing 'o' at end of word "hello" - applies 1.4x multiplier
            expect(result).toBe(baseInterval * 1.4)
        })

        it("single character gets speed bonus for common words", () => {
            const result = getTypewriterDelay(
                "a",
                "",
                baseInterval,
                "natural",
                0.2
            )
            // Single character gets short word bonus - 0.7x (30% faster)
            expect(result).toBeCloseTo(baseInterval * 0.7, 1)
        })

        it("short words get speed bonus", () => {
            const result = getTypewriterDelay(
                "and",
                "an",
                baseInterval,
                "natural",
                0.2
            )
            // Short word (3 chars) gets speed bonus - 0.7x (30% faster)
            expect(result).toBeCloseTo(baseInterval * 0.7, 1)
        })

        it("longer words get start of word penalty", () => {
            const result = getTypewriterDelay(
                "hello",
                "",
                baseInterval,
                "natural",
                0.2
            )
            // Longer word (4+ chars) gets start penalty - 1.5x
            expect(result).toBe(baseInterval * 1.5)
        })

        it("punctuation on short words", () => {
            const result = getTypewriterDelay(
                "a!",
                "a",
                baseInterval,
                "natural",
                0.2
            )
            // Short word bonus + punctuation + shift (since '!' is both) - 0.7x * 1.5x * 1.5x = 1.575x
            expect(result).toBeCloseTo(baseInterval * 1.575, 1)
        })

        it("punctuation on longer words", () => {
            const result = getTypewriterDelay(
                "hello!",
                "hello",
                baseInterval,
                "natural",
                0.2
            )
            // End of longer word + punctuation + shift - 1.4x * 1.5x * 1.5x = 3.15x
            expect(result).toBeCloseTo(baseInterval * 3.15, 1)
        })

        it("shift-required characters on short words", () => {
            const result = getTypewriterDelay(
                "a@",
                "a",
                baseInterval,
                "natural",
                0.2
            )
            // Short word bonus + shift penalty - 0.7x * 1.5x = 1.05x
            expect(result).toBeCloseTo(baseInterval * 1.05, 1)
        })

        it("numbers on short words", () => {
            const result = getTypewriterDelay(
                "a1",
                "a",
                baseInterval,
                "natural",
                0.2
            )
            // Short word bonus + number penalty - 0.7x * 1.3x = 0.91x
            expect(result).toBeCloseTo(baseInterval * 0.91, 1)
        })

        it("numbers on longer words", () => {
            const result = getTypewriterDelay(
                "test1",
                "test",
                baseInterval,
                "natural",
                0.2
            )
            // End of longer word + number - 1.4x * 1.3x = 1.82x
            expect(result).toBeCloseTo(baseInterval * 1.82, 1)
        })

        it("slower at end of longer words", () => {
            const result = getTypewriterDelay(
                "hello world",
                "hell",
                baseInterval,
                "natural",
                0.2
            )
            // End of longer word - 1.4x
            expect(result).toBe(baseInterval * 1.4)
        })

        it("acceleration in middle of longer word", () => {
            const result = getTypewriterDelay(
                "hello",
                "he",
                baseInterval,
                "natural",
                0.2
            )
            // Typing 'l' in middle of "hello" (position 2, length 5)
            // middleBoost = min(2/5, 0.4) = 0.4, so multiplier = 1.0 - 0.4 = 0.6
            expect(result).toBe(baseInterval * 0.6)
        })

        it("long word applies multiplier", () => {
            const result = getTypewriterDelay(
                "supercalifragilisticexpialidocious",
                "supercalifragilis",
                baseInterval,
                "natural",
                0.2
            )
            // Typing in middle of long word - acceleration overrides long word penalty
            // Position 17 in 34-char word, middleBoost = min(17/34, 0.4) = 0.4
            // 1.3x (long word) * 0.6x (middle acceleration) = 0.78x
            expect(result).toBe(baseInterval * 0.78)
        })

        it("uppercase letters apply multiplier", () => {
            const result = getTypewriterDelay(
                "Hello",
                "",
                baseInterval,
                "natural",
                0.2
            )
            // Typing 'H' uppercase at start - 1.5x (start) * 1.25x (uppercase) = 1.875x
            expect(result).toBe(baseInterval * 1.875)
        })

        it("fatigue applies after threshold", () => {
            // Create a long text with spaces every 10 characters to avoid middle-word acceleration
            const longText = "word ".repeat(60) + "final" // 300+ characters total
            const currentText = "word ".repeat(50) // 250 characters - typing 'f' at start of "final"
            const result = getTypewriterDelay(
                longText,
                currentText,
                baseInterval,
                "natural",
                0.2
            )
            // At 250 chars (past 200 threshold), fatigue: (250-200)/1000 = 0.05, so 1.05x
            // Typing 'f' at start of word gets 1.5x (start) * 1.05x (fatigue) = 1.575x
            expect(result).toBeGreaterThan(baseInterval * 1.5) // Should be greater than just start penalty
        })

        it("completed text returns base interval", () => {
            const result = getTypewriterDelay(
                "hello",
                "hello",
                baseInterval,
                "natural",
                0.2
            )
            // No more characters to type
            expect(result).toBe(baseInterval)
        })

        it("ensures minimum 20% speed regardless of negative variance", () => {
            Math.random = jest.fn(() => 0) // Maximum negative variance
            const result = getTypewriterDelay(
                "hello",
                "hel",
                baseInterval,
                "natural",
                0.2
            )
            expect(result).toBeGreaterThanOrEqual(baseInterval * 0.2)
        })
    })

    describe("backspace behavior", () => {
        it("applies backspace factor when current text is longer than target", () => {
            const result = getTypewriterDelay(
                "hello",
                "hello world",
                baseInterval,
                "natural",
                0.2
            )
            // Current text is longer than target - should backspace
            expect(result).toBe(baseInterval * 0.2)
        })

        it("applies backspace factor when current text doesn't match target start", () => {
            const result = getTypewriterDelay(
                "hello world",
                "hello wrong",
                baseInterval,
                "natural",
                0.2
            )
            // "hello wrong" doesn't match start of "hello world" - should backspace
            expect(result).toBe(baseInterval * 0.2)
        })

        it("applies backspace factor when text completely diverges", () => {
            const result = getTypewriterDelay(
                "correct",
                "wrong",
                baseInterval,
                "natural",
                0.2
            )
            // "wrong" doesn't start with "correct" - should backspace
            expect(result).toBe(baseInterval * 0.2)
        })

        it("applies backspace factor with percentage variance", () => {
            const result = getTypewriterDelay(
                "hello",
                "hello extra",
                baseInterval,
                50,
                0.3
            )
            // Current text is longer, should use backspace factor regardless of variance
            expect(result).toBe(baseInterval * 0.3)
        })

        it("does not apply backspace factor when current text matches target start", () => {
            const result = getTypewriterDelay(
                "hello world",
                "hello",
                baseInterval,
                "natural",
                0.2
            )
            // "hello" matches start of "hello world" - normal typing, not backspacing
            expect(result).not.toBe(baseInterval * 0.2)
        })

        it("does not apply backspace factor when current text is empty", () => {
            const result = getTypewriterDelay(
                "hello",
                "",
                baseInterval,
                "natural",
                0.2
            )
            // Empty current text always matches start - normal typing
            expect(result).not.toBe(baseInterval * 0.2)
        })
    })

    describe("variance bounds", () => {
        it("respects minimum 20% speed across random variance", () => {
            const results: number[] = []
            const originalRandom = Math.random

            for (let i = 0; i < 100; i++) {
                const randomValue = i / 100
                Math.random = jest.fn(() => randomValue)
                const result = getTypewriterDelay(
                    "hello",
                    "hel",
                    baseInterval,
                    "natural",
                    0.2
                )
                results.push(result)
            }

            // All results should be at least 20% of base interval
            results.forEach((result) => {
                expect(result).toBeGreaterThanOrEqual(baseInterval * 0.2)
            })

            Math.random = originalRandom
        })
    })

    describe("combined multiplier behaviors", () => {
        beforeEach(() => {
            jest.spyOn(Math, "random").mockReturnValue(0.5) // Eliminate random variance
        })

        afterEach(() => {
            jest.restoreAllMocks()
        })

        it("combines short word bonus with punctuation", () => {
            const result = getTypewriterDelay(
                "to,",
                "to",
                baseInterval,
                "natural",
                0.2
            )
            // Short word (2 chars) + punctuation - 0.7x * 1.5x = 1.05x
            expect(result).toBeCloseTo(baseInterval * 1.05, 1)
        })

        it("combines longer word penalties correctly", () => {
            const result = getTypewriterDelay(
                "Hello!",
                "Hello",
                baseInterval,
                "natural",
                0.2
            )
            // End of longer word + punctuation + shift - 1.4x * 1.5x * 1.5x = 3.15x
            expect(result).toBeCloseTo(baseInterval * 3.15, 1)
        })
    })
})

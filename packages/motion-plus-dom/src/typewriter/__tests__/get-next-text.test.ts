import { getNextText } from "../get-next-text"

describe("getNextText", () => {
    describe("normal typing (no backspace needed)", () => {
        it("should type one character at a time when target is longer", () => {
            expect(getNextText("", "hello", "type", "character")).toBe("h")
            expect(getNextText("h", "hello", "type", "character")).toBe("he")
            expect(getNextText("he", "hello", "type", "character")).toBe("hel")
            expect(getNextText("hel", "hello", "type", "character")).toBe(
                "hell"
            )
            expect(getNextText("hell", "hello", "type", "character")).toBe(
                "hello"
            )
        })

        it("should work with replace mode 'all'", () => {
            expect(getNextText("", "hello", "all", "character")).toBe("h")
            expect(getNextText("h", "hello", "all", "character")).toBe("he")
        })
    })

    describe("backspace by character", () => {
        it("should remove one character when backspacing", () => {
            // Assuming needsBackspace returns true when current and target don't match
            expect(getNextText("hello", "hi", "type", "character")).toBe("hell")
            expect(getNextText("hell", "hi", "type", "character")).toBe("hel")
            expect(getNextText("hel", "hi", "type", "character")).toBe("he")
            expect(getNextText("he", "hi", "type", "character")).toBe("h")
        })

        it("should handle completely different strings", () => {
            expect(getNextText("abc", "xyz", "type", "character")).toBe("ab")
            expect(getNextText("ab", "xyz", "type", "character")).toBe("a")
            expect(getNextText("a", "xyz", "type", "character")).toBe("")
        })
    })

    describe("backspace by word", () => {
        it("should remove one word at a time", () => {
            // Testing with multi-word strings
            expect(getNextText("hello world", "hi", "type", "word")).toBe(
                "hello "
            )
            expect(getNextText("hello ", "hi", "type", "word")).toBe("")
        })

        it("should handle single words", () => {
            expect(getNextText("hello", "hi", "type", "word")).toBe("")
        })

        it("should handle strings with multiple spaces", () => {
            expect(getNextText("hello  world", "hi", "type", "word")).toBe(
                "hello  "
            )
        })
    })

    describe("backspace all (common prefix)", () => {
        it("should find and keep common prefix", () => {
            expect(
                getNextText("hello world", "hello there", "type", "all")
            ).toBe("hello ")
            expect(getNextText("testing", "test", "type", "all")).toBe("test")
            expect(getNextText("completely", "different", "type", "all")).toBe(
                ""
            )
        })

        it("should handle exact matches", () => {
            expect(getNextText("same", "same", "type", "all")).toBe("same")
        })

        it("should handle one string being prefix of another", () => {
            expect(getNextText("hello", "hello world", "type", "all")).toBe(
                "hello "
            )
            expect(getNextText("hello world", "hello", "type", "all")).toBe(
                "hello"
            )
        })

        it("should handle empty strings", () => {
            expect(getNextText("", "hello", "type", "all")).toBe("h")
            expect(getNextText("hello", "", "type", "all")).toBe("")
        })
    })

    describe("replace mode 'all'", () => {
        it("should always type forward regardless of backspace setting", () => {
            // When replace is "all", it should not trigger backspacing logic
            // First argument has always been replaced by this point
            expect(getNextText("", "right", "all", "character")).toBe("r")
            expect(getNextText("", "right", "all", "word")).toBe("r")
            expect(getNextText("", "right", "all", "all")).toBe("r")
        })
    })

    describe("edge cases", () => {
        it("should handle empty current string", () => {
            expect(getNextText("", "hello", "type", "character")).toBe("h")
            expect(getNextText("", "hello", "type", "word")).toBe("h")
            expect(getNextText("", "hello", "type", "all")).toBe("h")
        })

        it("should handle empty target string", () => {
            expect(getNextText("hello", "", "type", "character")).toBe("hell")
            expect(getNextText("hello", "", "type", "word")).toBe("")
            expect(getNextText("hello", "", "type", "all")).toBe("")
        })

        it("should handle identical strings", () => {
            expect(getNextText("same", "same", "type", "character")).toBe(
                "same"
            )
            expect(getNextText("same", "same", "type", "word")).toBe("same")
            expect(getNextText("same", "same", "type", "all")).toBe("same")
        })

        it("should handle single character strings", () => {
            expect(getNextText("a", "b", "type", "character")).toBe("")
            expect(getNextText("a", "b", "type", "word")).toBe("")
            expect(getNextText("a", "b", "type", "all")).toBe("")
        })

        it("should handle special characters and spaces", () => {
            expect(getNextText("hello!", "hello?", "type", "character")).toBe(
                "hello"
            )
            expect(getNextText("hello ", "hello\t", "type", "character")).toBe(
                "hello"
            )
        })
    })

    describe("typing progression scenarios", () => {
        it("should simulate realistic typing from 'hello' to 'world'", () => {
            let current = "hello"
            const target = "world"
            const steps: string[] = []

            // Simulate the progression
            while (current !== target) {
                current = getNextText(current, target, "type", "character")
                steps.push(current)

                // Prevent infinite loops in case of bugs
                if (steps.length > 20) break
            }

            expect(steps).toEqual([
                "hell",
                "hel",
                "he",
                "h",
                "",
                "w",
                "wo",
                "wor",
                "worl",
                "world",
            ])
        })

        it("should simulate word-by-word backspacing", () => {
            let current = "hello beautiful world"
            const target = "hi"
            const steps: string[] = []

            // Simulate the progression with word backspacing
            while (current !== target && current.length > 0) {
                current = getNextText(current, target, "type", "word")
                steps.push(current)

                // Prevent infinite loops
                if (steps.length > 10) break
            }

            expect(steps[0]).toBe("hello beautiful ")
            expect(steps[1]).toBe("hello ")
            expect(steps[2]).toBe("")
        })
    })
})

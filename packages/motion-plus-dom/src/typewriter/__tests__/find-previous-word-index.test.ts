import { findPreviousWordIndex } from "../find-previous-word-index"

describe("findPreviousWordIndex", () => {
    describe("normal word boundaries", () => {
        test("finds start of previous word in simple sentence", () => {
            const text = "hello world test"
            expect(findPreviousWordIndex(text, 16)).toBe(12) // "test" -> "world"
            expect(findPreviousWordIndex(text, 11)).toBe(6) // "world" -> "hello"
            expect(findPreviousWordIndex(text, 5)).toBe(0) // "hello" -> start
        })

        test("handles multiple words correctly", () => {
            const text = "the quick brown fox"
            expect(findPreviousWordIndex(text, 19)).toBe(16) // "fox" -> "brown"
            expect(findPreviousWordIndex(text, 15)).toBe(10) // "brown" -> "quick"
            expect(findPreviousWordIndex(text, 9)).toBe(4) // "quick" -> "the"
            expect(findPreviousWordIndex(text, 3)).toBe(0) // "the" -> start
        })
    })

    describe("whitespace handling", () => {
        test("skips trailing whitespace", () => {
            const text = "hello world   "
            expect(findPreviousWordIndex(text, 14)).toBe(6) // from end spaces to "hello"
            expect(findPreviousWordIndex(text, 13)).toBe(6)
            expect(findPreviousWordIndex(text, 12)).toBe(6)
        })

        test("handles multiple spaces between words", () => {
            const text = "hello    world"
            expect(findPreviousWordIndex(text, 14)).toBe(9) // "world" -> after spaces
            expect(findPreviousWordIndex(text, 9)).toBe(0) // from spaces to "hello"
        })

        test("handles tabs and other whitespace", () => {
            const text = "hello\t\nworld"
            expect(findPreviousWordIndex(text, 12)).toBe(7) // "world" -> after whitespace
            expect(findPreviousWordIndex(text, 7)).toBe(0) // from whitespace to "hello"
        })
    })

    describe("edge cases", () => {
        test("handles empty string", () => {
            expect(findPreviousWordIndex("", 0)).toBe(0)
        })

        test("handles single character", () => {
            expect(findPreviousWordIndex("a", 1)).toBe(0)
        })

        test("handles single word", () => {
            const text = "hello"
            expect(findPreviousWordIndex(text, 5)).toBe(0)
            expect(findPreviousWordIndex(text, 3)).toBe(0)
            expect(findPreviousWordIndex(text, 1)).toBe(0)
        })

        test("handles whitespace only string", () => {
            const text = "   "
            expect(findPreviousWordIndex(text, 3)).toBe(0)
            expect(findPreviousWordIndex(text, 2)).toBe(0)
            expect(findPreviousWordIndex(text, 1)).toBe(0)
        })

        test("handles fromIndex at beginning", () => {
            const text = "hello world"
            expect(findPreviousWordIndex(text, 0)).toBe(0)
        })

        test("handles fromIndex beyond string length", () => {
            const text = "hello world"
            expect(findPreviousWordIndex(text, 20)).toBe(6) // should work from end
        })
    })

    describe("boundary positions", () => {
        test("handles fromIndex at word boundaries", () => {
            const text = "hello world test"
            // fromIndex at space positions
            expect(findPreviousWordIndex(text, 6)).toBe(0) // at space after "hello"
            expect(findPreviousWordIndex(text, 12)).toBe(6) // at space after "world"
        })

        test("handles fromIndex in middle of words", () => {
            const text = "hello world test"
            expect(findPreviousWordIndex(text, 3)).toBe(0) // middle of "hello"
            expect(findPreviousWordIndex(text, 6)).toBe(0) // middle of "world"
            expect(findPreviousWordIndex(text, 14)).toBe(12) // middle of "test"
        })
    })

    describe("special characters", () => {
        test("handles punctuation as word characters", () => {
            const text = "hello, world!"
            expect(findPreviousWordIndex(text, 13)).toBe(7) // "world!" -> "hello,"
            expect(findPreviousWordIndex(text, 6)).toBe(0) // "hello," -> start
        })

        test("handles mixed content", () => {
            const text = "word1 word2 word3"
            expect(findPreviousWordIndex(text, 17)).toBe(12) // "word3" -> "word2"
            expect(findPreviousWordIndex(text, 11)).toBe(6) // "word2" -> "word1"
            expect(findPreviousWordIndex(text, 5)).toBe(0) // "word1" -> start
        })
    })

    describe("unicode and special cases", () => {
        test("handles unicode characters", () => {
            const text = "héllo wörld"
            expect(findPreviousWordIndex(text, 11)).toBe(6) // "wörld" -> "héllo"
            expect(findPreviousWordIndex(text, 5)).toBe(0) // "héllo" -> start
        })

        test("handles emojis", () => {
            const text = "hello 😀 world"
            expect(findPreviousWordIndex(text, 13)).toBe(9) // "world" -> "😀"
            expect(findPreviousWordIndex(text, 7)).toBe(6) // "😀" -> "hello "
            expect(findPreviousWordIndex(text, 6)).toBe(0) // "😀" -> "hello"
        })
    })

    describe("realistic typewriter scenarios", () => {
        test("handles typical text replacement scenarios", () => {
            // Simulating changing "Hello world" to "Hello universe"
            const oldText = "Hello world"

            // When replacing at end of "world", should go back to start of "world"
            expect(findPreviousWordIndex(oldText, 11)).toBe(6)
        })

        test("handles sentence with punctuation", () => {
            const text = "Hello, how are you?"
            expect(findPreviousWordIndex(text, 19)).toBe(15) // "you?" -> "are"
            expect(findPreviousWordIndex(text, 14)).toBe(11) // "are" -> "how"
            expect(findPreviousWordIndex(text, 10)).toBe(7) // "how" -> ","
            expect(findPreviousWordIndex(text, 6)).toBe(0) // "," -> "Hello"
        })
    })
})

import { findCommonPrefixIndex } from "../find-common-prefix-index"

describe("findCommonPrefix", () => {
    describe("strings with common prefixes", () => {
        it("should find common prefix in similar words", () => {
            expect(findCommonPrefixIndex("hello", "help")).toBe(3) // "hel"
            expect(findCommonPrefixIndex("testing", "test")).toBe(4) // "test"
            expect(findCommonPrefixIndex("javascript", "java")).toBe(4) // "java"
        })

        it("should find common prefix in sentences", () => {
            expect(findCommonPrefixIndex("hello world", "hello there")).toBe(6) // "hello "
            expect(
                findCommonPrefixIndex("the quick brown", "the quick red")
            ).toBe(10) // "the quick "
            expect(findCommonPrefixIndex("good morning", "good night")).toBe(5) // "good "
        })

        it("should handle partial matches", () => {
            expect(findCommonPrefixIndex("abcdef", "abcxyz")).toBe(3) // "abc"
            expect(findCommonPrefixIndex("programming", "program")).toBe(7) // "program"
            expect(findCommonPrefixIndex("typescript", "typewriter")).toBe(4) // "type"
        })
    })

    describe("strings with no common prefix", () => {
        it("should return 0 for completely different strings", () => {
            expect(findCommonPrefixIndex("abc", "xyz")).toBe(0)
            expect(findCommonPrefixIndex("hello", "world")).toBe(0)
            expect(findCommonPrefixIndex("cat", "dog")).toBe(0)
        })

        it("should return 0 for different first characters", () => {
            expect(findCommonPrefixIndex("apple", "banana")).toBe(0)
            expect(findCommonPrefixIndex("zebra", "elephant")).toBe(0)
            expect(findCommonPrefixIndex("1234", "5678")).toBe(0)
        })
    })

    describe("identical strings", () => {
        it("should return full length for identical strings", () => {
            expect(findCommonPrefixIndex("hello", "hello")).toBe(5)
            expect(findCommonPrefixIndex("test", "test")).toBe(4)
            expect(findCommonPrefixIndex("", "")).toBe(0)
            expect(findCommonPrefixIndex("a", "a")).toBe(1)
        })

        it("should handle longer identical strings", () => {
            const longString = "this is a very long string for testing"
            expect(findCommonPrefixIndex(longString, longString)).toBe(
                longString.length
            )
        })
    })

    describe("one string is prefix of another", () => {
        it("should handle when first string is prefix of second", () => {
            expect(findCommonPrefixIndex("test", "testing")).toBe(4) // "test"
            expect(findCommonPrefixIndex("hello", "hello world")).toBe(5) // "hello"
            expect(findCommonPrefixIndex("a", "abc")).toBe(1) // "a"
        })

        it("should handle when second string is prefix of first", () => {
            expect(findCommonPrefixIndex("testing", "test")).toBe(4) // "test"
            expect(findCommonPrefixIndex("hello world", "hello")).toBe(5) // "hello"
            expect(findCommonPrefixIndex("abc", "a")).toBe(1) // "a"
        })
    })

    describe("empty strings", () => {
        it("should handle empty current string", () => {
            expect(findCommonPrefixIndex("", "hello")).toBe(0)
            expect(findCommonPrefixIndex("", "test")).toBe(0)
            expect(findCommonPrefixIndex("", "a")).toBe(0)
        })

        it("should handle empty target string", () => {
            expect(findCommonPrefixIndex("hello", "")).toBe(0)
            expect(findCommonPrefixIndex("test", "")).toBe(0)
            expect(findCommonPrefixIndex("a", "")).toBe(0)
        })

        it("should handle both strings empty", () => {
            expect(findCommonPrefixIndex("", "")).toBe(0)
        })
    })

    describe("special characters and whitespace", () => {
        it("should handle strings with spaces", () => {
            expect(findCommonPrefixIndex("hello world", "hello universe")).toBe(
                6
            ) // "hello "
            expect(findCommonPrefixIndex("  leading spaces", "  leading")).toBe(
                9
            ) // "  leading"
            expect(
                findCommonPrefixIndex("trailing  ", "trailing  spaces")
            ).toBe(10) // "trailing  "
        })

        it("should handle special characters", () => {
            expect(findCommonPrefixIndex("hello!", "hello?")).toBe(5) // "hello"
            expect(
                findCommonPrefixIndex("test@example.com", "test@example.org")
            ).toBe(13) // "test@example."
            expect(findCommonPrefixIndex("$100", "$200")).toBe(1) // "$"
        })

        it("should handle unicode characters", () => {
            expect(findCommonPrefixIndex("café", "car")).toBe(2) // "ca"
            expect(findCommonPrefixIndex("🚀 rocket", "🚀 ship")).toBe(3) // "🚀 " (emoji counts as 2 in UTF-16)
            expect(findCommonPrefixIndex("naïve", "naïf")).toBe(3) // "naï"
        })

        it("should handle mixed case", () => {
            expect(findCommonPrefixIndex("Hello", "hello")).toBe(0) // case sensitive
            expect(findCommonPrefixIndex("TEST", "test")).toBe(0) // case sensitive
            expect(findCommonPrefixIndex("CamelCase", "CamelCased")).toBe(9) // "CamelCase"
        })
    })

    describe("edge cases", () => {
        it("should handle single character strings", () => {
            expect(findCommonPrefixIndex("a", "b")).toBe(0)
            expect(findCommonPrefixIndex("a", "a")).toBe(1)
            expect(findCommonPrefixIndex("x", "xyz")).toBe(1)
            expect(findCommonPrefixIndex("xyz", "x")).toBe(1)
        })

        it("should handle very long strings", () => {
            const prefix = "a".repeat(1000)
            const string1 = prefix + "x"
            const string2 = prefix + "y"
            expect(findCommonPrefixIndex(string1, string2)).toBe(1000)
        })

        it("should handle strings with only whitespace", () => {
            expect(findCommonPrefixIndex("   ", "  ")).toBe(2) // "  "
            expect(findCommonPrefixIndex("\t\t", "\t\n")).toBe(1) // "\t"
            expect(findCommonPrefixIndex("\n\n", "\n\n")).toBe(2) // "\n\n"
        })

        it("should handle strings with numbers", () => {
            expect(findCommonPrefixIndex("123456", "123789")).toBe(3) // "123"
            expect(
                findCommonPrefixIndex("version-1.2.3", "version-1.2.4")
            ).toBe(12) // "version-1.2."
            expect(findCommonPrefixIndex("2023-01-01", "2023-01-02")).toBe(9) // "2023-01-0"
        })
    })
})

import { needsBackspace } from "../needs-backspace"

describe("needsBackspace", () => {
    describe("when currentText is longer than fullText", () => {
        it("should return true", () => {
            expect(needsBackspace("hello world", "hello")).toBe(true)
            expect(needsBackspace("abc", "ab")).toBe(true)
            expect(needsBackspace("test", "")).toBe(true)
        })
    })

    describe("when currentText doesn't match the beginning of fullText", () => {
        it("should return true when currentText exists but fullText doesn't start with it", () => {
            expect(needsBackspace("hello", "goodbye")).toBe(true)
            expect(needsBackspace("abc", "xyz")).toBe(true)
            expect(needsBackspace("test", "demo")).toBe(true)
        })

        it("should return true when currentText is partially wrong", () => {
            expect(needsBackspace("helo", "hello")).toBe(true)
            expect(needsBackspace("wrng", "wrong")).toBe(true)
        })
    })

    describe("when currentText is empty", () => {
        it("should return false", () => {
            expect(needsBackspace("", "hello")).toBe(false)
            expect(needsBackspace("", "")).toBe(false)
            expect(needsBackspace("", "test")).toBe(false)
        })
    })

    describe("when currentText matches the beginning of fullText", () => {
        it("should return false when currentText is a prefix of fullText", () => {
            expect(needsBackspace("hello", "hello world")).toBe(false)
            expect(needsBackspace("te", "test")).toBe(false)
            expect(needsBackspace("a", "abc")).toBe(false)
        })

        it("should return false when currentText exactly matches fullText", () => {
            expect(needsBackspace("hello", "hello")).toBe(false)
            expect(needsBackspace("test", "test")).toBe(false)
            expect(needsBackspace("", "")).toBe(false)
        })
    })

    describe("edge cases", () => {
        it("should handle single character differences", () => {
            expect(needsBackspace("a", "b")).toBe(true)
            expect(needsBackspace("a", "a")).toBe(false)
        })

        it("should handle whitespace correctly", () => {
            expect(needsBackspace("hello ", "hello world")).toBe(false)
            expect(needsBackspace("hello", "hello ")).toBe(false)
            expect(needsBackspace(" hello", "hello")).toBe(true)
        })

        it("should handle special characters", () => {
            expect(needsBackspace("test!", "test!@#")).toBe(false)
            expect(needsBackspace("test@", "test!")).toBe(true)
        })
    })
})

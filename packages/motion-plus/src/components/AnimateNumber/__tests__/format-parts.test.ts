import { formatToParts } from "../utils/format-parts"

describe("formatToParts", () => {
    it("splits a simple integer into digit parts keyed RTL", () => {
        const result = formatToParts(123, {})
        expect(result.integer).toHaveLength(3)
        expect(result.integer.map((p) => p.value)).toEqual([1, 2, 3])
        // Keys should be unique
        const keys = result.integer.map((p) => p.key)
        expect(new Set(keys).size).toBe(keys.length)
    })

    it("returns the formatted string", () => {
        const result = formatToParts(1234, { locales: "en-US" })
        expect(result.formatted).toBe("1,234")
    })

    it("handles zero", () => {
        const result = formatToParts(0, {})
        expect(result.integer).toHaveLength(1)
        expect(result.integer[0]!.value).toBe(0)
    })

    it("handles negative numbers with a sign part", () => {
        const result = formatToParts(-42, { locales: "en-US" })
        // Sign should be in pre
        const signParts = result.pre.filter((p) => p.type === "sign")
        expect(signParts.length).toBeGreaterThanOrEqual(1)
        // Integer digits should be 4 and 2
        expect(result.integer.map((p) => p.value)).toEqual([4, 2])
    })

    it("splits decimals into fraction parts", () => {
        const result = formatToParts(3.14, {
            format: { minimumFractionDigits: 2, maximumFractionDigits: 2 },
        })
        // Should have decimal point + fraction digits
        const decimalParts = result.fraction.filter(
            (p) => p.type === "decimal"
        )
        expect(decimalParts).toHaveLength(1)
        const fractionDigits = result.fraction.filter(
            (p) => p.type === "fraction"
        )
        expect(fractionDigits.map((p) => p.value)).toEqual([1, 4])
    })

    it("handles group separators in large numbers", () => {
        const result = formatToParts(1000000, { locales: "en-US" })
        const groupParts = result.integer.filter((p) => p.type === "group")
        expect(groupParts.length).toBeGreaterThanOrEqual(1)
        expect(groupParts[0]!.value).toBe(",")
    })

    it("adds prefix to pre section", () => {
        const result = formatToParts(100, {}, "~")
        const prefixParts = result.pre.filter((p) => p.type === "prefix")
        expect(prefixParts).toHaveLength(1)
        expect(prefixParts[0]!.value).toBe("~")
        expect(result.formatted).toContain("~")
    })

    it("adds suffix to post section", () => {
        const result = formatToParts(100, {}, undefined, "/mo")
        const suffixParts = result.post.filter((p) => p.type === "suffix")
        expect(suffixParts).toHaveLength(1)
        expect(suffixParts[0]!.value).toBe("/mo")
        expect(result.formatted).toContain("/mo")
    })

    it("adds both prefix and suffix", () => {
        const result = formatToParts(50, {}, "~", "%")
        expect(result.pre.some((p) => p.type === "prefix")).toBe(true)
        expect(result.post.some((p) => p.type === "suffix")).toBe(true)
        expect(result.formatted).toBe("~50%")
    })

    it("handles currency formatting", () => {
        const result = formatToParts(9.99, {
            locales: "en-US",
            format: { style: "currency", currency: "USD" },
        })
        // Should have currency symbol in pre
        const currencyParts = result.pre.filter((p) => p.type === "currency")
        expect(currencyParts.length).toBeGreaterThanOrEqual(1)
        expect(result.formatted).toContain("$")
    })

    it("handles compact notation", () => {
        const result = formatToParts(1500, {
            locales: "en-US",
            format: { notation: "compact" },
        })
        // Compact notation produces "1.5K" or similar
        expect(result.formatted).toMatch(/1\.5K|2K|1,500/)
    })

    it("handles string input", () => {
        const result = formatToParts("42", {})
        expect(result.integer.map((p) => p.value)).toEqual([4, 2])
    })

    it("handles bigint input", () => {
        const result = formatToParts(BigInt(999), {})
        expect(result.integer.map((p) => p.value)).toEqual([9, 9, 9])
    })

    it("produces unique keys across all sections", () => {
        const result = formatToParts(-1234.56, {
            locales: "en-US",
            format: { minimumFractionDigits: 2 },
        })
        const allKeys = [
            ...result.pre.map((p) => p.key),
            ...result.integer.map((p) => p.key),
            ...result.fraction.map((p) => p.key),
            ...result.post.map((p) => p.key),
        ]
        expect(new Set(allKeys).size).toBe(allKeys.length)
    })

    it("integer keys are assigned RTL for stable layout", () => {
        // When going from 99 to 100, the ones digit key should stay stable
        const result99 = formatToParts(99, {})
        const result100 = formatToParts(100, {})

        // The last key in result99 should match the last key in result100
        // because RTL keying means the rightmost digit gets key 0
        const lastKey99 = result99.integer[result99.integer.length - 1]!.key
        const lastKey100 = result100.integer[result100.integer.length - 1]!.key
        expect(lastKey99).toBe(lastKey100)
    })
})

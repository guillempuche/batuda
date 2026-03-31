export type Justify = "left" | "right"

// Merge the plus and minus sign types
export type NumberPartType =
    | Exclude<Intl.NumberFormatPartTypes, "minusSign" | "plusSign">
    | "sign"
    | "prefix"
    | "suffix"
// These need to be separated for the discriminated union to work:
// https://www.typescriptlang.org/play/?target=99&ssl=8&ssc=1&pln=9&pc=1#code/C4TwDgpgBAIglgczsKBeKBvKpIC4oDkcAdsBAhAE4FQA+hAZpQIYDGwcA9sQQNxQA3ZgBsArhHzFRAWwBGVKAF8AsACgc0AMIALZpTSZs4CYVa7q-QSPH4AzsEokEStWoaji7LsSgATTgDKwKIMDAAUYHrA+PBIKPQ6egCUmGpQUHAMUBFRAHQaaKjoRKTkVDS09JGUwPnGhcVMbBzcBCkYaelQ1cCdilAQwrbQHapd3VFQAPRTUAA8ALTY2nC2GbY8KImUADRQwnAA1tAAkgS+AwAekOzZAPxJfWqKQA
export type IntegerPart = { type: NumberPartType & "integer"; value: number }
export type FractionPart = { type: NumberPartType & "fraction"; value: number }
export type DigitPart = IntegerPart | FractionPart
export type SymbolPart = {
    type: Exclude<NumberPartType, "integer" | "fraction">
    value: string
}
export type NumberPart = DigitPart | SymbolPart

export type KeyedPart = { key: string }
export type KeyedDigitPart = DigitPart & KeyedPart
export type KeyedSymbolPart = SymbolPart & KeyedPart
export type KeyedNumberPart = KeyedDigitPart | KeyedSymbolPart

export type Em = `${number}em`

/**
 * Controls the spin direction of digit animations.
 *
 * - A positive number (e.g. `1`) forces digits to always spin upward,
 *   wrapping from 9 → 0.
 * - A negative number (e.g. `-1`) forces digits to always spin downward,
 *   wrapping from 0 → 9.
 * - `0` or `undefined` uses the default auto-detection (shortest path
 *   based on value change).
 * - A function receives `(oldValue, newValue)` and should return a number
 *   indicating the direction.
 */
export type Trend = number | ((oldValue: number, value: number) => number)

export interface Data {
    pre: KeyedNumberPart[]
    integer: KeyedNumberPart[]
    fraction: KeyedNumberPart[]
    post: KeyedNumberPart[]
    formatted: string
}

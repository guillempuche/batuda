import { needsBackspace } from "./needs-backspace"

/**
 * Natural typing variance patterns based on research
 * Returns delay as a multiple of the base interval using realistic typing patterns
 */

function mix(a: number, b: number, t: number): number {
    return a + (b - a) * t
}

/**
 * Calculate a delay before typing the next character in the text.
 */
export function getTypewriterDelay(
    fullText: string,
    currentText: string,
    interval: number,
    variance: number | "natural",
    backspaceFactor: number
): number {
    if (needsBackspace(currentText, fullText)) {
        return interval * backspaceFactor
    }

    if (variance === "natural") {
        return getNaturalDelay(fullText, currentText, interval)
    }

    if (typeof variance === "number" && variance > 0) {
        // Apply percentage-based random variance
        const varianceAmount = interval * (variance / 100)
        return interval + mix(-varianceAmount, varianceAmount, Math.random())
    }

    return interval
}

function getNaturalDelay(
    fullText: string,
    currentText: string,
    interval: number
): number {
    const currentIndex = currentText.length
    const char = fullText[currentIndex]
    const previousChar = fullText[currentIndex - 1]

    if (!char) return interval

    // Find current position in word and full word boundaries
    const beforeText = fullText.slice(0, currentIndex)
    const lastSpaceIndex = beforeText.lastIndexOf(" ")
    const positionInWord = currentIndex - lastSpaceIndex - 1

    // Find the full word boundaries (start and end)
    const wordStart = lastSpaceIndex + 1
    const afterCurrentIndex = fullText.slice(currentIndex)
    const nextSpaceIndex = afterCurrentIndex.indexOf(" ")
    const wordEnd =
        nextSpaceIndex === -1 ? fullText.length : currentIndex + nextSpaceIndex
    const wordLength = wordEnd - wordStart

    // Start with base multiplier
    let delayMultiplier = 1.0

    // Thinking pauses at sentence boundaries (major effect)
    if (previousChar && /[.!?]/.test(previousChar) && char === " ") {
        delayMultiplier *= 3 // 200% longer pause for thinking
    }

    // Short words (1-3 chars) are faster due to high frequency and muscle memory
    if (wordLength <= 3) {
        delayMultiplier *= 0.7 // 30% faster for short/common words
    }
    // Only apply start/end penalties to longer words (4+ characters)
    else {
        // Slower at beginning of words (muscle memory activation)
        if (positionInWord === 0 && char !== " ") {
            delayMultiplier *= 1.5
        }

        // Slower at end of words (preparation for next word)
        if (positionInWord === wordLength - 1) {
            delayMultiplier *= 1.4
        }
    }

    // Acceleration in word middle (people speed up mid-word) - only for longer words
    if (
        positionInWord > 0 &&
        positionInWord < wordLength - 1 &&
        wordLength > 3
    ) {
        const middleBoost = Math.min(positionInWord / wordLength, 0.4)
        delayMultiplier *= 1.0 - middleBoost
    }

    // Slower for punctuation (check the character being typed)
    if (punctuation.has(char)) {
        delayMultiplier *= 1.5
    }

    // Extra slowdown for Shift-modifier characters (check the character being typed)
    if (shiftRequired.has(char)) {
        delayMultiplier *= 1.5
    }

    // Numbers are slower to type (check the character being typed)
    if (/\d/.test(char)) {
        delayMultiplier *= 1.3
    }

    // Long words slow down slightly (concentration required)
    if (wordLength > 8) {
        delayMultiplier *= 1.3
    }

    // Slower for uppercase letters (check the character being typed)
    if (char !== char.toLowerCase()) {
        delayMultiplier *= 1.25
    }

    // Fatigue over long texts (gradual slowdown)
    const fatigueThreshold = 200 // Start fatigue after 200 characters
    if (currentIndex > fatigueThreshold) {
        const fatigueAmount = Math.min(
            (currentIndex - fatigueThreshold) / 1000,
            0.3
        ) // Up to 30% slower
        delayMultiplier *= 1.0 + fatigueAmount
    }

    // Add random variance (±25% of current delay)
    const randomVariance = mix(-0.25, 0.25, Math.random())
    delayMultiplier *= 1.0 + randomVariance

    // Apply multiplier to base interval
    const finalDelay = interval * delayMultiplier

    // Minimum delay of 20% of base speed (prevent too fast typing)
    return Math.max(interval * 0.2, finalDelay)
}

const punctuation = new Set([
    ".",
    ",",
    "!",
    "?",
    ":",
    ";",
    "'",
    '"',
    "-",
    "(",
    ")",
])

const shiftRequired = new Set([
    "!",
    "@",
    "#",
    "$",
    "%",
    "^",
    "&",
    "*",
    "(",
    ")",
    "_",
    "+",
    "{",
    "}",
    "|",
    ":",
    '"',
    "<",
    ">",
    "?",
])

export function findPreviousWordIndex(text: string, fromIndex: number) {
    // Start from the current position and go backwards
    let i = fromIndex - 1

    // Skip any trailing whitespace
    while (i >= 0 && /\s/.test(text[i])) {
        i--
    }

    // Find the start of the current word
    while (i >= 0 && !/\s/.test(text[i])) {
        i--
    }

    // Return the position after the space (start of the word we want to keep)
    return Math.max(0, i + 1)
}

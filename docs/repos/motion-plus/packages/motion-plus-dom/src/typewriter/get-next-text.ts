import { findCommonPrefixIndex } from "./find-common-prefix-index"
import { findPreviousWordIndex } from "./find-previous-word-index"
import { needsBackspace } from "./needs-backspace"

export function getNextText(
    current: string,
    target: string,
    replace: "all" | "type",
    backspace: "character" | "word" | "all"
) {
    if (replace === "type" && needsBackspace(current, target)) {
        if (backspace === "all") {
            return target.slice(0, findCommonPrefixIndex(current, target))
        } else if (backspace === "word") {
            // Backspace one word at a time
            const newLength = findPreviousWordIndex(current, current.length)
            return current.slice(0, newLength)
        } else {
            // backspace === "character" - backspace one character at a time
            return current.slice(0, -1)
        }
    }

    return target.slice(0, current.length + 1)
}

import { DEFAULT_SCRAMBLE_CHARS } from "./default-chars"

export function getScrambleChar(chars: string | string[] | undefined): string {
    const charSet = chars ?? DEFAULT_SCRAMBLE_CHARS

    if (typeof charSet === "string") {
        return charSet[Math.floor(Math.random() * charSet.length)]
    }

    return charSet[Math.floor(Math.random() * charSet.length)]
}

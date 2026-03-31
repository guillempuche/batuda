import { formatErrorMessage } from "./format-error-message"

const warned = new Set<string>()

export function hasWarned(message: string) {
    return warned.has(message)
}

export function warnOnce(
    condition: boolean,
    message: string,
    errorCode?: string
) {
    if (condition || warned.has(message)) return

    console.warn(formatErrorMessage(message, errorCode))
    warned.add(message)
}

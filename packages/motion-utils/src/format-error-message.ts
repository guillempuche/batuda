export function formatErrorMessage(message: string, errorCode?: string) {
    return errorCode
        ? `${message}. For more information and steps for solving, visit https://motion.dev/troubleshooting/${errorCode}`
        : message
}

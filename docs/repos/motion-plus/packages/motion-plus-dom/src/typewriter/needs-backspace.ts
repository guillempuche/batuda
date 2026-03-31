export function needsBackspace(currentText: string, fullText: string) {
    return (
        currentText.length > fullText.length ||
        (currentText.length > 0 && !fullText.startsWith(currentText))
    )
}

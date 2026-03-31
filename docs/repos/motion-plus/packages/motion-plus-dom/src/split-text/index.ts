import { ElementOrSelector, resolveElements } from "motion-dom"
import { invariant } from "motion-utils"

interface SplitTextOptions {
    splitBy?: string
    preserveHyphens?: boolean
    charClass?: string
    wordClass?: string
    lineClass?: string
}

function createSpan(className?: string, index?: number) {
    const span = document.createElement("span")

    if (className) {
        span.className = className
    }

    if (index !== undefined) {
        span.dataset.index = index.toString()
    }

    span.style.display = "inline-block"
    span.style.verticalAlign = "top"

    return span
}

function addToken(
    element: HTMLElement,
    token: string,
    className: string,
    index?: number
) {
    const charSpan = createSpan(className, index)
    charSpan.textContent = token
    element.appendChild(charSpan)
    return charSpan
}

/**
 * Splits text content of an element into characters, words, and lines.
 *
 * @param elementOrSelector - The element or selector of the element to split. If multiple elements are found, only the first will be split.
 * @param options - Options.
 * @returns An object containing chars, words, and lines arrays.
 */
export function splitText(
    elementOrSelector: ElementOrSelector,
    {
        splitBy = " ",
        preserveHyphens = false,
        charClass = "split-char",
        wordClass = "split-word",
        lineClass = "split-line",
    }: SplitTextOptions = {}
) {
    /**
     * We currently only support splitting a single element.
     * This could be changed in a future version.
     */
    const [element] = resolveElements(elementOrSelector) as HTMLElement[]

    invariant(Boolean(element), "Element not found")

    const text = element.textContent || ""
    element.setAttribute("aria-label", text)
    element.textContent = ""

    const splitElements = {
        chars: [] as HTMLSpanElement[],
        words: [] as HTMLSpanElement[],
        lines: [] as HTMLSpanElement[],
    }

    /**
     * Split the text into words using the provided delimiter.
     */
    const words = text.split(splitBy)
    const wordElements: HTMLSpanElement[] = []
    const spacerElements: (HTMLSpanElement | Text)[] = []

    /**
     * Create word spans.
     */
    for (let wordIndex = 0; wordIndex < words.length; wordIndex++) {
        const word = words[wordIndex]
        const wordSpan = createSpan(wordClass, wordIndex)
        splitElements.words.push(wordSpan)
        wordElements.push(wordSpan)

        /**
         * Create char spans.
         * Skip char splitting when preserveHyphens is enabled to allow
         * browser auto-hyphenation and soft hyphens to work.
         */
        if (preserveHyphens) {
            wordSpan.innerHTML = word
        } else {
            const charList = Array.from(word)
            for (let charIndex = 0; charIndex < charList.length; charIndex++) {
                const char = charList[charIndex]
                const charSpan = addToken(wordSpan, char, charClass, charIndex)
                splitElements.chars.push(charSpan)
            }
        }

        /**
         * Add the word span to the parent element.
         */
        element.appendChild(wordSpan)

        /**
         * Add the delimiter after the word. If the delimiter is a space,
         * add a space text node directly to the parent element.
         */
        if (wordIndex < words.length - 1) {
            if (splitBy === " ") {
                const spaceNode = document.createTextNode(" ")
                element.appendChild(spaceNode)
                spacerElements.push(spaceNode)
            } else {
                const delimiterSpan = addToken(
                    wordSpan,
                    splitBy,
                    `${charClass}-delimiter`
                )
                splitElements.chars.push(delimiterSpan)
            }
        }
    }

    /**
     * Read: Measure the top offset of each word for line detection.
     */
    const wordData = wordElements.map((wordSpan, index) => {
        return {
            element: wordSpan,
            top: wordSpan.offsetTop,
            index,
            spacer:
                index < spacerElements.length ? spacerElements[index] : null,
        }
    })

    /**
     * Write: Group words into lines based on measured top offsets.
     */
    const lines: Array<{
        elements: Array<HTMLSpanElement | Text>
        lineIndex: number
    }> = []
    let currentLine: Array<HTMLSpanElement | Text> = []
    let currentTop = wordData[0]?.top ?? 0
    let lineIndex = 0

    for (let i = 0; i < wordData.length; i++) {
        const { element, top, spacer } = wordData[i]

        // Check if word starts a new line
        if (top > currentTop && currentLine.length > 0) {
            // Complete current line and start a new one
            lines.push({ elements: currentLine, lineIndex: lineIndex++ })
            currentLine = []
            currentTop = top
        }

        // Add word to current line
        currentLine.push(element)

        // Add spacer if it exists
        if (spacer) {
            currentLine.push(spacer)
        }
    }

    // Add the last line if it has any elements
    if (currentLine.length > 0) {
        lines.push({ elements: currentLine, lineIndex })
    }

    /**
     * Write: Rebuild element with lines.
     */
    element.textContent = ""

    for (const { elements, lineIndex } of lines) {
        const lineSpan = createSpan(lineClass, lineIndex)
        lineSpan.style.display = "inline-block"
        splitElements.lines.push(lineSpan)

        /**
         * Build the line with the word elements.
         */
        for (const node of elements) {
            lineSpan.appendChild(node)
        }

        element.appendChild(lineSpan)
    }

    return splitElements
}

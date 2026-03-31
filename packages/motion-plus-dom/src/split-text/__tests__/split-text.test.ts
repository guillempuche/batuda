import { splitText } from ".."

describe("splitText", () => {
    let container: HTMLDivElement

    beforeEach(() => {
        container = document.createElement("div")
        document.body.appendChild(container)
    })

    afterEach(() => {
        document.body.removeChild(container)
    })

    it("should split text into default characters, words, and lines", () => {
        container.textContent = "Hello world"
        const result = splitText(container)

        expect(result.chars).toHaveLength(10) // "Hello" + "world" = 10 chars
        expect(result.words).toHaveLength(2)
        expect(result.lines).toHaveLength(1)

        // Check default classes
        expect(result.chars[0].className).toBe("split-char")
        expect(result.words[0].className).toBe("split-word")
        expect(result.lines[0].className).toBe("split-line")
    })

    it("should add aria-label with original text to the container", () => {
        const originalText = "Hello accessibility world"
        container.textContent = originalText
        splitText(container)

        expect(container.getAttribute("aria-label")).toBe(originalText)
    })

    it("should use custom class names when provided", () => {
        container.textContent = "Test"
        const result = splitText(container, {
            charClass: "custom-char",
            wordClass: "custom-word",
            lineClass: "custom-line",
        })

        expect(result.chars[0].className).toBe("custom-char")
        expect(result.words[0].className).toBe("custom-word")
        expect(result.lines[0].className).toBe("custom-line")
    })

    it("should split by custom delimiter", () => {
        container.textContent = "one,two,three"
        const result = splitText(container, {
            splitBy: ",",
        })

        expect(result.words).toHaveLength(3)
        // Check if delimiters are preserved
        const delimiters = container.querySelectorAll(".split-char-delimiter")
        expect(delimiters).toHaveLength(2) // Two commas between three words
        expect(delimiters[0].textContent).toBe(",")
    })

    it("should handle multiple lines correctly", () => {
        // Mock offsetTop for line detection
        const mockOffsetTop = jest.fn()
        Object.defineProperty(HTMLElement.prototype, "offsetTop", {
            get() {
                return mockOffsetTop(this.textContent)
            },
        })

        container.textContent = "Line-1 Line-2 Line-3"

        // Simulate different offsetTop values for different lines
        mockOffsetTop.mockImplementation((text) => {
            if (text?.includes("Line-1")) return 0
            if (text?.includes("Line-2")) return 20
            if (text?.includes("Line-3")) return 40
            return 0
        })

        const result = splitText(container)
        expect(result.lines).toHaveLength(3)
    })

    it("should handle empty text content", () => {
        container.textContent = ""
        const result = splitText(container)

        expect(result.chars).toHaveLength(0)
        expect(result.words).toHaveLength(1)
        expect(result.lines).toHaveLength(1)
    })

    it("should handle single character text", () => {
        container.textContent = "A"
        const result = splitText(container)

        expect(result.chars).toHaveLength(1)
        expect(result.words).toHaveLength(1)
        expect(result.lines).toHaveLength(1)
    })

    it("should preserve whitespace between words", () => {
        container.textContent = "Hello world with spaces"

        splitText(container)

        // Check that spacing is preserved in the content
        expect(container.textContent).toBe("Hello world with spaces")

        // Check DOM structure for space text nodes between word spans
        const wordSpans = container.querySelectorAll(".split-word")
        expect(wordSpans).toHaveLength(4) // "Hello", "world", "with", "spaces"

        // Check that there are text nodes between spans (spaces)
        const firstWordSpan = wordSpans[0]

        // Get the node between the first and second word
        const spacingNode = firstWordSpan.nextSibling

        // Verify it's a text node
        expect(spacingNode?.nodeType).toBe(Node.TEXT_NODE)

        // Verify it contains a space
        expect(spacingNode?.textContent).toBe(" ")

        // Test that each word has a space after it (except the last one)
        for (let i = 0; i < wordSpans.length - 1; i++) {
            const wordSpan = wordSpans[i]
            const nextNode = wordSpan.nextSibling
            expect(nextNode?.nodeType).toBe(Node.TEXT_NODE)
            expect(nextNode?.textContent).toBe(" ")
        }

        // The last word should not have a space after it
        const lastWordSpan = wordSpans[wordSpans.length - 1]
        expect(lastWordSpan.nextSibling).toBeNull()
    })

    it("should attach non-space delimiters to their preceding words", () => {
        container.textContent = "one,two,three"

        const result = splitText(container, {
            splitBy: ",",
        })

        // Check that all content is preserved
        expect(container.textContent).toBe("one,two,three")

        // Check for words
        expect(result.words).toHaveLength(3)

        // Check for delimiters - should be attached to their words, not as separate nodes
        const delimiters = container.querySelectorAll(".split-char-delimiter")
        expect(delimiters).toHaveLength(2) // Two commas

        // First word should have a delimiter as its last child
        const firstWord = result.words[0]
        const lastChildOfFirstWord = firstWord.lastChild
        expect(lastChildOfFirstWord?.textContent).toBe(",")
        expect(
            (lastChildOfFirstWord as HTMLElement).classList.contains(
                "split-char-delimiter"
            )
        ).toBe(true)

        // Second word should also have a delimiter as its last child
        const secondWord = result.words[1]
        const lastChildOfSecondWord = secondWord.lastChild
        expect(lastChildOfSecondWord?.textContent).toBe(",")
        expect(
            (lastChildOfSecondWord as HTMLElement).classList.contains(
                "split-char-delimiter"
            )
        ).toBe(true)

        // Third word should not have a delimiter
        const thirdWord = result.words[2]
        const lastChildOfThirdWord = thirdWord.lastChild
        expect(
            (lastChildOfThirdWord as HTMLElement).classList.contains(
                "split-char-delimiter"
            )
        ).toBe(false)

        // Check that delimiters are part of char elements for animation
        const delimiterChars = result.chars.filter((char) =>
            char.classList.contains("split-char-delimiter")
        )
        expect(delimiterChars).toHaveLength(2)
    })

    it("should add correct data-index attributes", () => {
        container.textContent = "Hello world"
        const result = splitText(container)

        // Check word indices
        const words = Array.from(result.words) as HTMLSpanElement[]
        expect(words[0].dataset.index).toBe("0")
        expect(words[1].dataset.index).toBe("1")

        // Check character indices within first word
        const firstWordChars = Array.from(
            words[0].querySelectorAll(".split-char")
        ) as HTMLSpanElement[]
        expect(firstWordChars[0].dataset.index).toBe("0")
        expect(firstWordChars[1].dataset.index).toBe("1")
    })

    it("should throw error when element is not found", () => {
        expect(() => {
            splitText("#non-existent-element")
        }).toThrow("Element not found")
    })

    it("should split all words into chars by default", () => {
        container.textContent = "Hello world"
        const result = splitText(container)

        // Should split into individual characters
        expect(result.chars.length).toBe(10)
    })

    it("should skip char splitting when preserveHyphens is true", () => {
        container.textContent = "Hello world"
        const result = splitText(container, { preserveHyphens: true })

        // Words should not be split into chars
        expect(result.chars).toHaveLength(0)

        // Words should contain their text directly
        expect(result.words[0].innerHTML).toBe("Hello")
        expect(result.words[1].innerHTML).toBe("world")
    })
})

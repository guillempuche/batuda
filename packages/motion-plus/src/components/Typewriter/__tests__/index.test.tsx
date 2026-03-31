import "@testing-library/jest-dom"
import { render, waitFor } from "@testing-library/react"
import { Typewriter } from "../index"

// Helper function to wait for a specified amount of time
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe("Typewriter", () => {
    it("renders as span by default", () => {
        const { container } = render(<Typewriter>Hello, world!</Typewriter>)

        const spanElement = container.querySelector("span")
        expect(spanElement).toBeInTheDocument()
    })

    it("setting as to h3 accepts h3 HTML props", () => {
        const { container } = render(
            <Typewriter as="h3" id="test-heading" className="heading">
                Hello, world!
            </Typewriter>
        )

        const h3Element = container.querySelector("h3")
        expect(h3Element).toBeInTheDocument()
        expect(h3Element).toHaveAttribute("id", "test-heading")
        expect(h3Element).toHaveClass("heading")
    })

    it("setting play to false means there are no rendered characters after 300ms", async () => {
        const { container } = render(
            <Typewriter play={false}>Hello, world!</Typewriter>
        )

        // Wait for 300ms
        await wait(300)

        await waitFor(() => {
            const textContent = container.textContent
            // Should only contain the cursor, no typed text
            expect(textContent?.replace(/\s/g, "")).toBe("")
        })
    })

    it("setting speed to 1000 means there's no rendered characters after 300ms", async () => {
        const { container } = render(
            <Typewriter speed={1000}>Hello, world!</Typewriter>
        )

        // Wait for 300ms (less than the 1000ms speed)
        await wait(300)

        await waitFor(() => {
            const textSpan = container.querySelector("span:first-child")
            expect(textSpan).toHaveTextContent("")
        })
    })

    it("changing speed to 1 means all characters have rendered after 300ms and onComplete fires", async () => {
        const onComplete = jest.fn()
        const { container } = render(
            <Typewriter speed={1} onComplete={onComplete}>
                Hello!
            </Typewriter>
        )

        // Wait enough time for all characters to render (6 chars * 1ms = 6ms, plus buffer)
        await wait(300)

        await waitFor(() => {
            const textSpan = container.querySelector("span:first-child")
            expect(textSpan).toHaveTextContent("Hello!")
            expect(onComplete).toHaveBeenCalled()
        })
    })

    it("setting cursorClassName adds the classname to the caret cursor element", () => {
        const { container } = render(
            <Typewriter cursorClassName="custom-cursor">Hello!</Typewriter>
        )

        const cursorElement = container.querySelector(".custom-cursor")
        expect(cursorElement).toBeInTheDocument()
    })

    it("setting cursorStyle changes the style of the caret cursor element", () => {
        const customStyle = { backgroundColor: "red", width: "4px" }
        const { container } = render(
            <Typewriter cursorStyle={customStyle}>Hello!</Typewriter>
        )

        const cursorElement = container.querySelector(
            ".motion-typewriter-cursor"
        )
        expect(cursorElement).toHaveStyle("background-color: red")
        expect(cursorElement).toHaveStyle("width: 4px")
    })

    it("aria-label falls back to full children text", () => {
        const { container } = render(<Typewriter>Hello, world!</Typewriter>)

        const rootElement = container.firstElementChild
        expect(rootElement).toHaveAttribute("aria-label", "Hello, world!")
    })

    it("manually setting aria-label overrides the fallback", () => {
        const { container } = render(
            <Typewriter aria-label="Custom label">Hello, world!</Typewriter>
        )

        const rootElement = container.firstElementChild
        expect(rootElement).toHaveAttribute("aria-label", "Custom label")
    })

    it("renders cursor with default className when cursorClassName is not provided", () => {
        const { container } = render(<Typewriter>Hello!</Typewriter>)

        const cursorElement = container.querySelector(
            ".motion-typewriter-cursor"
        )
        expect(cursorElement).toBeInTheDocument()
    })

    it("applies default cursor styles", () => {
        const { container } = render(<Typewriter>Hello!</Typewriter>)

        const cursorElement = container.querySelector(
            ".motion-typewriter-cursor"
        )
        expect(cursorElement).toHaveStyle("display: inline-block")
        expect(cursorElement).toHaveStyle("width: 2px")
        expect(cursorElement).toHaveStyle("height: 1em")
        expect(cursorElement).toHaveStyle("background-color: currentColor")
    })

    it("uses normal speed by default", async () => {
        const { container } = render(<Typewriter>Hi</Typewriter>)

        // Wait by 75ms (normal speed) + buffer
        await wait(85)

        await waitFor(() => {
            const textSpan = container.querySelector("span:first-child")
            expect(textSpan).toHaveTextContent("H")
        })
    })

    it("setting textClassName adds the classname to the text element", () => {
        const { container } = render(
            <Typewriter textClassName="custom-text">Hello!</Typewriter>
        )

        const textElement = container.querySelector(".custom-text")
        expect(textElement).toBeInTheDocument()
    })

    it("setting textStyle changes the style of the text element", () => {
        const customStyle = { color: "red" }
        const { container } = render(
            <Typewriter textClassName="custom-text" textStyle={customStyle}>
                Hello!
            </Typewriter>
        )

        const textElement = container.querySelector(".custom-text")
        expect(textElement).toHaveStyle("color: red")
    })

    it("onChange fires for each typed character with correct values", async () => {
        const onChange = jest.fn()
        render(
            <Typewriter speed={1} onChange={onChange}>
                Hi
            </Typewriter>
        )

        await wait(300)

        await waitFor(() => {
            expect(onChange).toHaveBeenCalledTimes(2)
            expect(onChange).toHaveBeenNthCalledWith(1, {
                text: "H",
                character: "H",
                isBackspace: false,
            })
            expect(onChange).toHaveBeenNthCalledWith(2, {
                text: "Hi",
                character: "i",
                isBackspace: false,
            })
        })
    })

    it("onChange fires with isBackspace true when backspacing", async () => {
        const onChange = jest.fn()
        const { rerender } = render(
            <Typewriter speed={1} onChange={onChange} backspace="character">
                Hello
            </Typewriter>
        )

        // Wait for initial typing to complete
        await wait(300)

        onChange.mockClear()

        // Change text to trigger backspace
        rerender(
            <Typewriter speed={1} onChange={onChange} backspace="character">
                Help
            </Typewriter>
        )

        await wait(300)

        await waitFor(() => {
            // Should backspace "lo" (2 chars) then type "p" (1 char)
            expect(onChange).toHaveBeenCalledWith(
                expect.objectContaining({
                    isBackspace: true,
                    character: "o",
                })
            )
            expect(onChange).toHaveBeenCalledWith(
                expect.objectContaining({
                    isBackspace: true,
                    character: "l",
                })
            )
            expect(onChange).toHaveBeenCalledWith(
                expect.objectContaining({
                    text: "Help",
                    character: "p",
                    isBackspace: false,
                })
            )
        })
    })

    it("onChange reports multiple characters when using backspace: 'all'", async () => {
        const onChange = jest.fn()
        const { rerender } = render(
            <Typewriter speed={1} onChange={onChange} backspace="all">
                Hello
            </Typewriter>
        )

        await wait(300)

        onChange.mockClear()

        rerender(
            <Typewriter speed={1} onChange={onChange} backspace="all">
                Help
            </Typewriter>
        )

        await wait(300)

        await waitFor(() => {
            // With backspace: "all", should remove "lo" in one step
            expect(onChange).toHaveBeenCalledWith(
                expect.objectContaining({
                    text: "Hel",
                    character: "lo",
                    isBackspace: true,
                })
            )
        })
    })
})

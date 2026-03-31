import "@testing-library/jest-dom"
import { render, waitFor } from "@testing-library/react"
import { ScrambleText } from "../index"

// Helper function to wait for a specified amount of time
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe("ScrambleText", () => {
    it("renders as span by default", () => {
        const { container } = render(<ScrambleText>Hello</ScrambleText>)

        const spanElement = container.querySelector("span")
        expect(spanElement).toBeInTheDocument()
    })

    it("setting as to h3 accepts h3 HTML props", () => {
        const { container } = render(
            <ScrambleText as="h3" id="test-heading" className="heading">
                Hello
            </ScrambleText>
        )

        const h3Element = container.querySelector("h3")
        expect(h3Element).toBeInTheDocument()
        expect(h3Element).toHaveAttribute("id", "test-heading")
        expect(h3Element).toHaveClass("heading")
    })

    it("renders as the specified element without extra wrappers", () => {
        const { container } = render(<ScrambleText as="h1">Hello</ScrambleText>)

        // Should render as h1 directly without nested spans
        const h1 = container.querySelector("h1")
        expect(h1).toBeInTheDocument()
        // No nested spans inside h1
        expect(h1?.querySelector("span")).toBeNull()
    })

    it("should scramble text initially and have correct length", async () => {
        const { container } = render(
            <ScrambleText duration={1} interval={0.01}>
                Hello
            </ScrambleText>
        )

        await wait(50)

        // Should be scrambled (not the original text)
        expect(container.textContent).not.toBe("Hello")
        expect(container.textContent).toHaveLength(5)
    })

    it("should immediately reveal when active is false", async () => {
        const { container } = render(
            <ScrambleText active={false} duration={1}>
                Hello
            </ScrambleText>
        )

        await wait(200)

        await waitFor(() => {
            expect(container.textContent).toBe("Hello")
        })
    })

    it("should scramble when active is true", async () => {
        const { container } = render(
            <ScrambleText active={true} duration={0.5} interval={0.01}>
                Hello
            </ScrambleText>
        )

        await wait(50)

        // Text should have the correct length (may or may not equal original)
        expect(container.textContent).toHaveLength(5)
    })

    it("should restart scramble when text changes", async () => {
        const { container, rerender } = render(
            <ScrambleText duration={1} interval={0.01}>
                Hello
            </ScrambleText>
        )

        await wait(50)
        // Should be scrambling
        expect(container.textContent).not.toBe("Hello")
        expect(container.textContent).toHaveLength(5)

        rerender(
            <ScrambleText duration={1} interval={0.01}>
                World
            </ScrambleText>
        )

        await wait(50)

        // Should be scrambling the new text
        expect(container.textContent).not.toBe("World")
        expect(container.textContent).toHaveLength(5)
    })

    it("should handle empty text", () => {
        const { container } = render(<ScrambleText>{""}</ScrambleText>)

        expect(container.textContent).toBe("")
    })

    it("should use custom chars for scrambling", async () => {
        const { container } = render(
            <ScrambleText chars="X" duration={0.1} interval={0.01}>
                Hi
            </ScrambleText>
        )

        await wait(30)

        // Text should have the correct length
        const text = container.textContent!
        expect(text.length).toBe(2)
    })

    it("should preserve spaces during scramble", async () => {
        const { container } = render(
            <ScrambleText duration={0.1} interval={0.01}>
                Hi there
            </ScrambleText>
        )

        await wait(30)

        const text = container.textContent!
        expect(text[2]).toBe(" ")
    })

    it("should support delay prop", async () => {
        const { container } = render(
            <ScrambleText delay={0.1} duration={0.05} interval={0.01}>
                Hi
            </ScrambleText>
        )

        // Initially should show original text (before delay)
        expect(container.textContent).toBe("Hi")
    })

    it("should support className prop", () => {
        const { container } = render(
            <ScrambleText className="custom-class">Hello</ScrambleText>
        )

        const element = container.firstElementChild
        expect(element).toHaveClass("custom-class")
    })

    it("should support style prop", () => {
        const { container } = render(
            <ScrambleText style={{ color: "red" }}>Hello</ScrambleText>
        )

        const element = container.firstElementChild
        expect(element).toHaveStyle("color: red")
    })

    it("should finish gracefully when active changes to false", async () => {
        const { container, rerender } = render(
            <ScrambleText active={true} duration={1} interval={0.01}>
                Hello
            </ScrambleText>
        )

        await wait(50)

        rerender(
            <ScrambleText active={false} duration={1} interval={0.01}>
                Hello
            </ScrambleText>
        )

        // Should reveal after a short stagger period
        await wait(300)

        await waitFor(() => {
            expect(container.textContent).toBe("Hello")
        })
    })

    it("should handle Infinity duration with active toggle", async () => {
        const { container, rerender } = render(
            <ScrambleText active={true} duration={Infinity} interval={0.01}>
                Hi
            </ScrambleText>
        )

        await wait(100)

        // Should still be scrambling - text should have correct length
        expect(container.textContent).toHaveLength(2)

        rerender(
            <ScrambleText active={false} duration={Infinity} interval={0.01}>
                Hi
            </ScrambleText>
        )

        await wait(200)

        await waitFor(() => {
            expect(container.textContent).toBe("Hi")
        })
    })

    it("should cleanup on unmount", async () => {
        const { unmount } = render(
            <ScrambleText duration={1} interval={0.01}>
                Hello
            </ScrambleText>
        )

        await wait(50)
        unmount()

        // Should not throw errors after unmount
        await wait(100)
    })
})

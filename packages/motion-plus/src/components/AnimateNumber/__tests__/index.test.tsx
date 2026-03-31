import "@testing-library/jest-dom"
import { render } from "@testing-library/react"
import { AnimateNumber } from "../index"

describe("AnimateNumber", () => {
    it("renders as an inline element", () => {
        const { container } = render(<AnimateNumber>42</AnimateNumber>)
        const el = container.firstElementChild as HTMLElement
        expect(el).toBeInTheDocument()
        expect(el.tagName.toLowerCase()).toBe("span")
    })

    it("sets aria-label to the formatted number", () => {
        const { container } = render(
            <AnimateNumber locales="en-US">{1234}</AnimateNumber>
        )
        const label = container.querySelector("[aria-label]")
        expect(label).toHaveAttribute("aria-label", "1,234")
    })

    it("includes prefix in aria-label", () => {
        const { container } = render(
            <AnimateNumber prefix="~">{50}</AnimateNumber>
        )
        const label = container.querySelector("[aria-label]")
        expect(label?.getAttribute("aria-label")).toContain("~")
    })

    it("includes suffix in aria-label", () => {
        const { container } = render(
            <AnimateNumber suffix="/mo">{10}</AnimateNumber>
        )
        const label = container.querySelector("[aria-label]")
        expect(label?.getAttribute("aria-label")).toContain("/mo")
    })

    it("renders digit spans for each digit", () => {
        const { container } = render(<AnimateNumber>{123}</AnimateNumber>)
        // Each digit gets rendered in number sections
        // The integer section should contain digit 1, 2, 3
        const text = container.textContent
        expect(text).toContain("1")
        expect(text).toContain("2")
        expect(text).toContain("3")
    })

    it("passes style prop to outer element", () => {
        const { container } = render(
            <AnimateNumber style={{ color: "red" }}>{5}</AnimateNumber>
        )
        const el = container.firstElementChild as HTMLElement
        expect(el.style.color).toBe("red")
    })

    it("passes id and className to outer element", () => {
        const { container } = render(
            <AnimateNumber id="test-num" className="my-number">
                {7}
            </AnimateNumber>
        )
        const el = container.querySelector("#test-num")
        expect(el).toBeInTheDocument()
        expect(el).toHaveClass("my-number")
    })

    it("renders with currency formatting", () => {
        const { container } = render(
            <AnimateNumber
                locales="en-US"
                format={{ style: "currency", currency: "USD" }}
            >
                {9.99}
            </AnimateNumber>
        )
        const label = container.querySelector("[aria-label]")
        expect(label?.getAttribute("aria-label")).toContain("$")
    })

    it("renders zero correctly", () => {
        const { container } = render(<AnimateNumber>{0}</AnimateNumber>)
        const label = container.querySelector("[aria-label]")
        expect(label?.getAttribute("aria-label")).toBe("0")
    })

    it("renders negative numbers", () => {
        const { container } = render(
            <AnimateNumber locales="en-US">{-42}</AnimateNumber>
        )
        const label = container.querySelector("[aria-label]")
        const ariaLabel = label?.getAttribute("aria-label") ?? ""
        // Should contain the minus sign (could be hyphen-minus or Unicode minus)
        expect(ariaLabel).toMatch(/[-−]42/)
    })

    it("renders decimal numbers", () => {
        const { container } = render(
            <AnimateNumber
                locales="en-US"
                format={{ minimumFractionDigits: 2 }}
            >
                {3.14}
            </AnimateNumber>
        )
        const label = container.querySelector("[aria-label]")
        expect(label?.getAttribute("aria-label")).toBe("3.14")
    })

    it("accepts string children", () => {
        const { container } = render(
            <AnimateNumber>{"42"}</AnimateNumber>
        )
        const label = container.querySelector("[aria-label]")
        expect(label?.getAttribute("aria-label")).toBe("42")
    })

    it("does not use LayoutGroup", () => {
        // AnimateNumber should not render any layout group elements
        const { container } = render(<AnimateNumber>{99}</AnimateNumber>)
        // The outer element should be a span, not wrapped in extra divs
        const el = container.firstElementChild as HTMLElement
        expect(el.tagName.toLowerCase()).toBe("span")
    })

    it("accepts trend prop without error", () => {
        expect(() => {
            render(<AnimateNumber trend={1}>{5}</AnimateNumber>)
        }).not.toThrow()
    })

    it("accepts trend as function without error", () => {
        expect(() => {
            render(
                <AnimateNumber trend={(old, val) => Math.sign(val - old)}>
                    {5}
                </AnimateNumber>
            )
        }).not.toThrow()
    })
})

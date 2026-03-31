import "@testing-library/jest-dom"
import { render } from "@testing-library/react"
import { Ticker } from "../index"

export type MockIntersectionObserverEntry = {
    isIntersecting: boolean
    target: Element
}

export type MockIntersectionObserverCallback = (
    entries: MockIntersectionObserverEntry[]
) => void

let activeIntersectionObserver: MockIntersectionObserverCallback | undefined

export const getActiveObserver = () => activeIntersectionObserver

window.IntersectionObserver = class MockIntersectionObserver {
    callback: MockIntersectionObserverCallback

    constructor(callback: MockIntersectionObserverCallback) {
        this.callback = callback
    }

    observe(_element: Element) {
        activeIntersectionObserver = this.callback
    }

    unobserve(_element: Element) {
        activeIntersectionObserver = undefined
    }

    disconnect() {
        activeIntersectionObserver = undefined
    }
} as any

describe("Ticker", () => {
    it("renders with correct gap and flex-direction for horizontal axis", () => {
        const items = [<div key="1">Item 1</div>, <div key="2">Item 2</div>]
        const { container } = render(<Ticker items={items} gap={20} axis="x" />)

        const ul = container.querySelector("ul")
        expect(ul).toBeInTheDocument()
        expect(ul).toHaveStyle({
            gap: "20px",
            flexDirection: "row",
        })
    })

    it("renders with correct gap and flex-direction for vertical axis", () => {
        const items = [<div key="1">Item 1</div>, <div key="2">Item 2</div>]
        const { container } = render(<Ticker items={items} gap={15} axis="y" />)

        const ul = container.querySelector("ul")
        expect(ul).toBeInTheDocument()
        expect(ul).toHaveStyle({
            gap: "15px",
            flexDirection: "column",
        })
    })

    it("uses default values when gap and axis are not provided", () => {
        const items = [<div key="1">Item 1</div>]
        const { container } = render(<Ticker items={items} />)

        const ul = container.querySelector("ul")
        expect(ul).toBeInTheDocument()
        expect(ul).toHaveStyle({
            gap: "10px",
            flexDirection: "row",
        })
    })

    it("renders with correct start alignment", () => {
        const items = [<div key="1">Item 1</div>, <div key="2">Item 2</div>]
        const { container } = render(<Ticker items={items} align="start" />)

        const ul = container.querySelector("ul")
        expect(ul).toBeInTheDocument()
        expect(ul).toHaveStyle({
            "align-items": "flex-start",
        })
    })

    it("renders with correct center alignment", () => {
        const items = [<div key="1">Item 1</div>, <div key="2">Item 2</div>]
        const { container } = render(<Ticker items={items} align="center" />)

        const ul = container.querySelector("ul")
        expect(ul).toBeInTheDocument()
        expect(ul).toHaveStyle({
            "align-items": "center",
        })
    })

    it("renders with correct end alignment", () => {
        const items = [<div key="1">Item 1</div>, <div key="2">Item 2</div>]
        const { container } = render(<Ticker items={items} align="end" />)

        const ul = container.querySelector("ul")
        expect(ul).toBeInTheDocument()
        expect(ul).toHaveStyle({
            "align-items": "flex-end",
        })
    })

    it("renders with correct stretch alignment", () => {
        const items = [<div key="1">Item 1</div>, <div key="2">Item 2</div>]
        const { container } = render(<Ticker items={items} align="stretch" />)

        const ul = container.querySelector("ul")
        expect(ul).toBeInTheDocument()
        expect(ul).toHaveStyle({
            "align-items": "stretch",
        })
    })

    it("renders as div by default", () => {
        const items = [<div key="1">Item 1</div>, <div key="2">Item 2</div>]
        const { container } = render(<Ticker items={items} />)

        const rootElement = container.firstElementChild
        expect(rootElement).toBeInTheDocument()
        expect(rootElement?.tagName.toLowerCase()).toBe("div")
    })

    it("renders as section when as='section'", () => {
        const items = [<div key="1">Item 1</div>, <div key="2">Item 2</div>]
        const { container } = render(<Ticker items={items} as="section" />)

        const rootElement = container.firstElementChild
        expect(rootElement).toBeInTheDocument()
        expect(rootElement?.tagName.toLowerCase()).toBe("section")
    })

    it("accepts element-specific props when using as prop", () => {
        const items = [<div key="1">Item 1</div>, <div key="2">Item 2</div>]
        const { container } = render(
            <Ticker
                items={items}
                as="nav"
                role="navigation"
                aria-label="Main navigation"
            />
        )

        const navElement = container.firstElementChild
        expect(navElement).toBeInTheDocument()
        expect(navElement?.tagName.toLowerCase()).toBe("nav")
        expect(navElement).toHaveAttribute("role", "navigation")
        expect(navElement).toHaveAttribute("aria-label", "Main navigation")
    })

    it("maintains proper styling regardless of element type", () => {
        const items = [<div key="1">Item 1</div>, <div key="2">Item 2</div>]
        const { container } = render(
            <Ticker items={items} as="section" gap={25} axis="y" />
        )

        const sectionElement = container.firstElementChild
        const ul = container.querySelector("ul")

        expect(sectionElement?.tagName.toLowerCase()).toBe("section")
        expect(ul).toBeInTheDocument()
        expect(ul).toHaveStyle({
            gap: "25px",
            flexDirection: "column",
        })
    })

    it("works with static mode using different element types", () => {
        const items = [<div key="1">Item 1</div>, <div key="2">Item 2</div>]
        const { container } = render(
            <Ticker items={items} as="aside" isStatic />
        )

        const asideElement = container.firstElementChild
        expect(asideElement).toBeInTheDocument()
        expect(asideElement?.tagName.toLowerCase()).toBe("aside")

        const ul = container.querySelector("ul")
        expect(ul).toBeInTheDocument()
    })

    it("forwards ref to the container element", () => {
        const items = [<div key="1">Item 1</div>, <div key="2">Item 2</div>]
        const ref = { current: null as HTMLElement | null }

        render(<Ticker items={items} ref={ref} />)

        expect(ref.current).toBeInTheDocument()
        expect((ref.current as HTMLElement)?.tagName.toLowerCase()).toBe("div")
    })

    it("forwards ref correctly with different element types", () => {
        const items = [<div key="1">Item 1</div>, <div key="2">Item 2</div>]
        const ref = { current: null as HTMLElement | null }

        render(<Ticker items={items} as="section" ref={ref} />)

        expect(ref.current).toBeInTheDocument()
        expect((ref.current as HTMLElement)?.tagName.toLowerCase()).toBe(
            "section"
        )
    })

    it("works with callback refs", () => {
        const items = [<div key="1">Item 1</div>, <div key="2">Item 2</div>]
        let refElement: HTMLElement | null = null
        const callbackRef = (el: HTMLElement | null) => {
            refElement = el
        }

        render(<Ticker items={items} ref={callbackRef} />)

        expect(refElement).toBeInTheDocument()
        expect(
            refElement && (refElement as HTMLElement).tagName.toLowerCase()
        ).toBe("div")
    })
})

import { Axis, Direction, LayoutStrategy } from "../types"

const ltrStrategy = (
    insetProp: "offsetLeft" | "offsetTop",
    lengthProp: "offsetWidth" | "offsetHeight",
    viewportLengthProp: "innerWidth" | "innerHeight",
    paddingStartProp: "paddingLeft" | "paddingTop" | "paddingRight",
    direction: "left" | "top" | "right" | "bottom"
): LayoutStrategy => {
    return {
        sign: 1,
        direction,
        lengthProp,
        viewportLengthProp,
        paddingStartProp,
        measureItem: (item: HTMLElement) => {
            return {
                start: item[insetProp],
                end: item[insetProp] + item[lengthProp],
            }
        },
        getCumulativeInset: (element: HTMLElement) => {
            let offset = 0
            let el: HTMLElement | null = element
            while (el) {
                offset += el[insetProp]
                el = el.offsetParent as HTMLElement
            }
            return offset
        },
    }
}

const xStrategy = ltrStrategy(
    "offsetLeft",
    "offsetWidth",
    "innerWidth",
    "paddingLeft",
    "right"
)

const yStrategy = ltrStrategy(
    "offsetTop",
    "offsetHeight",
    "innerHeight",
    "paddingTop",
    "bottom"
)

function offsetRight(element: HTMLElement, container?: HTMLElement) {
    const containerWidth = container?.offsetWidth ?? window.innerWidth
    return containerWidth - (element.offsetLeft + element.offsetWidth)
}

const xRtlStrategy: LayoutStrategy = {
    ...xStrategy,
    sign: -1,
    direction: "left",
    paddingStartProp: "paddingRight",
    measureItem: (item: HTMLElement, container: HTMLElement) => {
        const length = item.offsetWidth
        const start = offsetRight(item, container)
        return { start, end: start + length }
    },
    getCumulativeInset: (element: HTMLElement) => {
        let offset = 0
        let el: HTMLElement | null = element
        while (el) {
            offset += offsetRight(el, el.offsetParent as HTMLElement)
            el = el.offsetParent as HTMLElement
        }
        return offset
    },
}

export function getLayoutStrategy(
    axis: Axis,
    direction: Direction
): LayoutStrategy {
    return axis === "y"
        ? yStrategy
        : direction === "ltr"
        ? xStrategy
        : xRtlStrategy
}

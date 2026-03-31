export type Axis = "x" | "y"
export type Direction = "ltr" | "rtl"

export interface ItemPosition {
    start: number
    end: number
}

export interface LayoutStrategy {
    sign: 1 | -1
    direction: "left" | "top" | "right" | "bottom"
    lengthProp: "offsetWidth" | "offsetHeight"
    viewportLengthProp: "innerWidth" | "innerHeight"
    paddingStartProp: "paddingLeft" | "paddingTop" | "paddingRight"
    measureItem: (item: HTMLElement, container: HTMLElement) => ItemPosition
    getCumulativeInset: (element: HTMLElement) => number
}

export interface TickerState {
    direction: Direction
    visibleLength: number
    inset: number
    containerLength: number
    totalItemLength: number
    itemPositions: ItemPosition[]
    isMeasured: boolean
    maxInset: number | null
}

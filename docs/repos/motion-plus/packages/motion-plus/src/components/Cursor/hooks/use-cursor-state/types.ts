export type CursorType = "pointer" | "default" | "text"

export interface CursorState {
    type: CursorType
    isPressed: boolean
    fontSize: number | null
    targetBoundingBox: {
        width: number
        height: number
        top: number
        right: number
        bottom: number
        left: number
    } | null
    target: CursorTarget | null
    zone: string | null
}

export type CursorTarget = HTMLElement | SVGElement

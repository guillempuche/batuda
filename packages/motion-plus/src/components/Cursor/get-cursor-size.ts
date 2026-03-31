import { MotionProps, MotionValue } from "motion/react"
import { CursorState, CursorType } from "./hooks/use-cursor-state/types"
import { MagneticOptions } from "./types"

type Size = {
    width: number | string | MotionValue<any>
    height: number | string | MotionValue<any>
}

const DEFAULT_SIZE = 17
const POINTER_SIZE = 31
const TEXT_WIDTH = 4
const TEXT_HEIGHT = 20

export interface CursorSizeOptions {
    type: CursorType
    state: CursorState
    hasChildren: boolean
    style?: MotionProps["style"]
    isMagnetic: boolean
    magneticOptions: MagneticOptions
    matchTextSize: boolean
}

function withDefaultSize(
    width: string | number,
    height: string | number,
    style?: MotionProps["style"]
) {
    return {
        width: style?.width ?? width,
        height: style?.height ?? height,
    }
}

export function getCursorSize({
    type,
    state,
    hasChildren,
    style,
    isMagnetic,
    magneticOptions,
    matchTextSize,
}: CursorSizeOptions): Size {
    const shouldMatchTargetSize = isMagnetic && state.targetBoundingBox

    if (hasChildren && !shouldMatchTargetSize) {
        return withDefaultSize("auto", "auto", style)
    }

    switch (type) {
        case "pointer":
            const { padding, morph } = magneticOptions

            if (isMagnetic && morph && state.targetBoundingBox) {
                const { width, height } = state.targetBoundingBox

                return {
                    width: width + padding * 2,
                    height: height + padding * 2,
                }
            }

            return withDefaultSize(POINTER_SIZE, POINTER_SIZE, style)
        case "text":
            if (matchTextSize && state.fontSize) {
                return { width: TEXT_WIDTH, height: state.fontSize }
            }

            return withDefaultSize(TEXT_WIDTH, TEXT_HEIGHT, style)
        default:
            return withDefaultSize(DEFAULT_SIZE, DEFAULT_SIZE, style)
    }
}

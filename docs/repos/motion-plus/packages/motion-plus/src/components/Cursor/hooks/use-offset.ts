import { Point, MotionValue, useTransform } from "motion/react"

export type MotionPoint = {
    x: MotionValue<number>
    y: MotionValue<number>
}

export function useOffset(position: MotionPoint, offset: Point) {
    return {
        x: useTransform(() => position.x.get() + offset.x),
        y: useTransform(() => position.y.get() + offset.y),
    }
}

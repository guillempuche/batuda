import { mix, MotionValue, useTransform } from "motion/react"

export function useMixed(
    a: MotionValue<number>,
    b: MotionValue<number>,
    p: MotionValue<number>
) {
    return useTransform(() => mix(a.get(), b.get(), p.get()))
}

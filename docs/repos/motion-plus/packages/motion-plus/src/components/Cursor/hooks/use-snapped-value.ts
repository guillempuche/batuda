import {
    MotionValue,
    animate,
    useIsomorphicLayoutEffect,
    useMotionValue,
    useSpring,
} from "motion/react"
import { useRef } from "react"
import { useMixed } from "./use-mixed"

export function useSnappedValue(
    pointer: MotionValue<number>,
    snap: number,
    target?: number
) {
    const snapped = useSpring(0, {
        stiffness: 600,
        damping: 50,
    })
    const crossfade = useMotionValue(0)
    const mixed = useMixed(pointer, snapped, crossfade)

    const prevTarget = useRef(target)
    useIsomorphicLayoutEffect(() => {
        if (target) {
            if (!prevTarget.current && !crossfade.isAnimating()) {
                snapped.jump(target)
            } else {
                snapped.set(target)
            }

            animate(crossfade, snap)
        } else {
            animate(crossfade, 0)
        }

        prevTarget.current = target
    }, [target])

    return mixed
}

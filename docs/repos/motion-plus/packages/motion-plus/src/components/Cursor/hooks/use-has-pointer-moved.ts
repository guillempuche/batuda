import { MotionValue, pipe } from "motion/react"
import { useInsertionEffect, useState } from "react"

export function useHasPointerMoved(
    {
        x,
        y,
    }: {
        x: MotionValue<number>
        y: MotionValue<number>
    },
    resetSpring: VoidFunction
) {
    const [pointerHasMoved, setPointerHasMoved] = useState(
        (x as any).prev !== undefined || (y as any).prev !== undefined
    )

    useInsertionEffect(() => {
        if (pointerHasMoved) return

        const setHasMoved = () => {
            setPointerHasMoved(true)
            resetSpring()
            stop()
        }

        const stop = pipe(
            x.on("change", setHasMoved),
            y.on("change", setHasMoved)
        )

        return () => stop()
    }, [x, y, pointerHasMoved])

    return pointerHasMoved
}

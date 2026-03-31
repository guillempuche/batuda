import { frame, MotionValue, motionValue } from "motion/react"
import { onlyMouse } from "./utils/only-mouse-events"

let x: MotionValue<number>
let y: MotionValue<number>

function initPointerTracking() {
    x = motionValue(0)
    y = motionValue(0)

    // Cached pointer
    let pointerX = 0
    let pointerY = 0

    function updatePointer() {
        x.set(pointerX)
        y.set(pointerY)
    }

    if (typeof window !== "undefined") {
        window.addEventListener(
            "pointermove",
            onlyMouse((event: PointerEvent) => {
                pointerX = event.clientX
                pointerY = event.clientY

                /**
                 * Don't update pointer until the next render frame to
                 * avoid
                 *
                 * TODO: Update motion values to cache rendered value
                 * and use that in projection measurements
                 * instead of using this approach
                 */
                frame.update(updatePointer)
            })
        )

        // Track pointer during native HTML drag operations,
        // when pointermove stops firing.
        window.addEventListener("dragover", (event: DragEvent) => {
            pointerX = event.clientX
            pointerY = event.clientY
            frame.update(updatePointer)
        })
    }
}

export function usePointerPosition() {
    if (!x) initPointerTracking()

    return { x: x!, y: y! }
}

import { CursorState } from "../hooks/use-cursor-state/types"
import { MotionPoint } from "../hooks/use-offset"
import { useSnappedValue } from "../hooks/use-snapped-value"

export function useMagneticTarget(
    pointer: MotionPoint,
    isEnabled: boolean,
    state: CursorState,
    snap: number
) {
    const x = useSnappedValue(
        pointer.x,
        snap,
        state.targetBoundingBox
            ? state.targetBoundingBox.left + state.targetBoundingBox.width / 2
            : undefined
    )

    const y = useSnappedValue(
        pointer.y,
        snap,
        state.targetBoundingBox
            ? state.targetBoundingBox.top + state.targetBoundingBox.height / 2
            : undefined
    )

    return isEnabled ? { x, y } : pointer
}

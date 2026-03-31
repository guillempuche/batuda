import { isZeroValueString } from "motion-utils"
import { AnyResolvedKeyframe } from "../../types"

export function isNone(value: AnyResolvedKeyframe | null) {
    if (typeof value === "number") {
        return value === 0
    } else if (value !== null) {
        return value === "none" || value === "0" || isZeroValueString(value)
    } else {
        return true
    }
}

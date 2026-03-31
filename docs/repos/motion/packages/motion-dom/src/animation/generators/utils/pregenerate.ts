import { millisecondsToSeconds } from "motion-utils"
import { AnyResolvedKeyframe, KeyframeGenerator } from "../../types"

export interface KeyframesMetadata {
    keyframes: Array<AnyResolvedKeyframe>
    duration: number
}

const timeStep = 10
const maxDuration = 10000
export function pregenerateKeyframes(
    generator: KeyframeGenerator<number>
): KeyframesMetadata {
    let timestamp = timeStep
    let state = generator.next(0)
    const keyframes: Array<AnyResolvedKeyframe> = [state.value]

    while (!state.done && timestamp < maxDuration) {
        state = generator.next(timestamp)
        keyframes.push(state.value)
        timestamp += timeStep
    }

    const duration = timestamp - timeStep

    /**
     * If generating an animation that didn't actually move,
     * generate a second keyframe so we have an origin and target.
     */
    if (keyframes.length === 1) keyframes.push(state.value)

    return {
        keyframes,
        duration: millisecondsToSeconds(duration),
    }
}

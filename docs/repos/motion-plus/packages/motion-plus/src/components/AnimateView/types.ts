import {
    AnimationPlaybackControls,
    TargetAndTransition,
    Transition,
} from "motion-dom"

export type AnimationType = "enter" | "exit" | "share" | "update"

export type ViewAnimationStartCallback = (
    animation: AnimationPlaybackControls,
    type: AnimationType
) => void

export type ViewAnimationCompleteCallback = (type: AnimationType) => void

export interface AnimateViewProps {
    transition?: Transition
    enter?: TargetAndTransition | ((types: string[]) => TargetAndTransition)
    exit?: TargetAndTransition | ((types: string[]) => TargetAndTransition)
    share?: TargetAndTransition | ((types: string[]) => TargetAndTransition)
    update?: TargetAndTransition | ((types: string[]) => TargetAndTransition)
    onAnimationStart?: ViewAnimationStartCallback
    onAnimationComplete?: ViewAnimationCompleteCallback
    name?: string
}

import type { AnimationOptions, ElementOrSelector } from "motion"
import { LayoutAnimationBuilder, parseAnimateLayoutArgs } from "motion"

export function unstable_animateLayout(
    scopeOrUpdateDom: ElementOrSelector | (() => void),
    updateDomOrOptions?: (() => void) | AnimationOptions,
    options?: AnimationOptions
): LayoutAnimationBuilder {
    const { scope, updateDom, defaultOptions } = parseAnimateLayoutArgs(
        scopeOrUpdateDom,
        updateDomOrOptions,
        options
    )
    return new LayoutAnimationBuilder(scope, updateDom, defaultOptions)
}

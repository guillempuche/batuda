import { noop } from "motion-utils"
import type { GroupAnimation } from "../animation/GroupAnimation"
import { AnimationOptions, DOMKeyframesDefinition } from "../animation/types"
import { addToQueue } from "./queue"
import {
    ViewTransitionOptions,
    ViewTransitionTarget,
    ViewTransitionTargetDefinition,
} from "./types"
import "./types.global"

export class ViewTransitionBuilder {
    private currentSubject: ViewTransitionTargetDefinition = "root"

    targets = new Map<ViewTransitionTargetDefinition, ViewTransitionTarget>()

    update: () => void | Promise<void>

    options: ViewTransitionOptions

    notifyReady: (value: GroupAnimation) => void = noop

    private readyPromise = new Promise<GroupAnimation>((resolve) => {
        this.notifyReady = resolve
    })

    constructor(
        update: () => void | Promise<void>,
        options: ViewTransitionOptions = {}
    ) {
        this.update = update
        this.options = {
            interrupt: "wait",
            ...options,
        }
        addToQueue(this)
    }

    get(subject: ViewTransitionTargetDefinition) {
        this.currentSubject = subject

        return this
    }

    layout(keyframes: DOMKeyframesDefinition, options?: AnimationOptions) {
        this.updateTarget("layout", keyframes, options)

        return this
    }

    new(keyframes: DOMKeyframesDefinition, options?: AnimationOptions) {
        this.updateTarget("new", keyframes, options)

        return this
    }

    old(keyframes: DOMKeyframesDefinition, options?: AnimationOptions) {
        this.updateTarget("old", keyframes, options)

        return this
    }

    enter(keyframes: DOMKeyframesDefinition, options?: AnimationOptions) {
        this.updateTarget("enter", keyframes, options)

        return this
    }

    exit(keyframes: DOMKeyframesDefinition, options?: AnimationOptions) {
        this.updateTarget("exit", keyframes, options)

        return this
    }

    crossfade(options?: AnimationOptions) {
        this.updateTarget("enter", { opacity: 1 }, options)
        this.updateTarget("exit", { opacity: 0 }, options)

        return this
    }

    updateTarget(
        target: "enter" | "exit" | "layout" | "new" | "old",
        keyframes: DOMKeyframesDefinition,
        options: AnimationOptions = {}
    ) {
        const { currentSubject, targets } = this

        if (!targets.has(currentSubject)) {
            targets.set(currentSubject, {})
        }

        const targetData = targets.get(currentSubject)!

        targetData[target] = { keyframes, options }
    }

    then(resolve: () => void, reject?: () => void) {
        return this.readyPromise.then(resolve, reject)
    }
}

export function animateView(
    update: () => void | Promise<void>,
    defaultOptions: ViewTransitionOptions = {}
) {
    return new ViewTransitionBuilder(update, defaultOptions)
}

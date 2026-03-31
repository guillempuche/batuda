import type { MotionValue } from "motion"

export type StaggerFunction = (index: number, total: number) => number

export interface ScrambleTextOptions {
    /**
     * Characters to use for scrambling.
     * Can be a string of characters or an array of strings (for emoji support).
     *
     * @default "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
     */
    chars?: string | string[]

    /**
     * Delay before each character starts scrambling.
     * Can be a number (seconds) or a stagger function.
     *
     * @default 0
     */
    delay?: number | StaggerFunction

    /**
     * How long each character stays scrambled before revealing.
     * Can be a number (seconds), Infinity, or a stagger function.
     *
     * @default 1
     */
    duration?: number | StaggerFunction

    /**
     * Seconds between random character switches while scrambling.
     *
     * @default 0.05
     */
    interval?: number

    /**
     * Callback when all characters have been revealed.
     */
    onComplete?: () => void
}

export interface ScrambleTextControls {
    /**
     * Stop the scramble animation and reveal all characters immediately.
     */
    stop: () => void

    /**
     * Start/restart the scramble animation.
     */
    play: () => void

    /**
     * Gracefully reveal all characters while preserving stagger timing offsets.
     */
    finish: () => void

    /**
     * Promise that resolves when all characters are revealed.
     */
    finished: Promise<void>
}

export type ScrambleTextTarget = Element | string | MotionValue<string>

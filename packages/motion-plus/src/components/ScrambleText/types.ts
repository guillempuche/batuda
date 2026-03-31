import type { ComponentPropsWithoutRef, CSSProperties, ElementType } from "react"
import type { StaggerFunction } from "motion-plus-dom"

type ScrambleTextOwnProps<T extends ElementType> = {
    /**
     * The text content to scramble.
     */
    children: string

    /**
     * The HTML element or component to render as (defaults to "span")
     *
     * @default "span"
     */
    as?: T

    /**
     * Whether the scramble animation is active.
     * When true, characters scramble according to delay/duration.
     * When false, characters reveal (with stagger offsets preserved).
     *
     * @default true
     */
    active?: boolean

    /**
     * Delay before each character starts scrambling.
     * Can be a number (seconds) or a stagger function like `stagger(0.1)`.
     *
     * @default 0
     */
    delay?: number | StaggerFunction

    /**
     * How long each character stays scrambled before revealing.
     * Can be a number (seconds), Infinity, or a stagger function.
     * Use Infinity to keep scrambling until active becomes false.
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
     * Characters to use for scrambling.
     * Can be a string of characters or an array of strings (for emoji support).
     *
     * @default "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
     */
    chars?: string | string[]

    /**
     * Callback when all characters have been revealed.
     */
    onComplete?: () => void

    /**
     * Custom className
     */
    className?: string

    /**
     * Custom styles
     */
    style?: CSSProperties
}

export type ScrambleTextProps<T extends ElementType = "span"> =
    ScrambleTextOwnProps<T> &
        Omit<ComponentPropsWithoutRef<T>, keyof ScrambleTextOwnProps<T>>

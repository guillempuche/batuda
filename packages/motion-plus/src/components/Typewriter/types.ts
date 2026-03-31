import type { ComponentPropsWithoutRef, ElementType } from "react"

export const TYPING_SPEEDS = {
    slow: 130,
    normal: 75,
    fast: 30,
} as const

export type TypingSpeed = keyof typeof TYPING_SPEEDS

type TypewriterOwnProps<T extends ElementType> = {
    /**
     * The text content to animate in with a "typewriter" animation.
     */
    children: string

    /**
     * The HTML element or component to render as (defaults to "span")
     *
     * @default "span"
     */
    as?: T

    /**
     * Typing speed preset (default: "normal")
     * - slow: 130ms per character
     * - normal: 75ms per character
     * - fast: 30ms per character
     *
     * @default "normal"
     */
    speed?: TypingSpeed | number

    /**
     * Amount of variance in timing between characters as a factor of the speed.
     * Defaults to "natural" for realistic human typing patterns.
     *
     * @default "natural"
     */
    variance?: number | "natural"

    /**
     * Whether the animation should be playing (default: true)
     * This is useful to manually start the animation
     * when the component enters the viewport.
     *
     * @default true
     */
    play?: boolean

    /**
     * Custom className for the cursor element
     */
    cursorClassName?: string

    /**
     * Custom styles for the cursor element
     */
    cursorStyle?: React.CSSProperties

    /**
     * Custom className for the text element
     */
    textClassName?: string

    /**
     * Custom styles for the text element
     */
    textStyle?: React.CSSProperties

    /**
     * The duration of the cursor blink animation in seconds (default: 0.5)
     *
     * @default 0.5
     */
    cursorBlinkDuration?: number

    /**
     * The number of times a cursor should blink _after_ the typing completes (default: Infinity).
     * > Note: _The cursor will always be visible immediately after typing._
     */
    cursorBlinkRepeat?: number

    /**
     * Callback when typing animation completes
     *
     * @default undefined
     */
    onComplete?: () => void

    /**
     * Callback fired on each character change during typing animation.
     *
     * @param info.text - The full current displayed string
     * @param info.character - The character(s) that were typed or removed
     * @param info.isBackspace - `true` if this was a backspace operation
     */
    onChange?: (info: {
        text: string
        character: string
        isBackspace: boolean
    }) => void

    /**
     * Replacement method for changed content:
     * - "all": Replace all text instantly
     * - "type": Type from current text to new text
     *
     * @default "type"
     */
    replace?: "all" | "type"

    /**
     * When using replace: "type", how to backspace to the common prefix.
     * - "character": Backspace one character at a time
     * - "word": Backspace one word at a time (like option-backspace)
     * - "all": Jump immediately to the common prefix
     *
     * @default "character"
     */
    backspace?: "character" | "word" | "all"

    /**
     * The speed factor for backspacing relative to typing speed
     * @default 0.2 - backspace 5x faster than typing
     */
    backspaceFactor?: number
}

export type TypewriterProps<T extends ElementType = "span"> =
    TypewriterOwnProps<T> &
        Omit<ComponentPropsWithoutRef<T>, keyof TypewriterOwnProps<T>>

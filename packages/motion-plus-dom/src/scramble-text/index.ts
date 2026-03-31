import type { MotionValue } from "motion"
import { getScrambleChar } from "./get-scramble-char"
import { resolveStagger } from "./resolve-stagger"
import {
    ScrambleTextControls,
    ScrambleTextOptions,
    ScrambleTextTarget,
} from "./types"

function isMotionValue(target: ScrambleTextTarget): target is MotionValue<string> {
    return (
        target !== null &&
        typeof target === "object" &&
        "set" in target &&
        typeof (target as any).set === "function"
    )
}

function resolveElement(elementOrSelector: Element | string): Element | null {
    if (typeof elementOrSelector === "string") {
        return document.querySelector(elementOrSelector)
    }
    return elementOrSelector
}

export function scrambleText(
    target: ScrambleTextTarget,
    options: ScrambleTextOptions = {}
): ScrambleTextControls {
    const { chars, delay: delayOption = 0, duration = 1, interval = 0.05, onComplete } = options

    // Determine if we're in MotionValue mode or Element mode
    const motionValueMode = isMotionValue(target)
    let originalText: string
    let setText: (text: string) => void

    if (motionValueMode) {
        originalText = target.get()
        setText = (text: string) => target.set(text)
    } else {
        const resolvedElement = resolveElement(target)
        if (!resolvedElement) {
            return {
                stop: () => {},
                play: () => {},
                finish: () => {},
                finished: Promise.resolve(),
            }
        }
        originalText = resolvedElement.textContent || ""
        setText = (text: string) => {
            resolvedElement.textContent = text
        }
    }

    const charCount = originalText.length

    // Track state for each character
    type CharState = "idle" | "scrambling" | "revealed"
    const charStates: CharState[] = new Array(charCount).fill("idle")
    const cancelFns: (VoidFunction | null)[] = new Array(charCount).fill(null)

    let scrambleIntervalId: ReturnType<typeof setInterval> | null = null
    let isActive = false
    let resolveFinished: (() => void) | null = null

    const finished = new Promise<void>((resolve) => {
        resolveFinished = resolve
    })

    function updateDisplay() {
        let display = ""
        for (let i = 0; i < charCount; i++) {
            const char = originalText[i]
            if (char === " " || charStates[i] === "revealed") {
                display += char
            } else if (charStates[i] === "scrambling") {
                display += getScrambleChar(chars)
            } else {
                display += char
            }
        }
        setText(display)
    }

    function checkComplete() {
        const allRevealed = charStates.every(
            (state, i) => state === "revealed" || originalText[i] === " "
        )
        if (allRevealed) {
            stopScrambleLoop()
            onComplete?.()
            resolveFinished?.()
        }
    }

    function startScrambleLoop() {
        if (scrambleIntervalId) return
        scrambleIntervalId = setInterval(updateDisplay, interval * 1000)
    }

    function stopScrambleLoop() {
        if (scrambleIntervalId) {
            clearInterval(scrambleIntervalId)
            scrambleIntervalId = null
        }
    }

    function clearAllTimers() {
        for (let i = 0; i < cancelFns.length; i++) {
            if (cancelFns[i]) {
                cancelFns[i]!()
                cancelFns[i] = null
            }
        }
    }

    function scheduleReveal(i: number, delayMs: number) {
        const timerId = setTimeout(() => {
            if (!isActive) return
            charStates[i] = "revealed"
            updateDisplay()
            checkComplete()
        }, delayMs)
        cancelFns[i] = () => clearTimeout(timerId)
    }

    function play() {
        if (isActive) return
        isActive = true

        // Set initial states based on delay
        // If delay is 0, start scrambling immediately
        // If delay > 0, start idle and transition to scrambling after delay
        for (let i = 0; i < charCount; i++) {
            if (originalText[i] === " ") {
                charStates[i] = "revealed"
            } else {
                const charDelay = resolveStagger(delayOption, i, charCount, 0)
                charStates[i] = charDelay === 0 ? "scrambling" : "idle"
            }
        }

        startScrambleLoop()

        for (let i = 0; i < charCount; i++) {
            if (originalText[i] === " ") continue

            const charDelay = resolveStagger(delayOption, i, charCount, 0)
            const charDuration = resolveStagger(duration, i, charCount, 0)

            if (charDelay > 0) {
                // Start scrambling after delay, then reveal after duration
                const timerId = setTimeout(() => {
                    if (!isActive) return
                    charStates[i] = "scrambling"
                    if (charDuration !== Infinity) {
                        scheduleReveal(i, charDuration * 1000)
                    }
                }, charDelay * 1000)
                cancelFns[i] = () => clearTimeout(timerId)
            } else if (charDuration !== Infinity) {
                // No delay - already scrambling, just schedule reveal
                scheduleReveal(i, charDuration * 1000)
            }
        }

        // Initial update
        updateDisplay()
    }

    function stop() {
        if (!isActive) return
        isActive = false

        clearAllTimers()

        // Reveal all characters immediately
        for (let i = 0; i < charCount; i++) {
            charStates[i] = "revealed"
        }

        stopScrambleLoop()
        setText(originalText)
        resolveFinished?.()
    }

    function finish() {
        if (!isActive) return
        isActive = false

        clearAllTimers()

        // Calculate minimum stagger offset to normalize timing
        let minOffset = Infinity
        for (let i = 0; i < charCount; i++) {
            if (originalText[i] === " ") continue
            const charDuration = resolveStagger(duration, i, charCount, 0)
            if (charDuration !== Infinity) {
                minOffset = Math.min(minOffset, charDuration)
            }
        }
        if (minOffset === Infinity) minOffset = 0

        for (let i = 0; i < charCount; i++) {
            if (originalText[i] === " ") {
                charStates[i] = "revealed"
                continue
            }

            // Preserve stagger offsets: first char reveals immediately, rest follow
            const charDuration = resolveStagger(duration, i, charCount, 0)
            const relativeOffset =
                charDuration === Infinity ? 0 : charDuration - minOffset

            if (relativeOffset === 0) {
                charStates[i] = "revealed"
            } else {
                // Keep scrambling briefly to maintain stagger feel
                charStates[i] = "scrambling"
                const timerId = setTimeout(() => {
                    charStates[i] = "revealed"
                    updateDisplay()
                    checkComplete()
                }, relativeOffset * 1000)
                cancelFns[i] = () => clearTimeout(timerId)
            }
        }

        // Start brief scramble interval if some chars are still scrambling
        const hasScrambling = charStates.some((s) => s === "scrambling")
        if (hasScrambling) {
            startScrambleLoop()
        } else {
            stopScrambleLoop()
        }

        updateDisplay()
        checkComplete()
    }

    // Auto-start
    play()

    return {
        stop,
        play,
        finish,
        finished,
    }
}

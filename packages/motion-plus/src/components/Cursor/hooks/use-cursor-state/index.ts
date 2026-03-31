import { useEffect, useState } from "react"
import { onlyLeftClicks, onlyMouse } from "../utils/only-mouse-events"
import { findTarget } from "./find-target"
import { CursorState, CursorTarget } from "./types"

type OnChangeCallback = (state: CursorState) => void

interface PointerOverListener {
    onChange: (callback: OnChangeCallback) => void
}

let listener: PointerOverListener | null = null

let state: CursorState = {
    type: "default",
    isPressed: false,
    fontSize: null,
    targetBoundingBox: null,
    target: null,
    zone: null,
}

function getZone(target: CursorTarget): string | null {
    let zone: string | null = null

    if ("closest" in target) {
        const zoneElement = target.closest("[data-cursor-zone]")

        if (zoneElement instanceof HTMLElement) {
            zone = zoneElement.dataset.cursorZone || null
        }
    }

    return zone
}

function startPointerOverListener(): PointerOverListener {
    const listeners: Set<OnChangeCallback> = new Set()

    function updateState(newState: Partial<CursorState>) {
        state = { ...state, ...newState }
        listeners.forEach((listener) => listener(state))
    }

    const handlePointerDown = onlyLeftClicks(() => {
        if (!state.isPressed) {
            updateState({ isPressed: true })
        }
    })

    const handlePointerUp = onlyLeftClicks(() => {
        if (state.isPressed) {
            updateState({ isPressed: false })
        }
    })

    const handlePointerOver = onlyMouse(({ target }: PointerEvent) => {
        if (!target) return

        const [type, cursorTarget] = findTarget(target as CursorTarget)

        let hasUpdated = false
        let newState: Partial<CursorState> = {
            target: cursorTarget,
            zone: getZone(target as CursorTarget),
        }

        if (type !== state.type) {
            newState.type = type
            hasUpdated = true
        }

        if (newState.zone !== state.zone) {
            newState.zone = newState.zone
            hasUpdated = true
        }

        const size =
            type === "pointer" && cursorTarget
                ? cursorTarget.getBoundingClientRect()
                : null
        if (size !== state.targetBoundingBox) {
            newState.targetBoundingBox = size
            hasUpdated = true
        }

        if (type === "text") {
            const { fontSize: computedFontSize } = window.getComputedStyle(
                target as Element
            )
            const newFontSize = computedFontSize
                ? parseInt(computedFontSize)
                : null
            if (newFontSize !== state.fontSize) {
                newState.fontSize = newFontSize
                hasUpdated = true
            }
        } else {
            if (state.fontSize) {
                newState.fontSize = null
                hasUpdated = true
            }
        }

        if (hasUpdated) {
            updateState(newState)
        }
    })

    function addEventListeners() {
        window.addEventListener("pointerover", handlePointerOver)
        window.addEventListener("pointerdown", handlePointerDown)
        window.addEventListener("pointerup", handlePointerUp)
    }

    function removeEventListeners() {
        window.removeEventListener("pointerover", handlePointerOver)
        window.removeEventListener("pointerdown", handlePointerDown)
        window.removeEventListener("pointerup", handlePointerUp)
    }

    return {
        onChange: (callback) => {
            if (!listeners.size) {
                addEventListeners()
            }

            listeners.add(callback)

            return () => {
                listeners.delete(callback)

                if (!listeners.size) {
                    removeEventListeners()
                }
            }
        },
    }
}

function getPointerOverListener(): PointerOverListener {
    if (!listener) {
        listener = startPointerOverListener()
    }

    return listener
}

export function useCursorState(): CursorState {
    const [latestState, setLatestState] = useState<CursorState>({ ...state })

    useEffect(() => {
        return getPointerOverListener().onChange((newState) => {
            setLatestState(newState)
        })
    }, [latestState])

    return latestState
}

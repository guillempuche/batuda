import { CursorTarget, CursorType } from "./types"

export type TypeAndTarget = [CursorType, CursorTarget | null]

function findCustomTarget(target: CursorTarget): CursorTarget | null {
    return target.closest("[data-cursor]")
}

function findPointerTarget(element: CursorTarget): CursorTarget | null {
    return element.closest('a, button, input[type="button"]:not(:disabled)')
}

function findTextTarget(element: CursorTarget): CursorTarget | null {
    if (window.getComputedStyle(element).userSelect === "none") return null

    return element.closest(
        "p, textarea:not(:disabled), input[type='text']:not(:disabled), h1, h2, h3, h4, h5, h6"
    )
}

export function findTarget(eventTarget: CursorTarget): TypeAndTarget {
    let target: CursorTarget | null = findCustomTarget(eventTarget)
    if (target)
        return [(target as HTMLElement).dataset.cursor as CursorType, target]

    target = findPointerTarget(eventTarget)
    if (target) return ["pointer", target]

    target = findTextTarget(eventTarget)
    if (target) return ["text", target]

    return ["default", null]
}

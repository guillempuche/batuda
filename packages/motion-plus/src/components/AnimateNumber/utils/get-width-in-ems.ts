import { Em } from "../types"

export function getWidthInEm(element: HTMLElement): Em {
    const { width, fontSize } = getComputedStyle(element)
    return `${parseFloat(width) / parseFloat(fontSize)}em`
}

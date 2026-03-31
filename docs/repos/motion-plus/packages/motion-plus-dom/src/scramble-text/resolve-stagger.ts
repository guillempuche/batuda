import { StaggerFunction } from "./types"

export function resolveStagger(
    value: number | StaggerFunction | undefined,
    index: number,
    total: number,
    defaultValue: number
): number {
    if (typeof value === "function") {
        return value(index, total)
    }
    return value ?? defaultValue
}

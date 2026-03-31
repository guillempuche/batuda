export function onlyMouse(callback: (event: PointerEvent) => void) {
    return (event: PointerEvent) => {
        if (event.pointerType === "mouse") {
            callback(event)
        }
    }
}

export function onlyLeftClicks(callback: (event: PointerEvent) => void) {
    return onlyMouse((event: PointerEvent) => {
        if (event.button === 0) {
            callback(event)
        }
    })
}

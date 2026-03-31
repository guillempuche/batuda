import { useEffect, useState } from "react"

interface InViewListeners {
    show: () => void
    hide: () => void
}

interface InViewListener {
    on: (listeners: InViewListeners) => () => void
}

let listener: InViewListener | null = null

function startInViewListener(): InViewListener {
    const listeners: Set<InViewListeners> = new Set()

    function showCursor() {
        listeners.forEach((listener) => listener.show())
    }

    function hideCursor() {
        listeners.forEach((listener) => listener.hide())
    }

    function addEventListeners() {
        document.body.addEventListener("mouseenter", showCursor)
        document.body.addEventListener("mouseleave", hideCursor)
    }

    function removeEventListeners() {
        document.body.removeEventListener("mouseenter", showCursor)
        document.body.removeEventListener("mouseleave", hideCursor)
    }

    return {
        on: (callbacks) => {
            if (!listeners.size) {
                addEventListeners()
            }

            listeners.add(callbacks)

            return () => {
                listeners.delete(callbacks)

                if (listeners.size === 0) {
                    removeEventListeners()
                }
            }
        },
    }
}

function getInViewListener() {
    if (!listener) {
        listener = startInViewListener()
    }

    return listener
}

export function useCursorIsInView(resetSpring: VoidFunction) {
    const [isVisible, setIsVisible] = useState(true)

    useEffect(() => {
        return getInViewListener().on({
            show: () => {
                if (isVisible) return

                resetSpring()
                setIsVisible(true)
            },
            hide: () => setIsVisible(false),
        })
    }, [isVisible])

    return isVisible
}

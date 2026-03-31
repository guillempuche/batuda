import { ReactPortal, useLayoutEffect, useState } from "react"
import { createPortal } from "react-dom"

export function useBodyPortal(children: React.ReactNode): ReactPortal | null {
    const [hostElement, setHostElement] = useState<Element | null>(null)

    useLayoutEffect(() => {
        setHostElement(document.body)
    }, [])

    return hostElement ? createPortal(children, hostElement) : null
}

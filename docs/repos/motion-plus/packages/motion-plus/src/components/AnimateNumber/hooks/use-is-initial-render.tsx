import { useEffect, useRef } from "react"

export function useIsInitialRender() {
    /**
     * If `initial={false}` we only want to pass this to components in the first render.
     */
    const isInitialRender = useRef(true)

    useEffect(() => {
        isInitialRender.current = false
    }, [])

    return isInitialRender.current
}

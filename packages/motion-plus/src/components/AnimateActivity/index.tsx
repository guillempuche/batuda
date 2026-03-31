import { PresenceChild, invariant } from "motion/react"
import { Activity, useState } from "react"

export interface AnimateActivityProps {
    mode: "visible" | "hidden"
    layoutMode: "default" | "pop"
    children: React.ReactNode
}

export function AnimateActivity({
    mode: modeFromProps,
    layoutMode,
    children,
}: AnimateActivityProps) {
    /**
     * This is the mode that we'll render.
     */
    const [mode, setMode] = useState(modeFromProps)

    /**
     * This is the goal state as defined by props.
     */
    const isPresent = modeFromProps === "visible"

    /**
     * Immediately switch to mode="visible" when the user
     * changes the mode prop.
     */
    if (isPresent && mode !== "visible") {
        setMode("visible")
        return null
    }

    /**
     * Set mode to "hidden" only when the exit animation is complete.
     */
    const onExitComplete = () => setMode("hidden")

    invariant(
        Boolean(Activity),
        "Activity component not found - upgrade to React 19.2.0 or higher"
    )

    return (
        <Activity mode={mode}>
            <PresenceChild
                isPresent={isPresent}
                onExitComplete={!isPresent ? onExitComplete : undefined}
                presenceAffectsLayout={false}
                mode={layoutMode === "pop" ? "popLayout" : "sync"}
            >
                {children as any}
            </PresenceChild>
        </Activity>
    )
}

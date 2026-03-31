import React, { PropsWithChildren, useInsertionEffect } from "react"
import { createViewAnimation } from "./create-view-animation"
import { useResetViewTransitions } from "./hooks/use-reset-view-transitions"
import { sharedProps } from "./shared-props"
import { AnimateViewProps } from "./types"

const ViewTransition = (React as any).ViewTransition

export function AnimateView({
    children,
    ...props
}: PropsWithChildren<AnimateViewProps>) {
    useResetViewTransitions()

    const { name } = props

    useInsertionEffect(() => {
        if (name) {
            sharedProps.set(name, props)

            return () => {
                sharedProps.delete(name)
            }
        }
    }, [name])

    return (
        <ViewTransition
            name={name}
            onEnter={createViewAnimation("enter", props)}
            onExit={createViewAnimation("exit", props)}
            onShare={createViewAnimation("share", props)}
            onUpdate={createViewAnimation("update", props)}
        >
            {children}
        </ViewTransition>
    )
}

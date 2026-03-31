"use client"

import { Cursor, useCursorState } from "motion-plus/react"
import { animate, motion, useMotionValue } from "motion/react"
import { useEffect } from "react"

/**
 * Title: Cursor: Magnetic Outline
 */
const length = 12
const thickness = 2
export default function Example() {
    const state = useCursorState()
    const rotate = useMotionValue(0)

    useEffect(() => {
        if (!state.targetBoundingBox) {
            animate(rotate, [rotate.get(), rotate.get() + 360], {
                duration: 3,
                ease: "linear",
                repeat: Infinity,
            })
        } else {
            animate(rotate, Math.round(rotate.get() / 180) * 180, {
                type: "spring",
                bounce: 0.3,
            })
        }
    }, [state.targetBoundingBox])

    return (
        <div style={container}>
            <motion.button
                data-testid="pointer-target"
                style={{
                    background: "none",
                    padding: 8,
                    width: 140,
                    height: 50,
                    color: "white",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    border: "1px dashed #fff4",
                    borderRadius: 0,
                    userSelect: "none",
                }}
                whileTap={{ scale: 0.95 }}
            >
                Click me
            </motion.button>

            <motion.button
                data-testid="pointer-target"
                style={{
                    background: "none",
                    padding: 8,
                    width: 200,
                    height: 200,
                    color: "white",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    border: "1px dashed #fff4",
                    borderRadius: 0,
                    userSelect: "none",
                }}
                whileTap={{ scale: 0.95 }}
            >
                Click me
            </motion.button>

            <Cursor
                follow
                magnetic={{ morph: false, snap: 0 }}
                style={{ width: 5, height: 5, backgroundColor: "white" }}
            />
            <Cursor
                data-testid="cursor-no-padding"
                magnetic
                style={{
                    width: 40,
                    height: 40,
                    backgroundColor: "transparent",
                    borderRadius: 0,
                    rotate,
                }}
            >
                <>
                    <motion.div
                        layout
                        layoutDependency={state.targetBoundingBox}
                        id="top-left"
                        style={{
                            width: thickness,
                            height: length,
                            top: 0,
                            left: 0,
                            position: "absolute",
                            background: "white",
                        }}
                    />
                    <motion.div
                        layout
                        style={{
                            width: length,
                            height: thickness,
                            top: 0,
                            left: 0,
                            background: "white",
                            position: "absolute",
                        }}
                    />
                    <motion.div
                        layout
                        style={{
                            width: thickness,
                            height: length,
                            top: 0,
                            right: 0,
                            background: "white",
                            position: "absolute",
                        }}
                    />
                    <motion.div
                        layout
                        style={{
                            width: length,
                            height: thickness,
                            top: 0,
                            right: 0,
                            background: "white",
                            position: "absolute",
                        }}
                    />
                    <motion.div
                        layout
                        style={{
                            width: thickness,
                            height: length,
                            bottom: 0,
                            left: 0,
                            background: "white",
                            position: "absolute",
                        }}
                    />
                    <motion.div
                        layout
                        style={{
                            width: length,
                            height: thickness,
                            bottom: 0,
                            left: 0,
                            background: "white",
                            position: "absolute",
                        }}
                    />
                    <motion.div
                        layout
                        style={{
                            width: thickness,
                            height: length,
                            bottom: 0,
                            right: 0,
                            background: "white",
                            position: "absolute",
                        }}
                    />
                    <motion.div
                        layout
                        style={{
                            width: length,
                            height: thickness,
                            bottom: 0,
                            right: 0,
                            background: "white",
                            position: "absolute",
                        }}
                    />
                </>
            </Cursor>
        </div>
    )
}

const container: React.CSSProperties = {
    display: "flex",
    width: 600,
    flexDirection: "column",
    padding: 100,
    height: 400,
    position: "absolute",
    top: 100,
    left: 300,
    gap: 20,
}

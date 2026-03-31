"use client"

import { Cursor, useMagneticPull } from "motion-plus/react"
import * as motion from "motion/react-client"
import { useRef } from "react"

/**
 * Title: Cursor: Magnetic iOS
 */

export default function IOSPointer() {
    const ref = useRef<HTMLButtonElement>(null)
    const { x, y } = useMagneticPull(ref)

    return (
        <div className="container">
            <motion.button ref={ref} className="button" whileTap="pressed">
                <motion.span
                    variants={{ pressed: { scale: 0.95 } }}
                    style={{ x, y }}
                >
                    <Chevron />
                    Appearance
                </motion.span>
            </motion.button>

            <Cursor
                magnetic
                className="cursor"
                variants={{
                    pointer: {
                        backgroundColor: "#dddddd",
                    },
                }}
                style={{
                    borderRadius: 10,
                    backgroundColor: "#7e7e7e",
                }}
            />

            <Stylesheet />
        </div>
    )
}

/**
 * ==============   Styles   ================
 */

function Stylesheet() {
    return (
        <style>
            {`
                .button {
                    background: none;
                    padding: 8px;
                    color: #0A84FF;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    border: 1px dashed #fff4;
                    border-radius: 0;
                    user-select: none;
                    font-weight: 500;
                    font-size: 24px;
                }

                .button > span {
                    display: flex;
                    gap: 8px;
                    align-items: center;
                }

                .cursor {
                    mix-blend-mode: difference;
                }
            `}
        </style>
    )
}

function Chevron() {
    return (
        <svg
            width="12"
            height="20"
            viewBox="0 0 12 20"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
        >
            <path
                d="M10 2L2 10L10 18"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    )
}

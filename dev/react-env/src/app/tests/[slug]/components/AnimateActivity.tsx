"use client"

import { AnimateActivity } from "motion-plus/animate-activity"
import { motion } from "motion/react"
import { useState } from "react"

/**
 * Title: AnimateActivity
 */

export default function Example() {
    const [isVisible, setIsVisible] = useState(true)
    return (
        <>
            <AnimateActivity
                mode={isVisible ? "visible" : "hidden"}
                layoutMode="pop"
            >
                <motion.div animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                    <h1>AnimateActivity</h1>
                </motion.div>
            </AnimateActivity>
            <button onClick={() => setIsVisible(!isVisible)}>Toggle</button>
        </>
    )
}

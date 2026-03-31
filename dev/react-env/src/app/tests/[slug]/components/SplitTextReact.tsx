"use client"

import { AnimateText } from "motion-plus/react"
import * as motion from "motion/react-client"

export default function SplitTextReact() {
    return (
        <div>
            <h2>React Split Text Component</h2>

            <div style={{ maxWidth: "400px" }}>
                <h3>Default Animation</h3>
                <motion.p
                    initial="hidden"
                    whileInView="visible"
                    transition={{ staggerChildren: 0.01 }}
                >
                    <AnimateText
                        variants={{
                            hidden: { opacity: 0, filter: "blur(10px)" },
                            visible: { opacity: 1, filter: "blur(0px)" },
                        }}
                    >
                        Hello world, 😅 this is an example of splitting text
                        word by word and line by line
                    </AnimateText>
                </motion.p>
            </div>

            <div style={{ marginTop: "2rem" }}>
                <h3>Custom Animation</h3>
                <AnimateText>
                    This text has a custom scale animation with a bouncy easing
                </AnimateText>
            </div>

            <div style={{ marginTop: "2rem" }}>
                <h3>Custom Delimiter</h3>
                <AnimateText splitBy="+">
                    Hello+world+this+is+split+by+plus+signs
                </AnimateText>
            </div>
        </div>
    )
}

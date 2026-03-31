import { motion, useScroll, useTransform } from "framer-motion"
import * as React from "react"
import { ReactNode, useRef } from "react"

const BubbleParallax: React.FC<{
    children: ReactNode
    id: string
    containerRef: React.RefObject<HTMLElement>
}> = ({ children, containerRef, id }) => {
    const ref = useRef<HTMLDivElement>(null)

    const { scrollYProgress } = useScroll({
        target: ref,
        container: containerRef,
        offset: ["start end", "end start"],
    })

    const opacity = useTransform(scrollYProgress, (progressValue) => {
        const axis = 2 * progressValue - 1
        return -Math.abs(axis) + 1
    })

    return (
        <motion.div
            id={id}
            ref={ref}
            style={{
                opacity,
                marginBottom: "50px",
            }}
        >
            {children}
        </motion.div>
    )
}

export const App = () => {
    const scrollContainerRef = useRef<HTMLDivElement>(null)

    return (
        <div
            style={{
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                height: "100vh",
                backgroundColor: "#E0E0E0",
            }}
        >
            <div
                id="scroll-container"
                ref={scrollContainerRef}
                style={{
                    width: "100%",
                    height: "80vh", // ❌ This breaks in React 19
                    overflowY: "scroll",
                    backgroundColor: "#1A237E",
                    padding: "20px",
                    boxSizing: "border-box",
                    borderRadius: "8px",
                }}
            >
                <div
                    style={{
                        color: "white",
                        textAlign: "center",
                        fontSize: "2rem",
                        padding: "40px 0",
                    }}
                >
                    Parallax Area
                </div>

                {[...Array(10)].map((_, index) => {
                    return (
                        <BubbleParallax
                            key={index}
                            containerRef={scrollContainerRef}
                            id={"item-" + index}
                        >
                            <div
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    width: "100%",
                                    height: "300px",
                                    backgroundColor: "#BBDEFB",
                                    fontSize: "5rem",
                                    color: "#1A237E",
                                    borderRadius: "10px",
                                }}
                            >
                                {index + 1}
                            </div>
                        </BubbleParallax>
                    )
                })}
            </div>
        </div>
    )
}

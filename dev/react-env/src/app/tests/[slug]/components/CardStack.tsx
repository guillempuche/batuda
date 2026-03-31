"use client"

import {
    animate,
    easeIn,
    mix,
    motion,
    progress,
    useMotionValue,
    useTransform,
    wrap,
} from "motion/react"
import { useEffect, useRef, useState } from "react"

/**
 * Title: Card Stack: Swipeable card stack
 */

interface Card {
    id: number
    color: string
    title: string
    ratio: number
}

const defaultCards: Card[] = [
    { id: 1, color: "#FF6B6B", title: "Card 1", ratio: 3 / 4 },
    { id: 2, color: "#4ECDC4", title: "Card 2", ratio: 4 / 3 },
    { id: 3, color: "#45B7D1", title: "Card 3", ratio: 3 / 4 },
    { id: 4, color: "#FFA07A", title: "Card 4", ratio: 4 / 3 },
    { id: 5, color: "#98D8C8", title: "Card 5", ratio: 3 / 4 },
    { id: 6, color: "#F7DC6F", title: "Card 6", ratio: 4 / 3 },
]

export default function Example() {
    const [currentIndex, setCurrentIndex] = useState(0)
    const ref = useRef<HTMLUListElement>(null)
    const [width, setWidth] = useState(400)

    useEffect(() => {
        if (!ref.current) return
        setWidth(ref.current.offsetWidth)
    }, [])

    return (
        <div style={container}>
            <ul className="stack" ref={ref} style={stackStyle}>
                {defaultCards.map((card, index) => {
                    return (
                        <StackCard
                            {...card}
                            minDistance={width * 0.5}
                            maxRotate={5}
                            key={card.id}
                            index={index}
                            currentIndex={currentIndex}
                            totalCards={defaultCards.length}
                            setNextCard={() => {
                                setCurrentIndex(
                                    wrap(0, defaultCards.length, currentIndex + 1)
                                )
                            }}
                        />
                    )
                })}
            </ul>

            <p style={instructions}>
                Swipe the top card left or right.
                <br />
                Swiped cards move to the back of the stack.
            </p>
        </div>
    )
}

interface StackCardProps {
    id: number
    color: string
    title: string
    ratio: number
    index: number
    totalCards: number
    currentIndex: number
    maxRotate: number
    minDistance?: number
    minSpeed?: number
    setNextCard: () => void
}

function StackCard({
    color,
    title,
    ratio,
    index,
    currentIndex,
    totalCards,
    maxRotate,
    setNextCard,
    minDistance = 400,
    minSpeed = 50,
}: StackCardProps) {
    /**
     * Math.sin(index) is a way of generating a value between -1 and 1 in a
     * deterministic way that can provide a pleasing distribution throughout a range.
     * For instance passing it to `mix(0, maxRotate)` will give us a nice
     * distribution throughout -maxRotate and maxRotate.
     */
    const baseRotation = mix(0, maxRotate, Math.sin(index))
    const x = useMotionValue(0)
    const rotate = useTransform(
        x,
        [0, 400],
        [baseRotation, baseRotation + 10],
        { clamp: false }
    )
    const zIndex =
        totalCards - wrap(totalCards, 0, index - currentIndex + 1)

    const onDragEnd = () => {
        const distance = Math.abs(x.get())
        const speed = Math.abs(x.getVelocity())

        if (distance > minDistance || speed > minSpeed) {
            setNextCard()

            animate(x, 0, {
                type: "spring",
                stiffness: 600,
                damping: 50,
            })
        } else {
            animate(x, 0, {
                type: "spring",
                stiffness: 300,
                damping: 50,
            })
        }
    }

    const opacity = progress(totalCards * 0.25, totalCards * 0.75, zIndex)

    const progressInStack = progress(0, totalCards - 1, zIndex)
    const scale = mix(0.5, 1, easeIn(progressInStack))

    return (
        <motion.li
            className="item"
            style={{
                position: "absolute",
                top: "50%",
                left: "50%",
                translate: "-50% -50%",
                width: ratio > 1 ? "100%" : "auto",
                height: ratio <= 1 ? "100%" : "auto",
                aspectRatio: ratio,
                zIndex,
                rotate,
                x,
                willChange: "transform",
            }}
            initial={{ opacity: 0, scale: 0.3 }}
            animate={{ opacity, scale }}
            whileTap={index === currentIndex ? { scale: 0.98 } : {}}
            transition={{
                type: "spring",
                stiffness: 600,
                damping: 30,
            }}
            drag={index === currentIndex ? "x" : false}
            onDragEnd={onDragEnd}
        >
            <div
                style={{
                    width: "100%",
                    height: "100%",
                    backgroundColor: color,
                    borderRadius: "10px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "white",
                    fontSize: 24,
                    fontWeight: 600,
                    boxShadow: "1px 3px 5px rgba(0,0,0,0.3)",
                    userSelect: "none",
                    touchAction: "none",
                }}
            >
                {title}
            </div>
        </motion.li>
    )
}

const container: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 20,
    padding: 20,
}

const stackStyle: React.CSSProperties = {
    position: "relative",
    width: 400,
    height: 400,
    maxWidth: "90vw",
    listStyle: "none",
    margin: 0,
    padding: 0,
}

const instructions: React.CSSProperties = {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
    lineHeight: 1.4,
    padding: "0 8px",
    fontFamily: "monospace",
}


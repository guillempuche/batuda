"use client"

import { Ticker, useTickerItem } from "motion-plus/react"
import { motion, useMotionValue, useTransform } from "motion/react"
import { useEffect, useInsertionEffect, useState } from "react"

/**
 * Title: Ticker: useTickerItem RTL
 */

function Item({ index }: { index: number }) {
    const { offset } = useTickerItem()
    const opacity = useTransform(offset, [0, 400], [1, 0])

    useEffect(() => {
        console.log(index, offset.get())
    }, [offset])

    return (
        <motion.div
            id="item"
            style={{
                width: "100px",
                height: "140px",
                backgroundColor: `hsl(${index * 30}, 100%, 50%)`,
                color: "white",
                justifySelf: "flex-start",
                opacity,
            }}
        />
    )
}

export default function Example() {
    const offset = useMotionValue(0)
    const [width, setWidth] = useState(520)

    useInsertionEffect(() => {
        document.dir = "rtl"
    }, [])

    const shiftOffset = () => {
        offset.set(offset.get() - 100)
    }

    const shiftWidth = () => {
        setWidth(width - 200)
    }

    return (
        <div style={{ display: "flex", gap: "10px", flexDirection: "column" }}>
            <Ticker
                items={[<Item key={0} index={0} />]}
                style={{ width }}
                offset={offset}
            />
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "10px",
                }}
            >
                <button id="move" onClick={shiftOffset}>
                    Move
                </button>
                <button id="size" onClick={shiftWidth}>
                    Resize
                </button>
            </div>
        </div>
    )
}

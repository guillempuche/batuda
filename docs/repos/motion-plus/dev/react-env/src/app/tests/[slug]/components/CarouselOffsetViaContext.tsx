"use client"

import { Carousel, useCarousel, useTicker } from "motion-plus/react"
import { useEffect, useState } from "react"

/**
 * Title: Carousel: Offset via context
 */

function Item({ index }: { index: number }) {
    return (
        <div
            style={{
                width: "100px",
                height: "140px",
                backgroundColor: `hsl(${index * 30}, 90%, 50%)`,
                color: "white",
                justifySelf: "flex-start",
                borderRadius: "5px",
            }}
        />
    )
}

function SetOffset() {
    const { isMeasured } = useTicker()
    const { targetOffset } = useCarousel()

    useEffect(() => {
        if (isMeasured) {
            targetOffset.set(500)
        }
    }, [isMeasured, targetOffset])

    return null
}

export default function Example() {
    const [width, setWidth] = useState(520)

    const shiftWidth = () => {
        setWidth(width - 200)
    }

    return (
        <div style={{ display: "flex", gap: "10px", flexDirection: "column" }}>
            <Carousel
                id="twelve-items"
                items={[
                    <Item key={0} index={0} />,
                    <Item key={1} index={1} />,
                    <Item key={2} index={2} />,
                    <Item key={3} index={3} />,
                    <Item key={4} index={4} />,
                    <Item key={5} index={5} />,
                    <Item key={6} index={6} />,
                    <Item key={7} index={7} />,
                    <Item key={8} index={8} />,
                    <Item key={9} index={9} />,
                    <Item key={10} index={10} />,
                    <Item key={11} index={11} />,
                    <Item key={12} index={12} />,
                ]}
                style={{ width }}
                snap={false}
            >
                <SetOffset />
            </Carousel>
        </div>
    )
}

"use client"

import { Carousel } from "motion-plus/react"

/**
 * Title: Carousel: Focus item
 */

function Item({ index }: { index: number }) {
    return (
        <div
            style={{
                width: "100px",
                height: "140px",
                backgroundColor: `hsl(${index * 50}, 90%, 50%)`,
                color: "white",
                borderRadius: "5px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
            }}
        >
            <button data-item={index}>Item {index}</button>
        </div>
    )
}

export default function CarouselFocusItem() {
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <button id="before-carousel">Before</button>
            <div id="carousel-focus" style={{ width: 520, position: "relative" }}>
                <Carousel
                    items={Array.from({ length: 6 }, (_, i) => (
                        <Item key={i} index={i} />
                    ))}
                />
            </div>
            <button id="after-carousel">After</button>
        </div>
    )
}

"use client"

import { Carousel, useCarousel } from "motion-plus/react"
import { useState } from "react"

/**
 * Title: Carousel: x-axis
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

function Dots() {
    const { currentPage, totalPages, gotoPage } = useCarousel()

    return (
        <div
            className="dots"
            style={{
                display: "flex",
                gap: 10,
                justifyContent: "center",
                padding: 10,
                position: "absolute",
                bottom: 10,
                left: "50%",
                transform: "translateX(-50%)",
                background: "rgba(0, 0, 0, 0.5)",
                borderRadius: "20px",
            }}
        >
            {Array.from({ length: totalPages }).map((_, index) => (
                <div
                    className="dot"
                    key={index}
                    style={{
                        width: 10,
                        height: 10,
                        backgroundColor:
                            index === currentPage
                                ? "white"
                                : "rgba(255, 255, 255, 0.5)",
                        borderRadius: "50%",
                    }}
                    onClick={() => gotoPage(index)}
                />
            ))}
        </div>
    )
}

function CarouselNav() {
    const { prevPage, nextPage, isNextActive, isPrevActive } = useCarousel()

    return (
        <div
            style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: 10,
                pointerEvents: "none",
            }}
        >
            <button
                onClick={prevPage}
                // disabled={!isPrevActive}
                style={{
                    opacity: isPrevActive ? 1 : 0.5,
                    background: "#000",
                    color: "#fff",
                    pointerEvents: "auto",
                }}
                className="prev"
            >
                &#8592; {/* Unicode left arrow */}
            </button>
            <button
                onClick={nextPage}
                // disabled={!isNextActive}
                style={{
                    opacity: isNextActive ? 1 : 0.5,
                    background: "#000",
                    color: "#fff",
                    pointerEvents: "auto",
                }}
                className="next"
            >
                &#8594; {/* Unicode right arrow */}
            </button>
        </div>
    )
}

export default function Example() {
    const [width, setWidth] = useState(520)

    const shiftWidth = () => {
        setWidth(width - 200)
    }

    return (
        <div style={{ display: "flex", gap: "10px", flexDirection: "column" }}>
            {/* Example of loop disabled */}
            <div id="one-item" style={{ position: "relative" }}>
                <Carousel
                    overflow={true}
                    loop={false}
                    items={[<Item key={0} index={0} />]}
                    style={{ width }}
                >
                    <CarouselNav />
                    <Dots />
                </Carousel>
            </div>
            {/* Example of loop disabled */}
            <div id="two-items" style={{ position: "relative" }}>
                <Carousel
                    overflow={true}
                    loop={false}
                    items={[
                        <Item key={0} index={0} />,
                        <Item key={1} index={1} />,
                    ]}
                    style={{ width }}
                >
                    <CarouselNav />
                    <Dots />
                </Carousel>
            </div>
            <div id="twelve-items" style={{ position: "relative" }}>
                <Carousel
                    overflow={true}
                    loop={false}
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
                >
                    <CarouselNav />
                    <Dots />
                </Carousel>
            </div>
            {/* Example of loop *and* snap disabled */}
            <div id="loop-snap-disabled" style={{ position: "relative" }}>
                <Carousel
                    overflow={true}
                    loop={false}
                    snap={false}
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
                >
                    <CarouselNav />
                    <Dots />
                </Carousel>
            </div>
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "10px",
                }}
            >
                <button id="size" onClick={shiftWidth}>
                    Resize
                </button>
            </div>
            <style>
                {`
                body { overflow: hidden; }
                `}
            </style>
        </div>
    )
}

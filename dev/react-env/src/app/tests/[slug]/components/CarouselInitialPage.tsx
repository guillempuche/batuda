"use client"

import { Carousel, useCarousel } from "motion-plus/react"
import { useState } from "react"

/**
 * Title: Carousel: Initial page prop
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
                style={{
                    opacity: isPrevActive ? 1 : 0.5,
                    background: "#000",
                    color: "#fff",
                    pointerEvents: "auto",
                }}
                className="prev"
            >
                &#8592;
            </button>
            <button
                onClick={nextPage}
                style={{
                    opacity: isNextActive ? 1 : 0.5,
                    background: "#000",
                    color: "#fff",
                    pointerEvents: "auto",
                }}
                className="next"
            >
                &#8594;
            </button>
        </div>
    )
}

export default function Example() {
    return (
        <div
            style={{
                display: "flex",
                gap: "10px",
                flexDirection: "column",
                width: 520,
            }}
        >
            <div id="page-0" style={{ position: "relative" }}>
                <Carousel
                    page={0}
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
                >
                    <CarouselNav />
                    <Dots />
                </Carousel>
            </div>
            <div id="page-2" style={{ position: "relative" }}>
                <Carousel
                    page={2}
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
                >
                    <CarouselNav />
                    <Dots />
                </Carousel>
            </div>
            <div id="page-3-loop-disabled" style={{ position: "relative" }}>
                <Carousel
                    page={3}
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
                >
                    <CarouselNav />
                    <Dots />
                </Carousel>
            </div>
            <ReactivePageTest />
        </div>
    )
}

function ReactivePageTest() {
    const [page, setPage] = useState(0)

    return (
        <div>
            <div id="reactive-page" style={{ position: "relative" }}>
                <Carousel
                    page={page}
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
                >
                    <CarouselNav />
                    <Dots />
                </Carousel>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                <button id="set-page-0" onClick={() => setPage(0)}>
                    Page 0
                </button>
                <button id="set-page-1" onClick={() => setPage(1)}>
                    Page 1
                </button>
                <button id="set-page-2" onClick={() => setPage(2)}>
                    Page 2
                </button>
            </div>
        </div>
    )
}

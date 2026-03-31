"use client"

import { useState } from "react"

/**
 * Title: Accordion
 */

export default function Example() {
    const [openIndex, setOpenIndex] = useState<number | null>(null)

    const questions = [
        {
            question: "What is Motion+?",
            answer: "Motion+ is a collection of premium features and components for Motion and Motion for React, providing advanced animation capabilities and UI components.",
        },
        {
            question: "How do I install Motion+?",
            answer: "You can install Motion+ using your preferred package manager. For npm: npm install motion-plus. For yarn: yarn add motion-plus.",
        },
        {
            question: "What components are included?",
            answer: "Motion+ includes components like AnimateNumber, Carousel, Cursor, Ticker, Typewriter, and more. Each component is designed to work seamlessly with Motion's animation system.",
        },
        {
            question: "Is Motion+ compatible with React?",
            answer: "Yes, Motion+ is fully compatible with React and provides React-specific components and hooks. It's built on top of Motion for React (previously Framer Motion).",
        },
        {
            question: "Can I use Motion+ in production?",
            answer: "Yes, Motion+ is production-ready and actively maintained. It's designed to be performant and reliable for use in real-world applications.",
        },
    ]

    return (
        <MotionConfig transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}>
            <div style={container}>
                {questions.map((item, index) => {
                    const isOpen = openIndex === index
                    return (
                        <motion.div
                            key={index}
                            style={accordionItem}
                            initial={false}
                            animate={isOpen ? "open" : "closed"}
                        >
                            <button
                                onClick={() =>
                                    setOpenIndex(isOpen ? null : index)
                                }
                                style={button}
                            >
                                <span style={question}>{item.question}</span>
                                <motion.span
                                    style={icon}
                                    key={isOpen ? "minus" : "plus"}
                                    initial={{ scale: 0.8, opacity: 0.5 }}
                                    animate={{ scale: 1, opacity: 1 }}
                                    transition={{ duration: 0.2 }}
                                >
                                    {isOpen ? "−" : "+"}
                                </motion.span>
                            </button>
                            <motion.div
                                style={answerContainer}
                                variants={{
                                    open: {
                                        height: "auto",
                                        opacity: 1,
                                    },
                                    closed: {
                                        height: 0,
                                        opacity: 0,
                                    },
                                }}
                                transition={{
                                    height: {
                                        duration: 0.3,
                                        ease: [0.4, 0, 0.2, 1],
                                    },
                                    opacity: { duration: 0.2, ease: "easeOut" },
                                }}
                            >
                                <motion.div
                                    style={answer}
                                    variants={{
                                        open: {
                                            filter: "blur(0px)",
                                        },
                                        closed: {
                                            filter: "blur(4px)",
                                        },
                                    }}
                                >
                                    {item.answer}
                                </motion.div>
                            </motion.div>
                        </motion.div>
                    )
                })}
            </div>
        </MotionConfig>
    )
}

const container: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    width: 600,
    gap: 8,
    fontFamily: "monospace",
}

const accordionItem: React.CSSProperties = {
    overflow: "hidden",
}

const button: React.CSSProperties = {
    width: "100%",
    padding: "16px 20px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    background: "var(--layer)",
    color: "var(--white)",
    border: "none",
    cursor: "pointer",
    fontFamily: "monospace",
    fontSize: 14,
    textAlign: "left",
}

const question: React.CSSProperties = {
    flex: 1,
    fontWeight: 500,
}

const icon: React.CSSProperties = {
    fontSize: 20,
    fontWeight: 300,
    color: "#666",
    marginLeft: 16,
}

const answerContainer: React.CSSProperties = {
    overflow: "hidden",
}

const answer: React.CSSProperties = {
    padding: "0 20px 16px 20px",
    fontSize: 14,
    lineHeight: 1.6,
    color: "#eee",
    fontFamily: "monospace",
    paddingTop: 20,
}

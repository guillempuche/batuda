import { motion, MotionProps } from "motion/react"
import * as React from "react"
import { useMemo } from "react"

const MotionFragment = motion.create(React.Fragment)

export interface AnimateTextProps {
    children: string
    splitBy?: string
    charClass?: string
    wordClass?: string
    lineClass?: string
    type?: "char" | "word" | "line"
    variants?: MotionProps["variants"]
}

function splitText(
    text: string,
    {
        splitBy = " ",
        charClass = "split-char",
        wordClass = "split-word",
        variants,
        type,
    }: {
        splitBy?: string
        charClass?: string
        wordClass?: string
        variants?: MotionProps["variants"]
        type?: "char" | "word" | "line"
    } = {}
) {
    const words = text.split(splitBy)
    const elements: React.ReactNode[] = []
    const delimiter = splitBy === " " ? "\u00A0" : splitBy

    for (let wordIndex = 0; wordIndex < words.length; wordIndex++) {
        const word = words[wordIndex]
        const characterElements: React.ReactNode[] = []
        const chars = Array.from(word)
        for (let charIndex = 0; charIndex < chars.length; charIndex++) {
            let char = chars[charIndex]

            if (
                wordIndex < words.length - 1 &&
                charIndex === chars.length - 1
            ) {
                char += delimiter
            }

            const Component = type === "char" ? motion.span : "span"

            characterElements.push(
                <Component
                    key={`${wordIndex}-${charIndex}`}
                    className={`${charClass} ${charClass}-${charIndex + 1}`}
                    style={{ display: "inline-block" }}
                    {...(type === "char" ? { variants } : {})}
                >
                    {char}
                </Component>
            )
        }

        const WordComponent = type === "word" ? motion.span : "span"
        elements.push(
            <WordComponent
                key={`word-${wordIndex}`}
                className={`${wordClass} ${wordClass}-${wordIndex + 1}`}
                style={{ display: "inline-block" }}
                {...(type === "word" ? { variants } : {})}
            >
                {characterElements}
            </WordComponent>
        )
    }

    return elements
}

export function AnimateText({
    children,
    splitBy = " ",
    charClass = "split-char",
    wordClass = "split-word",
    lineClass = "split-line",
    type = "char",
    variants,
    ...props
}: AnimateTextProps) {
    const elements = useMemo(() => {
        return splitText(children, {
            splitBy,
            charClass,
            wordClass,
            variants,
            type,
        })
    }, [children, splitBy, charClass, wordClass])

    return <MotionFragment {...props}>{elements}</MotionFragment>
}

"use client"

import { splitText } from "motion-plus-dom"
import { useEffect, useRef, useState } from "react"

export default function SplitText() {
    const wordRef = useRef<HTMLDivElement>(null)
    const rightAlignRef = useRef<HTMLDivElement>(null)
    const justifyAlignRef = useRef<HTMLDivElement>(null)
    const wordDelimiterRef = useRef<HTMLDivElement>(null)

    const [isSplit, setSplitText] = useState(false)

    useEffect(() => {
        document.documentElement.lang = "de"
        return () => {
            document.documentElement.lang = "en"
        }
    }, [])

    useEffect(() => {
        if (!isSplit) return

        if (wordRef.current) {
            // preserveHyphens=true, soft hyphens work
            splitText(wordRef.current, { preserveHyphens: true })
        }
        if (rightAlignRef.current) {
            // Default: preserveHyphens=false, soft hyphens are split into chars
            splitText(rightAlignRef.current)
        }
        if (wordDelimiterRef.current) {
            splitText(wordDelimiterRef.current, {
                splitBy: "+",
            })
        }
    }, [isSplit])

    return (
        <div style={{ hyphens: "auto" }}>
            <button id="split" onClick={() => setSplitText(true)}>
                Split text
            </button>
            <div>
                <h2>Split by word</h2>
                <div
                    ref={wordRef}
                    data-testid="split-text"
                    style={{
                        maxWidth: "400px",
                        fontSize: "24px",
                        lineHeight: "28px",
                    }}
                >
                    Hello world, 😅 this is an example of splitting text word by
                    word and line by line with one very long German word:
                    Aufmerksamkeitshyperaktivitätsstörung. 
                    
                    Also same with a shytag:
                    Aufmerksamkeitshyper&shy;aktivitätsstörung
                </div>
            </div>

            <div>
                <h2>Right align</h2>
                <div
                    ref={rightAlignRef}
                    data-testid="split-text-right"
                    style={{
                        maxWidth: "400px",
                        fontSize: "24px",
                        lineHeight: "28px",
                        textAlign: "right",
                    }}
                >
                    Hello world, 😅 this{" "}
                    <a href="#">is an example of splitting</a> text word by word
                    and char by char. This also includes a very long word but you wont 
                    see any hyphens on this one after splitting because its splitted char by char: 
                    Aufmerksamkeitshyperaktivitätsstörung
                </div>
            </div>

            <div>
                <h2>Justify align</h2>
                <div
                    ref={justifyAlignRef}
                    data-testid="split-text-right"
                    style={{
                        maxWidth: "400px",
                        fontSize: "24px",
                        lineHeight: "28px",
                        textAlign: "justify",
                    }}
                >
                    Hello world, 😅 this{" "}
                    <a href="#">is an example of splitting</a> text word by word
                    and line by line
                </div>
            </div>

            <div>
                <h2>Split by custom word delimiter</h2>
                <div
                    ref={wordDelimiterRef}
                    data-testid="split-text-custom"
                    style={{
                        maxWidth: "400px",
                        fontSize: "16px",
                        lineHeight: "24px",
                    }}
                >
                    Hello+world,+this+is+an+example+of+splitting+text+by+custom+delimiter
                </div>
            </div>
        </div>
    )
}

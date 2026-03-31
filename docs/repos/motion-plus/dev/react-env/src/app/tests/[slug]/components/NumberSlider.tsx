"use client"

import * as Slider from "@radix-ui/react-slider"
import { AnimateNumber } from "motion-plus/react"
import { useState } from "react"

export default function NumberSlider({
    min = 0,
    max = 100,
    initialValue = 50,
}) {
    const [value, setValue] = useState([initialValue])

    return (
        <form>
            <Slider.Root
                className="slider"
                onValueChange={setValue}
                defaultValue={[50]}
                min={min}
                max={max}
                step={1}
            >
                <Slider.Track className="track">
                    <Slider.Range className="range" />
                </Slider.Track>
                <Slider.Thumb className="thumb" aria-label="Volume">
                    {value?.[0] != null && (
                        <div className="thumb-text-container">
                            <AnimateNumber
                                transition={{ duration: 0.2, ease: "easeOut" }}
                                locales="en-US"
                                className="thumb-text"
                            >
                                {value[0]}
                            </AnimateNumber>
                        </div>
                    )}
                </Slider.Thumb>
            </Slider.Root>
            <StyleSheet />
        </form>
    )
}

/**
 * ==============   Styles   ================
 */

function StyleSheet() {
    return (
        <style>{`
        .slider {
            position: relative;
            display: flex;
            align-items: center;
            user-select: none;
            touch-action: none;
            width: 200px;
            height: 20px;
        }

        .track {
            background-color: var(--layer);
            position: relative;
            flex-grow: 1;
            border-radius: 9999px;
            height: 3px;
        }

        .range {
            position: absolute;
            background-color: var(--white);
            border-radius: 9999px;
            height: 100%;
        }

        .thumb {
            display: block;
            width: 20px;
            height: 20px;
            background-color: var(--white);
            box-shadow: 0 2px 10px var(--hue-3);
            border-radius: 10px;
        }
            
        .thumb:focus {
            outline: none;
            box-shadow: 0 0 0 2px var(--hue-3);
        }

        .thumb-text-container {
            position: absolute;
            top: calc(-100% - 12px);
            left: 50%;
            width: 1px;
            display: flex;
            align-items: center;
            justify-content: center;

        }

        .thumb-text {
            background-color: var(--hue-3);
            color: var(--white);
            padding: 2px 4px;
            border-radius: 4px;
        }
    `}</style>
    )
}

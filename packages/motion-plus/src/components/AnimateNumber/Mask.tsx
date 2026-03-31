import { PropsWithChildren } from "react"

// Build the mask for the numbers. Technique taken from:
// https://expensive.toys/blog/blur-vignette
export const maskHeight = "var(--mask-height, 0.15em)"
const maskWidth = "var(--mask-width, 0.5em)"
const cornerGradient = `#000 0, transparent 71%` // or transparent ${maskWidth}
const mask =
    // Horizontal:
    `linear-gradient(to right, transparent 0, #000 ${maskWidth}, #000 calc(100% - ${maskWidth}), transparent),` +
    // Vertical:
    `linear-gradient(to bottom, transparent 0, #000 ${maskHeight}, #000 calc(100% - ${maskHeight}), transparent 100%),` +
    // TL corner
    `radial-gradient(at bottom right, ${cornerGradient}),` +
    // TR corner
    `radial-gradient(at bottom left, ${cornerGradient}), ` +
    // BR corner
    `radial-gradient(at top left, ${cornerGradient}), ` +
    // BL corner
    `radial-gradient(at top right, ${cornerGradient})`

const maskSize =
    `100% calc(100% - ${maskHeight} * 2),` +
    `calc(100% - ${maskWidth} * 2) 100%,` +
    `${maskWidth} ${maskHeight},` +
    `${maskWidth} ${maskHeight},` +
    `${maskWidth} ${maskHeight},` +
    `${maskWidth} ${maskHeight}`

export function Mask({ children }: PropsWithChildren) {
    return (
        <span
            aria-hidden={true}
            style={
                {
                    display: "inline-flex",
                    margin: `0 calc(-1*${maskWidth})`,
                    padding: `calc(${maskHeight}/2) ${maskWidth}`,
                    position: "relative", // for zIndex
                    zIndex: -1, // should be underneath everything else
                    overflow: "clip", // important so it doesn't affect page layout
                    // Prefixed properties have better support than unprefixed ones:
                    WebkitMaskImage: mask,
                    WebkitMaskSize: maskSize,
                    WebkitMaskPosition:
                        "center, center, top left, top right, bottom right, bottom left",
                    WebkitMaskRepeat: "no-repeat",
                } as any
            }
        >
            {children}
        </span>
    )
}

import { Point, SpringOptions } from "motion/react"

export type CursorProps = {
    follow?: boolean
    center?: Point
    offset?: Point
    spring?: false | SpringOptions
    magnetic?: boolean | Partial<MagneticOptions>
    matchTextSize?: boolean
}

export type MagneticOptions = {
    morph: boolean
    padding: number
    snap: number
}

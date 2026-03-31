import { CursorSizeOptions, getCursorSize } from "../get-cursor-size"
import { CursorState } from "../hooks/use-cursor-state/types"
import { MagneticOptions } from "../types"

const defaultState: CursorState = {
    type: "pointer",
    isPressed: false,
    fontSize: null,
    targetBoundingBox: null,
    target: null,
    zone: null,
}

const defaultMagneticOptions: MagneticOptions = {
    morph: true,
    padding: 0,
    snap: 0.8,
}

function getSize(options: Partial<CursorSizeOptions> = {}) {
    return getCursorSize({
        hasChildren: false,
        type: "default",
        state: defaultState,
        isMagnetic: false,
        magneticOptions: defaultMagneticOptions,
        matchTextSize: true,
        ...options,
    })
}

describe("getCursorSize", () => {
    it("returns auto size when hasChildren is true", () => {
        const { width, height } = getSize({ hasChildren: true })

        expect(width).toBe("auto")
        expect(height).toBe("auto")
    })

    it("returns width and height of target when magnetic and type is pointer", () => {
        const { width, height } = getSize({
            type: "pointer",
            isMagnetic: true,
            state: {
                ...defaultState,
                targetBoundingBox: {
                    width: 100,
                    height: 100,
                    top: 0,
                    right: 0,
                    bottom: 0,
                    left: 0,
                },
            },
        })

        expect(width).toBe(100)
        expect(height).toBe(100)
    })

    it("returns width and height of target when magnetic and type is pointer, even with children", () => {
        const { width, height } = getSize({
            type: "pointer",
            isMagnetic: true,
            hasChildren: true,
            state: {
                ...defaultState,
                targetBoundingBox: {
                    width: 100,
                    height: 100,
                    top: 0,
                    right: 0,
                    bottom: 0,
                    left: 0,
                },
            },
        })

        expect(width).toBe(100)
        expect(height).toBe(100)
    })

    it("adds magnetic padding", () => {
        const { width, height } = getSize({
            type: "pointer",
            isMagnetic: true,
            magneticOptions: {
                ...defaultMagneticOptions,
                padding: 10,
            },
            state: {
                ...defaultState,
                targetBoundingBox: {
                    width: 100,
                    height: 100,
                    top: 0,
                    right: 0,
                    bottom: 0,
                    left: 0,
                },
            },
        })

        expect(width).toBe(120)
        expect(height).toBe(120)
    })

    it("returns default pointer size width/height when isMagnetic is false", () => {
        const { width, height } = getSize({
            type: "pointer",
            isMagnetic: false,
            state: {
                ...defaultState,
                targetBoundingBox: {
                    width: 100,
                    height: 100,
                    top: 0,
                    right: 0,
                    bottom: 0,
                    left: 0,
                },
            },
        })

        expect(width).toBe(31)
        expect(height).toBe(31)
    })

    it("returns auto pointer size width/height when isMagnetic is false and has children", () => {
        const { width, height } = getSize({
            type: "pointer",
            isMagnetic: false,
            hasChildren: true,
            state: {
                ...defaultState,
                targetBoundingBox: {
                    width: 100,
                    height: 100,
                    top: 0,
                    right: 0,
                    bottom: 0,
                    left: 0,
                },
            },
        })

        expect(width).toBe("auto")
        expect(height).toBe("auto")
    })

    it("returns specific width/height when provided via style, and type is pointer, not magnetic", () => {
        const { width, height } = getSize({
            type: "pointer",
            isMagnetic: false,
            style: {
                width: 100,
                height: 100,
            },
            state: {
                ...defaultState,
                targetBoundingBox: {
                    width: 100,
                    height: 100,
                    top: 0,
                    right: 0,
                    bottom: 0,
                    left: 0,
                },
            },
        })

        expect(width).toBe(100)
        expect(height).toBe(100)
    })

    it("returns text size width/height when matchTextSize is true and type is text", () => {
        const { width, height } = getSize({
            type: "text",
            style: {
                width: 100,
                height: 100,
            },
            matchTextSize: true,
            state: {
                ...defaultState,
                fontSize: 100,
            },
        })

        expect(width).toBe(4)
        expect(height).toBe(100)
    })

    it("returns specific width/height when provided via style, and type is text", () => {
        const { width, height } = getSize({
            type: "text",
            isMagnetic: false,
            style: {
                width: 100,
                height: 100,
            },
            matchTextSize: false,
        })

        expect(width).toBe(100)
        expect(height).toBe(100)
    })
})

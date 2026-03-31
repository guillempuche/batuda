// wheel.test.ts
import { fireEvent } from "@testing-library/dom"
import { wheel } from "../"

const TEST_LINE_HEIGHT = 16
const MOCK_HEIGHT = 800
const MOCK_WIDTH = 600

describe("wheel gesture recognizer", () => {
    let element: HTMLElement
    let onWheel: jest.Mock
    let onSwipe: jest.Mock

    beforeEach(() => {
        element = document.createElement("div")
        document.body.appendChild(element)
        onWheel = jest.fn()
        onSwipe = jest.fn() // Mock window dimensions for DOM_DELTA_PAGE tests
        Object.defineProperty(window, "innerHeight", {
            writable: true,
            configurable: true,
            value: MOCK_HEIGHT,
        })
        Object.defineProperty(window, "innerWidth", {
            writable: true,
            configurable: true,
            value: MOCK_WIDTH,
        })
    })

    afterEach(() => {
        document.body.removeChild(element)
    })

    it("should call onWheel with correct deltaX", () => {
        wheel(element, { axis: "x", onWheel })
        fireEvent.wheel(element, { deltaX: -10, deltaY: -5 })
        expect(onWheel).toHaveBeenCalledWith(10)
    })

    it("should call onWheel with correct deltaY", () => {
        wheel(element, { axis: "y", onWheel })
        fireEvent.wheel(element, { deltaX: -5, deltaY: -10 })
        expect(onWheel).toHaveBeenCalledWith(10)
    })

    it("should not fire onWheel when perpendicular axis magnitude is greater", () => {
        wheel(element, { axis: "x", onWheel })
        fireEvent.wheel(element, { deltaX: -5, deltaY: -10 })
        expect(onWheel).not.toHaveBeenCalled()
    })

    it("should not fire onWheel when perpendicular axis magnitude is greater for y axis", () => {
        wheel(element, { axis: "y", onWheel })
        fireEvent.wheel(element, { deltaX: -10, deltaY: -5 })
        expect(onWheel).not.toHaveBeenCalled()
    })

    it("should trigger onSwipe when threshold is exceeded", () => {
        wheel(element, { onSwipe, swipeThreshold: 50 })
        fireEvent.wheel(element, { deltaY: -30 })
        fireEvent.wheel(element, { deltaY: -30 })
        expect(onSwipe).toHaveBeenCalledWith(-1)
    })

    it("should trigger onSwipe with negative direction", () => {
        wheel(element, { onSwipe, swipeThreshold: 50 })
        fireEvent.wheel(element, { deltaY: 60 })
        expect(onSwipe).toHaveBeenCalledWith(1)
    })

    it("should not fire onWheel when an event triggers a swipe", () => {
        wheel(element, { onWheel, onSwipe, swipeThreshold: 50 })

        // This event will trigger the swipe
        fireEvent.wheel(element, { deltaY: -60 })

        expect(onSwipe).toHaveBeenCalledTimes(1)

        // With the corrected logic, onWheel is NOT called for this event
        expect(onWheel).not.toHaveBeenCalled()

        // Subsequent wheel events in the same direction should also not trigger onWheel
        fireEvent.wheel(element, { deltaY: -20 })
        expect(onWheel).not.toHaveBeenCalled()
    })

    it("should only trigger one swipe per gesture session", () => {
        wheel(element, { onSwipe, swipeThreshold: 50 })
        fireEvent.wheel(element, { deltaY: -60 }) // Swipe 1
        fireEvent.wheel(element, { deltaY: -60 }) // Should not trigger another swipe
        fireEvent.wheel(element, { deltaY: -60 })

        expect(onSwipe).toHaveBeenCalledTimes(1)
    })

    it("should resume wheeling if we recognise new input into the momentum", () => {
        wheel(element, { onWheel, onSwipe, swipeThreshold: 50 })
        fireEvent.wheel(element, { deltaY: -30 })
        fireEvent.wheel(element, { deltaY: -40 }) // Start swipe
        expect(onWheel).toHaveBeenCalledTimes(1)
        expect(onWheel).toHaveBeenCalledWith(30)
        expect(onSwipe).toHaveBeenCalledTimes(1)
        expect(onSwipe).toHaveBeenCalledWith(-1)
        fireEvent.wheel(element, { deltaY: -50 }) // Accelerate
        fireEvent.wheel(element, { deltaY: -50 })
        expect(onWheel).toHaveBeenCalledTimes(1)
        expect(onSwipe).toHaveBeenCalledTimes(1)
        fireEvent.wheel(element, { deltaY: -40 }) // Start deceleration
        expect(onWheel).toHaveBeenCalledTimes(1)
        expect(onSwipe).toHaveBeenCalledTimes(1)
        fireEvent.wheel(element, { deltaY: -10 })
        expect(onWheel).toHaveBeenCalledTimes(1)
        expect(onSwipe).toHaveBeenCalledTimes(1)
        fireEvent.wheel(element, { deltaY: -5 })
        expect(onWheel).toHaveBeenCalledTimes(1)
        expect(onSwipe).toHaveBeenCalledTimes(1)
        fireEvent.wheel(element, { deltaY: -20 })
        fireEvent.wheel(element, { deltaY: -23 })
        fireEvent.wheel(element, { deltaY: -26 }) // Start acceleration again (new touchpad input)
        expect(onWheel).toHaveBeenCalledTimes(2)
        expect(onSwipe).toHaveBeenCalledTimes(1)
    })

    it("should allow a new swipe after the session timeout", async () => {
        jest.useFakeTimers()
        wheel(element, { onSwipe, swipeThreshold: 50, swipeTimeout: 100 })

        fireEvent.wheel(element, { deltaY: -60 }) // Swipe 1
        expect(onSwipe).toHaveBeenCalledTimes(1)
        expect(onSwipe).toHaveBeenCalledWith(-1)

        // Advance time past the session timeout
        jest.advanceTimersByTime(150)

        fireEvent.wheel(element, { deltaY: 60 }) // Swipe 2
        expect(onSwipe).toHaveBeenCalledTimes(2)
        expect(onSwipe).toHaveBeenCalledWith(1)

        jest.useRealTimers()
    })

    it("should interrupt a swipe and return to wheeling on direction change", () => {
        wheel(element, { onWheel, onSwipe, swipeThreshold: 60 }) // Using 60 to be explicit

        // Trigger a swipe to the right
        fireEvent.wheel(element, { deltaY: -70 })
        expect(onSwipe).toHaveBeenCalledTimes(1)

        // Corrected assertion: onWheel should NOT have been called for the swipe event
        expect(onWheel).not.toHaveBeenCalled()

        // Immediately wheel to the left to interrupt
        fireEvent.wheel(element, { deltaY: 20 })

        // Now onWheel should be called for the first time with the interruption delta
        expect(onWheel).toHaveBeenCalledTimes(1)
        expect(onWheel).toHaveBeenLastCalledWith(-20)
    })

    it("should allow a new swipe after wheeling from direction change", () => {
        wheel(element, { onWheel, onSwipe, swipeThreshold: 50 }) // Using 60 to be explicit

        fireEvent.wheel(element, { deltaY: 40 })
        fireEvent.wheel(element, { deltaY: 20 })
        expect(onWheel).toHaveBeenCalledTimes(1)
        expect(onSwipe).toHaveBeenCalledTimes(1)

        fireEvent.wheel(element, { deltaY: -20 })
        expect(onWheel).toHaveBeenCalledTimes(2)
        expect(onSwipe).toHaveBeenCalledTimes(1)

        fireEvent.wheel(element, { deltaY: -20 })
        expect(onWheel).toHaveBeenCalledTimes(3)
        expect(onSwipe).toHaveBeenCalledTimes(1)

        fireEvent.wheel(element, { deltaY: -20 })
        expect(onWheel).toHaveBeenCalledTimes(3)
        expect(onSwipe).toHaveBeenCalledTimes(2)
    })

    it("should clean up the event listener on calling the returned function", () => {
        const stop = wheel(element, { onWheel })
        stop()
        fireEvent.wheel(element, { deltaY: -10 })
        expect(onWheel).not.toHaveBeenCalled()
    })

    it("should call onWheel with correct deltaX", () => {
        wheel(element, { axis: "x", onWheel })
        fireEvent.wheel(element, { deltaX: -10, deltaY: -5 })
        expect(onWheel).toHaveBeenCalledWith(10)
    })

    it("should call onWheel with correct deltaY", () => {
        wheel(element, { axis: "y", onWheel })
        fireEvent.wheel(element, { deltaX: -5, deltaY: -10 })
        expect(onWheel).toHaveBeenCalledWith(10)
    })

    it("should not fire onSwipe when perpendicular axis magnitude is greater", () => {
        wheel(element, { axis: "x", onSwipe, swipeThreshold: 50 })
        fireEvent.wheel(element, { deltaX: -5, deltaY: -60 })
        expect(onSwipe).not.toHaveBeenCalled()
    })

    it("should not fire onSwipe when perpendicular axis magnitude is greater for y axis", () => {
        wheel(element, { axis: "y", onSwipe, swipeThreshold: 50 })
        fireEvent.wheel(element, { deltaX: -60, deltaY: -5 })
        expect(onSwipe).not.toHaveBeenCalled()
    })

    describe("shift-wheel horizontal scroll", () => {
        it("should treat shift+wheelY as horizontal scroll when axis is y", () => {
            wheel(element, { axis: "y", onWheel })
            // User scrolls vertically (deltaY) with shift key
            fireEvent.wheel(element, {
                deltaY: -50,
                deltaX: 0,
                shiftKey: true,
            })
            // Should be interpreted as horizontal delta 50
            expect(onWheel).toHaveBeenCalledWith(50)
        })

        it("should use deltaX when shiftKey is pressed and axis is y", () => {
            wheel(element, { axis: "x", onWheel })
            // User scrolls horizontally (deltaX) with shift key
            fireEvent.wheel(element, {
                deltaY: -20,
                deltaX: 0,
                shiftKey: true,
            })
            // Should be interpreted as horizontal delta 20
            expect(onWheel).toHaveBeenCalledWith(20)
        })

        it("should use deltaY when axis is y and shift is pressed", () => {
            wheel(element, { axis: "x", onWheel })
            fireEvent.wheel(element, {
                deltaY: -50,
                deltaX: -30,
                shiftKey: true,
            })
            // Should use deltaX, resulting in 30
            expect(onWheel).toHaveBeenCalledWith(50)
        })
    })

    describe("deltaMode normalization", () => {
        it("should normalize DOM_DELTA_LINE for axis y", () => {
            wheel(element, { axis: "y", onWheel })
            fireEvent.wheel(element, {
                deltaY: -2,
                deltaMode: 1, // DOM_DELTA_LINE
            })
            // -2 lines * 16px/line = -32. Negated = 32.
            expect(onWheel).toHaveBeenCalledWith(2 * TEST_LINE_HEIGHT)
        })

        it("should normalize DOM_DELTA_LINE for axis x", () => {
            wheel(element, { axis: "x", onWheel })
            fireEvent.wheel(element, {
                deltaX: 3,
                deltaMode: 1, // DOM_DELTA_LINE
            })
            // 3 lines * 16px/line = 48. Negated = -48.
            expect(onWheel).toHaveBeenCalledWith(-3 * TEST_LINE_HEIGHT)
        })

        it("should trigger swipe with DOM_DELTA_LINE", () => {
            // 6 lines * 16px/line = 96 (not enough)
            // 7 lines * 16px/line = 112 (swipe)
            wheel(element, { axis: "y", onSwipe, swipeThreshold: 100 })
            fireEvent.wheel(element, {
                deltaY: -6,
                deltaMode: 1,
            })
            expect(onSwipe).not.toHaveBeenCalled()

            fireEvent.wheel(element, {
                deltaY: -1,
                deltaMode: 1,
            })
            // Accumulator = (6*16) + (1*16) = 112. Negated = 112.
            // Swipe direction -1
            expect(onSwipe).toHaveBeenCalledWith(-1)
        })
    })
})

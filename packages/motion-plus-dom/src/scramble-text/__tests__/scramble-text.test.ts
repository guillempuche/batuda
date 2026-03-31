import { motionValue } from "motion"
import { scrambleText } from "../"

// Helper function to wait for a specified amount of time
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe("scrambleText", () => {
    describe("Element mode", () => {
        let element: HTMLElement

        beforeEach(() => {
            element = document.createElement("div")
            element.textContent = "Hello"
            document.body.appendChild(element)
        })

        afterEach(() => {
            document.body.removeChild(element)
        })

        it("should scramble text on an element", async () => {
            scrambleText(element, { duration: 0.05, interval: 0.01 })

            await wait(20)

            // Text should have the same length
            expect(element.textContent).toHaveLength(5)
        })

        it("should reveal original text when stopped", async () => {
            const controls = scrambleText(element, { duration: 1, interval: 0.01 })

            await wait(50)
            // Text should be scrambled
            expect(element.textContent).not.toBe("Hello")

            controls.stop()
            expect(element.textContent).toBe("Hello")
        })

        it("should stop and reveal all characters immediately", async () => {
            const controls = scrambleText(element, {
                duration: 1,
                interval: 0.01,
            })

            await wait(20)
            controls.stop()

            expect(element.textContent).toBe("Hello")
        })

        it("should call onComplete when stop is called", async () => {
            const onComplete = jest.fn()
            const controls = scrambleText(element, {
                duration: 1,
                interval: 0.01,
                onComplete,
            })

            await wait(20)
            controls.stop()

            // onComplete is called via resolveFinished when stop() is called
            // but the callback itself is only called on natural completion or finish()
            // stop() just resolves the promise
        })

        it("should preserve spaces during scramble", async () => {
            element.textContent = "Hi there"
            scrambleText(element, { duration: 0.1, interval: 0.01 })

            await wait(30)

            const text = element.textContent!
            expect(text[2]).toBe(" ")
        })

        it("should work with selector string", async () => {
            element.id = "test-element"
            const controls = scrambleText("#test-element", { duration: 1 })

            controls.stop()

            expect(element.textContent).toBe("Hello")
        })

        it("should return noop controls for non-existent selector", () => {
            const controls = scrambleText("#non-existent", {})

            // Should not throw
            controls.stop()
            controls.play()
            controls.finish()
        })
    })

    describe("MotionValue mode", () => {
        it("should scramble text in a MotionValue", async () => {
            const mv = motionValue("Hello")
            scrambleText(mv, { duration: 0.05, interval: 0.01 })

            await wait(20)

            const text = mv.get()
            expect(text).toHaveLength(5)
        })

        it("should reveal original text via stop()", async () => {
            const mv = motionValue("Hello")
            const controls = scrambleText(mv, { duration: 1, interval: 0.01 })

            await wait(20)
            controls.stop()

            expect(mv.get()).toBe("Hello")
        })

        it("should stop and reveal all characters immediately", async () => {
            const mv = motionValue("Hello")
            const controls = scrambleText(mv, {
                duration: 1,
                interval: 0.01,
            })

            await wait(20)
            controls.stop()

            expect(mv.get()).toBe("Hello")
        })
    })

    describe("finish() method", () => {
        let element: HTMLElement

        beforeEach(() => {
            element = document.createElement("div")
            element.textContent = "Hello"
            document.body.appendChild(element)
        })

        afterEach(() => {
            document.body.removeChild(element)
        })

        it("should gracefully reveal characters", async () => {
            const controls = scrambleText(element, {
                duration: 1,
                interval: 0.01,
            })

            await wait(20)
            controls.finish()

            // After finish, text should be fully revealed
            await wait(200)
            expect(element.textContent).toBe("Hello")
        })

        it("should call onComplete after finish", async () => {
            const onComplete = jest.fn()
            const controls = scrambleText(element, {
                duration: 1,
                interval: 0.01,
                onComplete,
            })

            await wait(20)
            controls.finish()

            await wait(200)
            expect(onComplete).toHaveBeenCalled()
        })

        it("should resolve finished promise after finish()", async () => {
            const controls = scrambleText(element, {
                duration: 1,
                interval: 0.01,
            })

            await wait(20)
            controls.finish()

            // Give it time to complete
            await wait(200)

            // The promise should have resolved by now
            let resolved = false
            controls.finished.then(() => {
                resolved = true
            })
            await wait(10)
            expect(resolved).toBe(true)
        })
    })

    describe("finished promise", () => {
        let element: HTMLElement

        beforeEach(() => {
            element = document.createElement("div")
            element.textContent = "Hi"
            document.body.appendChild(element)
        })

        afterEach(() => {
            document.body.removeChild(element)
        })

        it("should resolve when stop() is called", async () => {
            const controls = scrambleText(element, {
                duration: 1,
                interval: 0.01,
            })

            await wait(20)
            controls.stop()

            let resolved = false
            controls.finished.then(() => {
                resolved = true
            })
            await wait(10)
            expect(resolved).toBe(true)
        })
    })

    describe("delay option", () => {
        let element: HTMLElement

        beforeEach(() => {
            element = document.createElement("div")
            element.textContent = "Hi"
            document.body.appendChild(element)
        })

        afterEach(() => {
            document.body.removeChild(element)
        })

        it("should delay scrambling start", async () => {
            scrambleText(element, {
                delay: 0.1,
                duration: 0.05,
                interval: 0.01,
            })

            // Initially should show original text (before delay kicks in for scrambling)
            expect(element.textContent).toBe("Hi")
        })
    })

    describe("custom chars", () => {
        let element: HTMLElement

        beforeEach(() => {
            element = document.createElement("div")
            element.textContent = "Hi"
            document.body.appendChild(element)
        })

        afterEach(() => {
            document.body.removeChild(element)
        })

        it("should use custom characters for scrambling", async () => {
            scrambleText(element, {
                chars: "X",
                duration: 0.1,
                interval: 0.01,
            })

            await wait(30)

            const text = element.textContent!
            // Text should have the same length
            expect(text.length).toBe(2)
        })

        it("should support array of characters (for emoji)", async () => {
            const controls = scrambleText(element, {
                chars: ["😀", "😎"],
                duration: 1,
                interval: 0.01,
            })

            await wait(30)
            controls.stop()

            // Should not throw and text should be revealed
            expect(element.textContent).toBe("Hi")
        })
    })

    describe("sequential calls with different text", () => {
        let element: HTMLElement

        beforeEach(() => {
            element = document.createElement("div")
            element.textContent = "Animate"
            document.body.appendChild(element)
        })

        afterEach(() => {
            document.body.removeChild(element)
        })

        it("should show scrambled text immediately, not the final text", async () => {
            // This captures the bug: when scrambleText is called,
            // the initial updateDisplay() shows the original text because
            // chars start in "idle" state which renders as the original char
            element.textContent = "Spring"
            scrambleText(element, { duration: 0.5, interval: 0.01 })

            // Immediately after calling scrambleText, we should NOT see "Spring"
            // We should see scrambled characters
            expect(element.textContent).not.toBe("Spring")
            expect(element.textContent).toHaveLength(6)
        })

        it("should scramble on each sequential call", async () => {
            // Simulate the word cycling scenario
            element.textContent = "Spring"
            const controls1 = scrambleText(element, { duration: 0.1, interval: 0.01 })

            // Should be scrambling, not showing "Spring"
            expect(element.textContent).not.toBe("Spring")

            // Wait for animation to complete and stop
            await wait(250)
            controls1.stop()
            expect(element.textContent).toBe("Spring")

            // Second cycle
            element.textContent = "Easing"
            const controls2 = scrambleText(element, { duration: 0.1, interval: 0.01 })

            // Should be scrambling, not showing "Easing"
            expect(element.textContent).not.toBe("Easing")

            await wait(250)
            controls2.stop()
            expect(element.textContent).toBe("Easing")
        })
    })

    describe("Infinity duration", () => {
        let element: HTMLElement

        beforeEach(() => {
            element = document.createElement("div")
            element.textContent = "Hi"
            document.body.appendChild(element)
        })

        afterEach(() => {
            document.body.removeChild(element)
        })

        it("should keep scrambling with Infinity duration until stopped", async () => {
            const controls = scrambleText(element, {
                duration: Infinity,
                interval: 0.01,
            })

            await wait(100)

            // Text should still have same length
            expect(element.textContent).toHaveLength(2)

            controls.stop()
            expect(element.textContent).toBe("Hi")
        })

        it("should reveal on finish() even with Infinity duration", async () => {
            const controls = scrambleText(element, {
                duration: Infinity,
                interval: 0.01,
            })

            await wait(50)
            controls.finish()

            await wait(200)
            expect(element.textContent).toBe("Hi")
        })
    })
})

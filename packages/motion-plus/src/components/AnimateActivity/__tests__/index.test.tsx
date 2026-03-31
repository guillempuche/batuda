import "@testing-library/jest-dom"
import { act, render, screen } from "@testing-library/react"
import { motionValue } from "motion"
import { motion, Variants } from "motion/react"
import { AnimateActivity } from ".."

// Helper to wait for the next animation frame
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve))

describe("AnimateActivity", () => {
    test("Performs initial animation when mode is 'visible'", async () => {
        const promise = new Promise<number>((resolve) => {
            const x = motionValue(0)
            const Component = () => (
                <AnimateActivity mode="visible" layoutMode="default">
                    <motion.div
                        initial={{ x: 0 }}
                        animate={{ x: 100 }}
                        style={{ x }}
                        onAnimationStart={() => {
                            // Wait two frames to check animation is in progress
                            nextFrame()
                                .then(nextFrame)
                                .then(() => {
                                    resolve(x.get())
                                })
                        }}
                    />
                </AnimateActivity>
            )
            render(<Component />)
        })

        const x = await promise
        expect(x).not.toBe(0)
        expect(x).not.toBe(100)
    })

    test("Animates out a component when mode is switched to hidden", async () => {
        const opacity = motionValue(1)
        let latestOpacity = 1

        const Component = ({ isVisible }: { isVisible: boolean }) => (
            <AnimateActivity
                mode={isVisible ? "visible" : "hidden"}
                layoutMode="default"
            >
                <motion.div
                    data-testid="child"
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.1 }}
                    style={{ opacity }}
                    onUpdate={(v) => {
                        latestOpacity = v.opacity as number
                    }}
                />
            </AnimateActivity>
        )

        const { rerender } = render(<Component isVisible />)

        await act(async () => {
            rerender(<Component isVisible={false} />)
        })

        await new Promise<void>((resolve) => {
            // Check it's animating out
            setTimeout(() => {
                expect(latestOpacity).toBeLessThan(1)
                expect(latestOpacity).toBeGreaterThan(0)
            }, 50)

            // Resolve after the animation is expected to have completed
            setTimeout(resolve, 150)
        })

        const child = screen.getByTestId("child")
        expect(child).not.toBeVisible()
        expect(child).toHaveStyle("opacity: 0")
    })

    test("Animates a component back in if mode changes to 'visible' before exit completes", async () => {
        const Component = ({ isVisible }: { isVisible: boolean }) => (
            <AnimateActivity
                mode={isVisible ? "visible" : "hidden"}
                layoutMode="default"
            >
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.1 }}
                />
            </AnimateActivity>
        )

        const { container, rerender } = render(<Component isVisible />)

        // Start exit
        rerender(<Component isVisible={false} />)

        await act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)))

        // Re-introduce component mid-exit
        rerender(<Component isVisible />)

        await act(
            () => new Promise<void>((resolve) => setTimeout(resolve, 150))
        )

        expect(container.firstChild).not.toBeNull()
        expect(container.firstChild).toHaveStyle("opacity: 1")
    })

    test("Hides a child with no exit animation", async () => {
        const Component = ({ isVisible }: { isVisible: boolean }) => (
            <AnimateActivity
                mode={isVisible ? "visible" : "hidden"}
                layoutMode="default"
            >
                <div data-testid="child">No animation</div>
            </AnimateActivity>
        )

        const { rerender } = render(<Component isVisible />)
        expect(screen.getByTestId("child")).toBeVisible()

        // The hiding happens after onExitComplete causes a state update, so we need to `act`.
        await act(async () => {
            rerender(<Component isVisible={false} />)
        })

        // The element should be hidden after the next render cycle.
        expect(screen.getByTestId("child")).not.toBeVisible()
    })

    test("Exit propagates through variants", async () => {
        const variants: Variants = {
            enter: { opacity: 1, transition: { type: false } },
            exit: { opacity: 0, transition: { type: false } },
        }
        const opacity = motionValue(1)
        let latestOpacity = 1

        const Component = ({ isVisible }: { isVisible: boolean }) => (
            <AnimateActivity
                mode={isVisible ? "visible" : "hidden"}
                layoutMode="default"
            >
                <motion.div
                    initial="enter"
                    animate="enter"
                    exit="exit"
                    variants={variants}
                >
                    <motion.div variants={variants}>
                        <motion.div
                            variants={variants}
                            style={{ opacity }}
                            onUpdate={(v) =>
                                (latestOpacity = v.opacity as number)
                            }
                        />
                    </motion.div>
                </motion.div>
            </AnimateActivity>
        )

        const { rerender } = render(<Component isVisible />)
        rerender(<Component isVisible={false} />)

        await act(nextFrame)

        expect(latestOpacity).toBe(0)
    })

    test("Allows nested exit animations", async () => {
        const opacity = motionValue(0)
        let latestOpacity = 0
        const Component = ({ isVisible }: { isVisible: boolean }) => (
            <AnimateActivity
                mode={isVisible ? "visible" : "hidden"}
                layoutMode="default"
            >
                <motion.div exit={{ x: 100 }}>
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 0.9 }}
                        style={{ opacity }}
                        exit={{ opacity: 0.1 }}
                        transition={{ type: false }}
                        onUpdate={(v) => (latestOpacity = v.opacity as number)}
                    />
                </motion.div>
            </AnimateActivity>
        )

        const { rerender } = render(<Component isVisible />)

        // Wait for initial animation to settle
        await act(() => new Promise<void>((res) => setTimeout(res, 50)))
        expect(latestOpacity).toBe(0.9)

        rerender(<Component isVisible={false} />)

        await act(nextFrame)
        expect(latestOpacity).toEqual(0.1)
    })

    test("Animates out correctly with layoutMode='pop'", async () => {
        const opacity = motionValue(1)
        let latestOpacity = 1

        const Component = ({ isVisible }: { isVisible: boolean }) => (
            <AnimateActivity
                mode={isVisible ? "visible" : "hidden"}
                layoutMode="pop"
            >
                <motion.div
                    data-testid="child"
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.1 }}
                    style={{ opacity }}
                    onUpdate={(v) => {
                        latestOpacity = v.opacity as number
                    }}
                />
            </AnimateActivity>
        )

        const { rerender } = render(<Component isVisible />)

        await act(async () => {
            rerender(<Component isVisible={false} />)
        })

        await new Promise<void>((resolve) => {
            setTimeout(() => {
                expect(latestOpacity).toBeLessThan(1)
                expect(latestOpacity).toBeGreaterThan(0)
            }, 50)

            setTimeout(resolve, 150)
        })

        const child = screen.getByTestId("child")
        expect(child).not.toBeVisible()
        expect(child).toHaveStyle("opacity: 0")
    })
})

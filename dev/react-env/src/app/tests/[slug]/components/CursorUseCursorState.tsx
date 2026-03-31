"use client"

import { useCursorState } from "motion-plus/react"

/**
 * Title: Cursor: useCursorState
 */

export default function Example() {
    const { type, isPressed } = useCursorState()

    return (
        <div style={container}>
            <p>
                Cursor: <span data-testid="cursor-type">{type}</span>
            </p>
            <p>
                Is pressed:{" "}
                <span data-testid="is-pressed">{isPressed ? "Yes" : "No"}</span>
            </p>

            <div style={targetsContainer}>
                <section>
                    <h2>
                        <pre>{`input[type="button"]`}</pre>
                    </h2>
                    <input
                        data-testid="input-button"
                        type="button"
                        value="button"
                        onChange={() => {}}
                    />
                </section>

                <section>
                    <h2>
                        <pre>{`<button>`}</pre>
                    </h2>
                    <button data-testid="button">
                        Te<span data-testid="button-span">eeeeee</span>st
                    </button>
                </section>

                <section data-cursor="text">
                    <h2>
                        <pre>{`<button> with data-cursor ancestor`}</pre>
                    </h2>
                    <button data-testid="button-data-ancestor">
                        Te<span>eeeeee</span>st
                    </button>
                </section>

                <section data-cursor="text">
                    <h2>
                        <pre>{`<button> with data-cursor`}</pre>
                    </h2>
                    <button data-cursor="text" data-testid="button-data">
                        Te<span>eeeeee</span>st
                    </button>
                </section>

                <section>
                    <h2>
                        <pre>{`<input type="text">`}</pre>
                    </h2>
                    <input
                        data-testid="input-text"
                        type="text"
                        value="test"
                        onChange={() => {}}
                    />
                </section>

                <section>
                    <h2>
                        <pre>{`<input type="text"> disabled`}</pre>
                    </h2>
                    <input
                        data-testid="input-text-disabled"
                        disabled
                        type="text"
                        value="test"
                        onChange={() => {}}
                    />
                </section>

                <section>
                    <h2>
                        <pre>{`<textarea>`}</pre>
                    </h2>
                    <textarea data-testid="textarea"></textarea>
                </section>

                <section>
                    <h2>
                        <pre>{`<textarea disabled>`}</pre>
                    </h2>
                    <textarea
                        data-testid="textarea-disabled"
                        disabled
                    ></textarea>
                </section>

                <section>
                    <h2>
                        <pre>{`<a>`}</pre>
                    </h2>
                    <a data-testid="a" href="test">
                        link
                        <div
                            style={{
                                width: 10,
                                height: 10,
                                background: "var(--hue-1)",
                            }}
                            data-testid="a-div"
                        ></div>
                    </a>
                </section>

                <section>
                    <h2>
                        <pre>{`<p>`}</pre>
                    </h2>
                    <p data-testid="p">
                        dsfhs<span>dfsk</span>dhfsd
                    </p>
                </section>

                <section>
                    <h2>
                        <pre>{`<div style={{ userSelect: "none" }}>`}</pre>
                    </h2>
                    <div style={{ userSelect: "none" }}>
                        <p data-testid="p-user-select-none">
                            dsfh<span>sdfsk</span>dhfsd
                        </p>
                    </div>
                </section>
            </div>
        </div>
    )
}

const container: React.CSSProperties = {
    display: "flex",
    width: 600,
    flexDirection: "column",
}

const targetsContainer: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
}

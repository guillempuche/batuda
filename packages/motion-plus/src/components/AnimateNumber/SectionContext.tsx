import { createContext } from "react"
import { Justify } from "./types"

export const SectionContext = /** @__PURE__ */ createContext({
    justify: "left" as Justify,
})

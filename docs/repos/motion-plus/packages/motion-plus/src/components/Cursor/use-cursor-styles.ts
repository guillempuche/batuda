import { useInsertionEffect } from "react"
import { noop } from "motion-utils"

function makeStyles() {
    const style = document.createElement("style")
    style.textContent = `
      * {
          cursor: none !important;
      }
          
      [data-motion-cursor="pointer"] {
          background-color: #333;
      }
    `

    document.head.appendChild(style)

    return () => {
        document.head.removeChild(style)
    }
}

export function useCursorStyles(isCursor: boolean) {
    useInsertionEffect(isCursor ? makeStyles : (noop as VoidFunction), [
        isCursor,
    ])
}

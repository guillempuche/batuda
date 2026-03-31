import { invariant } from "motion-utils"
import { useContext } from "react"
import { TickerItemContext, TickerItemContextType } from "./TickerItemContext"

export function useTickerItem(): TickerItemContextType {
    const itemContext = useContext(TickerItemContext)

    invariant(
        Boolean(itemContext),
        "useTickerItem must be used within a TickerItem"
    )

    return itemContext as TickerItemContextType
}

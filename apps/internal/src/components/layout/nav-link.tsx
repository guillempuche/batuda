import { Link } from '@tanstack/react-router'
import type { ComponentProps } from 'react'

/**
 * Thin wrapper around TanStack Router's `<Link>` that normalizes the
 * `exact` flag (from `nav-items.ts`) into `activeOptions.exact`, so
 * consumers don't have to hand-build the options object on every call.
 *
 * Consumers pass a render-function child that receives `{ isActive }`
 * and returns the visual representation — this keeps active-state logic
 * in one place and lets both side-nav (icon + label inline) and bottom-
 * nav (icon above label) share the same match logic.
 */
type LinkChildren = ComponentProps<typeof Link>['children']

type NavLinkProps = Omit<
	ComponentProps<typeof Link>,
	'children' | 'activeOptions'
> & {
	/**
	 * When true, only highlight this link if the current pathname is an
	 * exact match. When false or omitted, any descendant pathname counts.
	 * Typed as `boolean | undefined` explicitly so consumers can forward
	 * optional props from data definitions (e.g. `navItems`) under
	 * `exactOptionalPropertyTypes: true`.
	 */
	exact?: boolean | undefined
	children: LinkChildren
}

export function NavLink({ exact, children, ...rest }: NavLinkProps) {
	return (
		<Link {...rest} activeOptions={{ exact: Boolean(exact) }}>
			{children}
		</Link>
	)
}

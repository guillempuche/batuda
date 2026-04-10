import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import { Building2, CheckSquare, LayoutDashboard, Mail } from 'lucide-react'
import type { ComponentType } from 'react'

/**
 * Shared nav definition for both the desktop side nav and the mobile bottom
 * nav. `exact` is true for `/` so the Pipeline tab only lights up on the
 * dashboard, not on every nested route.
 *
 * Labels use `msg` from `@lingui/core/macro` so they are extracted for
 * translation catalogs. Consumers render them with `i18n._(item.label)`.
 */
export type NavItem = {
	label: MessageDescriptor
	path: string
	icon: ComponentType<{ size?: number | string }>
	exact?: boolean
}

export const navItems: ReadonlyArray<NavItem> = [
	{ label: msg`Pipeline`, path: '/', icon: LayoutDashboard, exact: true },
	{ label: msg`Companies`, path: '/companies', icon: Building2 },
	{ label: msg`Emails`, path: '/emails', icon: Mail },
	{ label: msg`Tasks`, path: '/tasks', icon: CheckSquare },
]

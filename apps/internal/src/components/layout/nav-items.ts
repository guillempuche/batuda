import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import { Building2, CheckSquare, Gauge, Mail, User } from 'lucide-react'
import type { ComponentType } from 'react'

/**
 * Shared nav definition for both the desktop side nav and the mobile bottom
 * nav. `exact` is true for `/` so the Pipeline tab only lights up on the
 * dashboard, not on every nested route.
 *
 * Labels use `msg` from `@lingui/core/macro` so they are extracted for
 * translation catalogs. Consumers render them with `i18n._(item.label)`.
 *
 * `color` is the tint used for the shadow-board tool dome cap in the
 * desktop SideNav. It's drawn from the workshop status palette so the
 * sidebar carries the same tonal language as the rest of the CRM.
 */
export type NavItem = {
	label: MessageDescriptor
	path: string
	icon: ComponentType<{ size?: number | string }>
	exact?: boolean
	color: string
}

export const navItems: ReadonlyArray<NavItem> = [
	{
		label: msg`Pipeline`,
		path: '/',
		icon: Gauge,
		exact: true,
		color: 'var(--color-status-meeting)',
	},
	{
		label: msg`Companies`,
		path: '/companies',
		icon: Building2,
		color: 'var(--color-status-client)',
	},
	{
		label: msg`Emails`,
		path: '/emails',
		icon: Mail,
		color: 'var(--color-status-contacted)',
	},
	{
		label: msg`Tasks`,
		path: '/tasks',
		icon: CheckSquare,
		color: 'var(--color-status-responded)',
	},
	{
		label: msg`Profile`,
		path: '/profile',
		icon: User,
		color: 'var(--color-status-prospect)',
	},
]

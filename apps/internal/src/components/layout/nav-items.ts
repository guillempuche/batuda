import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import {
	Building2,
	Calendar,
	CheckSquare,
	FileText,
	Gauge,
	Mail,
	User,
} from 'lucide-react'
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
	/** Locale-independent id for `data-testid` so agent-browser can target it. */
	testId: string
}

export const navItems: ReadonlyArray<NavItem> = [
	{
		label: msg`Pipeline`,
		path: '/',
		icon: Gauge,
		exact: true,
		color: 'var(--color-status-meeting)',
		testId: 'pipeline',
	},
	{
		label: msg`Companies`,
		path: '/companies',
		icon: Building2,
		color: 'var(--color-status-client)',
		testId: 'companies',
	},
	{
		label: msg`Emails`,
		path: '/emails',
		icon: Mail,
		color: 'var(--color-status-contacted)',
		testId: 'emails',
	},
	{
		label: msg`Pages`,
		path: '/pages',
		icon: FileText,
		color: 'var(--color-status-proposal)',
		testId: 'pages',
	},
	{
		label: msg`Tasks`,
		path: '/tasks',
		icon: CheckSquare,
		color: 'var(--color-status-responded)',
		testId: 'tasks',
	},
	{
		label: msg`Calendar`,
		path: '/calendar',
		icon: Calendar,
		color: 'var(--color-status-meeting)',
		testId: 'calendar',
	},
	{
		label: msg`Profile`,
		path: '/profile',
		icon: User,
		color: 'var(--color-status-prospect)',
		testId: 'profile',
	},
]

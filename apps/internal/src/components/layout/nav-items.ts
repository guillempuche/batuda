import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import {
	Building2,
	Calendar,
	CheckSquare,
	FileText,
	FileType,
	FolderOpen,
	Gauge,
	Mail,
	MessagesSquare,
	Microscope,
	Settings,
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
		label: msg`Research`,
		path: '/research',
		icon: Microscope,
		color: 'var(--color-status-prospect)',
		testId: 'research',
	},
	{
		label: msg`Emails`,
		path: '/emails',
		icon: Mail,
		color: 'var(--color-status-contacted)',
		testId: 'emails',
	},
	{
		label: msg`Documents`,
		path: '/documents',
		icon: FileType,
		color: 'var(--color-status-proposal)',
		testId: 'documents',
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
		label: msg`Settings`,
		path: '/settings',
		icon: Settings,
		color: 'var(--color-status-prospect)',
		testId: 'settings',
	},
]

/**
 * Mobile-only grouping of the nav. The desktop SideNav shows every
 * `navItems` entry in a scrollable rack, but the fixed bottom belt only
 * fits a few knobs — so on small screens the sections are folded into four
 * belt slots. A slot with a single member is a plain link (Pipeline,
 * Settings); a slot with several opens a small popover listing its members
 * (Records, Comms). Members keep the same `testId` inside the popover, so a
 * tap-through still lands on `nav-<testId>`.
 */
export type NavGroup = {
	label: MessageDescriptor
	icon: ComponentType<{ size?: number | string }>
	color: string
	testId: string
	items: ReadonlyArray<NavItem>
}

function itemByPath(path: string): NavItem {
	const found = navItems.find(entry => entry.path === path)
	if (found === undefined) {
		throw new Error(`nav-items: no nav item for path "${path}"`)
	}
	return found
}

export const navGroups: ReadonlyArray<NavGroup> = [
	{
		label: msg`Pipeline`,
		icon: Gauge,
		color: 'var(--color-status-meeting)',
		testId: 'pipeline',
		items: [itemByPath('/')],
	},
	{
		label: msg`Records`,
		icon: FolderOpen,
		color: 'var(--color-status-client)',
		testId: 'records',
		items: [
			itemByPath('/companies'),
			itemByPath('/research'),
			itemByPath('/documents'),
			itemByPath('/pages'),
		],
	},
	{
		label: msg`Comms`,
		icon: MessagesSquare,
		color: 'var(--color-status-contacted)',
		testId: 'comms',
		items: [
			itemByPath('/emails'),
			itemByPath('/calendar'),
			itemByPath('/tasks'),
		],
	},
	{
		label: msg`Settings`,
		icon: Settings,
		color: 'var(--color-status-prospect)',
		testId: 'settings',
		items: [itemByPath('/settings')],
	},
]

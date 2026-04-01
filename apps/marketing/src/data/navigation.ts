import type { LangCode } from '#/i18n'

export interface NavItem {
	to: string
	label: Record<LangCode, string>
}

export const navItems: NavItem[] = [
	{ to: '/tools', label: { ca: 'Eines', es: 'Herramientas', en: 'Tools' } },
	{
		to: '/pricing',
		label: { ca: 'Pressupost', es: 'Presupuesto', en: 'Pricing' },
	},
]

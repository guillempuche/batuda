import type { Locale } from './ca'

export const en = {
	meta: {
		title: 'Engranatge — Machines do the work',
		description:
			'We build automations, AI and micro-apps so your business runs itself.',
	},
	nav: {
		tools: 'Tools',
		projects: 'Projects',
		about: 'Workshop',
		pricing: 'Pricing',
		home: 'Home',
		solution: 'Tools',
		quote: 'Pricing',
		contact: 'Talk',
		language: 'Language',
	},
	hero: {
		headline: 'Machines do the work. You run the business.',
		subheadline: 'We build tools that work while you sleep.',
		cta: "Let's talk",
	},
	sections: {
		services: 'What we build',
		servicesLink: 'See all tools →',
		beforeAfter: 'Before and after',
		beforeLabel: 'Without Engranatge',
		afterLabel: 'With Engranatge',
		cta: "Let's talk about your business",
		ctaBody:
			"Tell us what you need and we'll tell you how we can automate it. No strings attached.",
		ctaPrimary: 'Get a quote',
		ctaSecondary: 'Write to us',
	},
	beforeAfter: {
		invoices: {
			before: '4h copying invoices by hand',
			after: '10 min, automated',
		},
		followUp: {
			before: 'Client follow-up in a spreadsheet',
			after: 'Smart reminders',
		},
		orders: {
			before: 'Orders via WhatsApp, counted by hand',
			after: 'Order system with real-time stock',
		},
	},
	tools: {
		pageTitle: 'Tools',
		pageSubtitle: 'Three types of machines for your business.',
	},
	toolDetail: {
		inputs: 'Input',
		outputs: 'Output',
		examples: 'Examples',
		cta: 'Want this tool?',
		ctaBody: "Tell us your case and we'll tell you if we can build it.",
	},
	pricing: {
		pageTitle: 'Pricing',
		pageSubtitle: 'No fine print.',
		includes: "What's included",
		excludes: "What's not included",
		contact: "Tell us what you need and we'll tell you what it costs.",
		cta: 'Get a quote',
	},
	footer: {
		tagline: 'Tools that work while you sleep.',
		madeIn: 'Made in Catalonia',
		contact: 'Contact',
		legal: 'Legal',
	},
	pageMeta: {
		home: {
			title: 'Engranatge — Machines do the work',
			description:
				'We build automations, AI and micro-apps so your business runs itself.',
		},
		automations: {
			title: 'Automations — Engranatge',
			description: 'We connect your systems so repetitive work does itself.',
		},
		'ai-agents': {
			title: 'AI Agents — Engranatge',
			description: 'Intelligent agents that work 24/7 for your business.',
		},
		about: {
			title: 'The Workshop — Engranatge',
			description: 'Who I am and why I build tools that work on their own.',
		},
		'discovery-call': {
			title: "Let's talk — Engranatge",
			description: 'Tell me about your case and we will see how I can help.',
		},
		'dept-finance': {
			title: 'Finance — Engranatge',
			description: 'Automations for finance departments.',
		},
		'dept-operations': {
			title: 'Operations — Engranatge',
			description: 'Tools to optimise day-to-day operations.',
		},
		'dept-sales': {
			title: 'Sales — Engranatge',
			description: 'Automations to accelerate your sales cycle.',
		},
		'dept-admin': {
			title: 'Administration — Engranatge',
			description: 'Tools for paperwork-free admin management.',
		},
		'dept-customer-service': {
			title: 'Customer Service — Engranatge',
			description: 'Respond faster with less effort.',
		},
		'dept-procurement': {
			title: 'Procurement — Engranatge',
			description: 'Automate purchase orders and supplier tracking.',
		},
		'dept-hr': {
			title: 'HR — Engranatge',
			description: 'Tools for HR: onboarding, payroll, time tracking.',
		},
		'dept-legal': {
			title: 'Legal — Engranatge',
			description: 'Automate contract review and compliance tracking.',
		},
		'dept-marketing': {
			title: 'Marketing — Engranatge',
			description: 'Automations for campaigns, content and analytics.',
		},
		'dept-management': {
			title: 'Management — Engranatge',
			description: 'Dashboards and alerts so nothing slips through.',
		},
		'cases-index': {
			title: 'Cases — Engranatge',
			description: 'Real examples of automations in production.',
		},
	},
} as const satisfies Locale

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
} as const satisfies Locale

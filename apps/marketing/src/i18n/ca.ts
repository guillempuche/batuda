export const ca = {
	nav: {
		tools: 'Eines',
		projects: 'Projectes',
		about: 'Taller',
		pricing: 'Pressupost',
	},
	hero: {
		headline: 'Les màquines fan la feina. Tu fas el negoci.',
		subheadline: 'Construïm eines que treballen mentre tu dorms.',
		cta: 'Parlem',
	},
	sections: {
		services: 'Què construïm',
		servicesLink: 'Veure totes les eines →',
		beforeAfter: 'Abans i després',
		beforeLabel: 'Sense Engranatge',
		afterLabel: 'Amb Engranatge',
		cta: 'Parlem del teu negoci',
		ctaBody:
			"Explica'ns què necessites i et direm com ho podem automatitzar. Sense compromís.",
		ctaPrimary: 'Demana pressupost',
		ctaSecondary: 'Escriu-nos',
	},
	beforeAfter: {
		invoices: {
			before: '4h copiant factures a mà',
			after: '10 min, automàtic',
		},
		followUp: {
			before: 'Seguiment de clients en un Excel',
			after: 'Recordatoris intel·ligents',
		},
		orders: {
			before: 'Comandes per WhatsApp, comptades a mà',
			after: 'Sistema de comandes amb estoc en temps real',
		},
	},
	tools: {
		pageTitle: 'Eines',
		pageSubtitle: 'Tres tipus de màquines per al teu negoci.',
	},
	toolDetail: {
		inputs: 'Entrada',
		outputs: 'Sortida',
		examples: 'Exemples',
		cta: 'Vols aquesta eina?',
		ctaBody: "Explica'ns el teu cas i et direm si podem construir-la.",
	},
	pricing: {
		pageTitle: 'Pressupost',
		pageSubtitle: 'Sense lletra petita.',
		includes: 'Què inclou',
		excludes: 'Què no inclou',
		contact: "Digue'ns què necessites i et direm què costa.",
		cta: 'Demana pressupost',
	},
	footer: {
		tagline: 'Eines que treballen mentre tu dorms.',
		madeIn: 'Fet a Catalunya',
		contact: 'Contacte',
		legal: 'Legal',
	},
} as const

export type Locale = typeof ca

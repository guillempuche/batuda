export const ca = {
	meta: {
		title: 'Engranatge — Les màquines fan la feina',
		description:
			'Construïm automatitzacions, IA i micro-aplicacions perquè el teu negoci treballi sol.',
	},
	nav: {
		tools: 'Eines',
		projects: 'Projectes',
		about: 'Taller',
		pricing: 'Pressupost',
		home: 'Inici',
		solution: 'Eines',
		quote: 'Preus',
		contact: 'Parla',
		language: 'Idioma',
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
	pageMeta: {
		home: {
			title: 'Engranatge — Les màquines fan la feina',
			description:
				'Construïm automatitzacions, IA i micro-aplicacions perquè el teu negoci treballi sol.',
		},
		automations: {
			title: 'Automatitzacions — Engranatge',
			description:
				'Connectem els teus sistemes perquè la feina repetitiva es faci sola.',
		},
		'ai-agents': {
			title: 'Agents IA — Engranatge',
			description: 'Agents intel·ligents que treballen 24/7 pel teu negoci.',
		},
		about: {
			title: 'El taller — Engranatge',
			description: 'Qui som i per què construïm eines que treballen soles.',
		},
		'discovery-call': {
			title: 'Parlem — Engranatge',
			description: "Explica'ns el teu cas i veurem com podem ajudar-te.",
		},
		'dept-finance': {
			title: 'Finances — Engranatge',
			description: 'Automatitzacions per a departaments de finances.',
		},
		'dept-operations': {
			title: 'Operacions — Engranatge',
			description: 'Eines per optimitzar les operacions del dia a dia.',
		},
		'dept-sales': {
			title: 'Vendes — Engranatge',
			description: 'Automatitzacions per accelerar el teu cicle de vendes.',
		},
		'dept-admin': {
			title: 'Administració — Engranatge',
			description: 'Eines per a la gestió administrativa sense feina manual.',
		},
		'dept-customer-service': {
			title: 'Atenció al client — Engranatge',
			description: 'Respon més ràpid amb menys esforç.',
		},
		'dept-procurement': {
			title: 'Compres — Engranatge',
			description: 'Automatitza les comandes i el seguiment de proveïdors.',
		},
		'dept-hr': {
			title: 'Recursos humans — Engranatge',
			description: 'Eines per a RRHH: onboarding, nòmines, fitxatge.',
		},
		'dept-legal': {
			title: 'Legal — Engranatge',
			description:
				'Automatitza la revisió de contractes i el compliment normatiu.',
		},
		'dept-marketing': {
			title: 'Màrqueting — Engranatge',
			description: 'Automatitzacions per a campanyes, contingut i anàlisi.',
		},
		'dept-management': {
			title: 'Direcció — Engranatge',
			description: "Dashboards i alertes perquè no se t'escapi res.",
		},
		'cases-index': {
			title: 'Casos — Engranatge',
			description: "Exemples reals d'automatitzacions en funcionament.",
		},
	},
} as const

/* Widens literal types in `typeof ca` so that `es` and `en` can satisfy
 * Locale without their strings having to be byte-identical to Catalan. */
type Widen<T> = T extends string
	? string
	: T extends readonly (infer U)[]
		? readonly Widen<U>[]
		: T extends object
			? { [K in keyof T]: Widen<T[K]> }
			: T

export type Locale = Widen<typeof ca>

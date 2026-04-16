import type { Locale } from './ca'

export const es = {
	meta: {
		title: 'Engranatge — Las máquinas hacen el trabajo',
		description:
			'Construimos automatizaciones, IA y micro-aplicaciones para que tu negocio trabaje solo.',
	},
	nav: {
		tools: 'Herramientas',
		projects: 'Proyectos',
		about: 'Taller',
		pricing: 'Presupuesto',
		home: 'Inicio',
		solution: 'Herramientas',
		quote: 'Precios',
		contact: 'Habla',
		language: 'Idioma',
	},
	hero: {
		headline: 'Las máquinas hacen el trabajo. Tú haces el negocio.',
		subheadline: 'Construimos herramientas que trabajan mientras duermes.',
		cta: 'Hablemos',
	},
	sections: {
		services: 'Qué construimos',
		servicesLink: 'Ver todas las herramientas →',
		beforeAfter: 'Antes y después',
		beforeLabel: 'Sin Engranatge',
		afterLabel: 'Con Engranatge',
		cta: 'Hablemos de tu negocio',
		ctaBody:
			'Cuéntanos qué necesitas y te diremos cómo podemos automatizarlo. Sin compromiso.',
		ctaPrimary: 'Pide presupuesto',
		ctaSecondary: 'Escríbenos',
	},
	beforeAfter: {
		invoices: {
			before: '4h copiando facturas a mano',
			after: '10 min, automático',
		},
		followUp: {
			before: 'Seguimiento de clientes en un Excel',
			after: 'Recordatorios inteligentes',
		},
		orders: {
			before: 'Pedidos por WhatsApp, contados a mano',
			after: 'Sistema de pedidos con stock en tiempo real',
		},
	},
	tools: {
		pageTitle: 'Herramientas',
		pageSubtitle: 'Tres tipos de máquinas para tu negocio.',
	},
	toolDetail: {
		inputs: 'Entrada',
		outputs: 'Salida',
		examples: 'Ejemplos',
		cta: '¿Quieres esta herramienta?',
		ctaBody: 'Cuéntanos tu caso y te diremos si podemos construirla.',
	},
	pricing: {
		pageTitle: 'Presupuesto',
		pageSubtitle: 'Sin letra pequeña.',
		includes: 'Qué incluye',
		excludes: 'Qué no incluye',
		contact: 'Dinos qué necesitas y te diremos cuánto cuesta.',
		cta: 'Pide presupuesto',
	},
	footer: {
		tagline: 'Herramientas que trabajan mientras duermes.',
		madeIn: 'Hecho en Cataluña',
		contact: 'Contacto',
		legal: 'Legal',
	},
	pageMeta: {
		home: {
			title: 'Engranatge — Las máquinas hacen el trabajo',
			description:
				'Construimos automatizaciones, IA y micro-aplicaciones para que tu negocio trabaje solo.',
		},
		automations: {
			title: 'Automatizaciones — Engranatge',
			description:
				'Conectamos tus sistemas para que el trabajo repetitivo se haga solo.',
		},
		'ai-agents': {
			title: 'Agentes IA — Engranatge',
			description: 'Agentes inteligentes que trabajan 24/7 para tu negocio.',
		},
		about: {
			title: 'El taller — Engranatge',
			description:
				'Quién soy y por qué construyo herramientas que trabajan solas.',
		},
		'discovery-call': {
			title: 'Hablemos — Engranatge',
			description: 'Cuéntame tu caso y veremos cómo puedo ayudarte.',
		},
		'dept-finance': {
			title: 'Finanzas — Engranatge',
			description: 'Automatizaciones para departamentos de finanzas.',
		},
		'dept-operations': {
			title: 'Operaciones — Engranatge',
			description: 'Herramientas para optimizar las operaciones del día a día.',
		},
		'dept-sales': {
			title: 'Ventas — Engranatge',
			description: 'Automatizaciones para acelerar tu ciclo de ventas.',
		},
		'dept-admin': {
			title: 'Administración — Engranatge',
			description: 'Herramientas para la gestión administrativa sin papeleo.',
		},
		'dept-customer-service': {
			title: 'Atención al cliente — Engranatge',
			description: 'Responde más rápido con menos esfuerzo.',
		},
		'dept-procurement': {
			title: 'Compras — Engranatge',
			description: 'Automatiza los pedidos y el seguimiento de proveedores.',
		},
		'dept-hr': {
			title: 'Recursos humanos — Engranatge',
			description: 'Herramientas para RRHH: onboarding, nóminas, fichaje.',
		},
		'dept-legal': {
			title: 'Legal — Engranatge',
			description:
				'Automatiza la revisión de contratos y el cumplimiento normativo.',
		},
		'dept-marketing': {
			title: 'Marketing — Engranatge',
			description: 'Automatizaciones para campañas, contenido y analítica.',
		},
		'dept-management': {
			title: 'Dirección — Engranatge',
			description: 'Dashboards y alertas para que no se te escape nada.',
		},
		'cases-index': {
			title: 'Casos — Engranatge',
			description: 'Ejemplos reales de automatizaciones en producción.',
		},
	},
} as const satisfies Locale

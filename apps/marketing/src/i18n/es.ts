import type { Locale } from './ca'

export const es = {
	nav: {
		tools: 'Herramientas',
		projects: 'Proyectos',
		about: 'Taller',
		pricing: 'Presupuesto',
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
} as const satisfies Locale

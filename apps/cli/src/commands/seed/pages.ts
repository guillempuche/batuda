import { Effect } from 'effect'

import { normalizeRows, type SeedCtx } from './shared'

export const seedPages = (
	{ sql, stamp }: SeedCtx,
	companyMap: Map<string, string>,
) =>
	Effect.gen(function* () {
		yield* Effect.logInfo('Seeding pages...')
		const pageRows = [
			{
				companyId: companyMap.get('cal-pep-fonda'),
				slug: 'cal-pep-reserves',
				lang: 'en',
				title: 'Online Booking — Cal Pep Fonda',
				status: 'published',
				template: 'product-pitch',
				content: JSON.stringify({
					type: 'doc',
					content: [
						{
							type: 'hero',
							attrs: {
								heading: 'Online Booking for Cal Pep Fonda',
								subheading:
									'Manage your reservations from your phone — no more phone calls.',
								cta: { label: 'Get started', action: '/contact' },
							},
						},
						{
							type: 'valueProps',
							attrs: {
								heading: 'Why online booking?',
								items: [
									{
										title: 'Real-time calendar',
										body: 'Guests pick their own slot — no back-and-forth calls.',
									},
									{
										title: 'Automatic SMS reminders',
										body: 'Reduce no-shows with timely reminders.',
									},
									{
										title: 'Google Maps integration',
										body: 'Guests find you and book in one tap.',
									},
								],
							},
						},
						{
							type: 'cta',
							attrs: {
								heading: 'Ready to get started?',
								body: 'Book a free 15-minute call and we will show you how it works.',
								buttons: [
									{
										label: 'Get started',
										action: 'link',
										url: '/contact',
									},
								],
							},
						},
					],
				}),
				meta: JSON.stringify({
					ogTitle: 'Online Booking — Cal Pep Fonda',
					ogDescription: 'Online reservation system for your restaurant.',
				}),
				publishedAt: new Date('2026-03-01'),
				viewCount: 47,
			},
			{
				companyId: companyMap.get('cal-pep-fonda'),
				slug: 'cal-pep-reserves',
				lang: 'ca',
				title: 'Reserves Online — Cal Pep Fonda',
				status: 'published',
				template: 'product-pitch',
				content: JSON.stringify({
					type: 'doc',
					content: [
						{
							type: 'hero',
							attrs: {
								heading: 'Reserves Online per Cal Pep Fonda',
								subheading:
									'Gestiona les teves reserves des del mòbil, sense trucades.',
								cta: { label: 'Comença ara', action: '/contacte' },
							},
						},
						{
							type: 'valueProps',
							attrs: {
								heading: 'Per què reserves online?',
								items: [
									{
										title: 'Calendari en temps real',
										body: 'Els clients trien la seva hora sense trucades.',
									},
									{
										title: 'Recordatoris automàtics per SMS',
										body: 'Redueix les absències amb recordatoris.',
									},
									{
										title: 'Integració amb Google Maps',
										body: 'Et troben i reserven amb un sol toc.',
									},
								],
							},
						},
						{
							type: 'cta',
							attrs: {
								heading: 'Vols començar?',
								body: 'Reserva una trucada gratuïta de 15 minuts.',
								buttons: [
									{
										label: 'Comença ara',
										action: 'link',
										url: '/contacte',
									},
								],
							},
						},
					],
				}),
				meta: JSON.stringify({
					ogTitle: 'Reserves Online — Cal Pep Fonda',
					ogDescription: 'Sistema de reserves online per al teu restaurant.',
				}),
				publishedAt: new Date('2026-03-01'),
				viewCount: 23,
			},
			{
				companyId: companyMap.get('cal-pep-fonda'),
				slug: 'cal-pep-reserves',
				lang: 'es',
				title: 'Reservas Online — Cal Pep Fonda',
				status: 'published',
				template: 'product-pitch',
				content: JSON.stringify({
					type: 'doc',
					content: [
						{
							type: 'hero',
							attrs: {
								heading: 'Reservas Online para Cal Pep Fonda',
								subheading:
									'Gestiona tus reservas desde el móvil, sin llamadas.',
								cta: { label: 'Empieza ahora', action: '/contacto' },
							},
						},
						{
							type: 'valueProps',
							attrs: {
								heading: '¿Por qué reservas online?',
								items: [
									{
										title: 'Calendario en tiempo real',
										body: 'Los clientes eligen su hora sin llamar.',
									},
									{
										title: 'Recordatorios automáticos por SMS',
										body: 'Reduce las ausencias con recordatorios.',
									},
									{
										title: 'Integración con Google Maps',
										body: 'Te encuentran y reservan con un solo toque.',
									},
								],
							},
						},
						{
							type: 'cta',
							attrs: {
								heading: '¿Quieres empezar?',
								body: 'Reserva una llamada gratuita de 15 minutos.',
								buttons: [
									{
										label: 'Empieza ahora',
										action: 'link',
										url: '/contacto',
									},
								],
							},
						},
					],
				}),
				meta: JSON.stringify({
					ogTitle: 'Reservas Online — Cal Pep Fonda',
					ogDescription: 'Sistema de reservas online para tu restaurante.',
				}),
				publishedAt: new Date('2026-03-01'),
				viewCount: 12,
			},
			{
				companyId: null,
				slug: 'industrial-automation',
				lang: 'en',
				title: 'Automation for Industry',
				status: 'draft',
				template: 'landing',
				content: JSON.stringify({
					type: 'doc',
					content: [
						{
							type: 'hero',
							attrs: {
								heading: 'Automate your factory',
								subheading:
									'Reduce errors and save time with intelligent workflows.',
								cta: { label: 'Talk to us', action: '/contact' },
							},
						},
						{
							type: 'valueProps',
							attrs: {
								heading: 'What we automate',
								items: [
									{
										title: 'Automated invoicing',
										body: 'Generate and send invoices without lifting a finger.',
									},
									{
										title: 'Real-time stock control',
										body: 'Know what you have before you need it.',
									},
									{
										title: 'Existing ERP integration',
										body: 'Plug into SAP, Odoo, or whatever you already run.',
									},
								],
							},
						},
					],
				}),
				meta: JSON.stringify({
					ogTitle: 'Industrial Automation',
					ogDescription: 'Automation solutions for industrial companies.',
				}),
				publishedAt: null,
				viewCount: 0,
			},
			{
				companyId: companyMap.get('cal-pep-fonda'),
				slug: 'case-study-cal-pep',
				lang: 'en',
				title: 'Case Study: How Cal Pep Fonda Cut No-Shows by 40%',
				status: 'published',
				template: 'case-study',
				content: JSON.stringify({
					type: 'doc',
					content: [
						{
							type: 'hero',
							attrs: {
								heading: 'Cal Pep Fonda: 40% fewer no-shows',
								subheading:
									"A Vilanova restaurant's journey to online booking.",
								cta: { label: 'See how', action: '#results' },
							},
						},
						{
							type: 'richText',
							content: [
								{
									type: 'paragraph',
									content: [
										{
											type: 'text',
											text: 'Cal Pep Fonda had a problem familiar to many Catalan restaurants: phone-only reservations, lost weekend clients, and no way to send reminders. After implementing our Web Starter + Booking system, no-shows dropped by 40% in the first month.',
										},
									],
								},
							],
						},
						{
							type: 'proof',
							attrs: {
								heading: 'Results',
								metrics: [
									{
										label: 'No-show rate before',
										humanValue: '15',
										machineValue: '0.15',
										unit: '%',
									},
									{
										label: 'No-show rate after',
										humanValue: '9',
										machineValue: '0.09',
										unit: '%',
									},
									{
										label: 'ROI',
										humanValue: '6',
										machineValue: '6',
										unit: 'weeks',
									},
								],
							},
						},
						{
							type: 'socialProof',
							attrs: {
								heading: 'What Pep says',
								testimonials: [
									{
										quote:
											'Now I can focus on cooking instead of answering the phone.',
										author: 'Pep Casals',
										company: 'Cal Pep Fonda',
									},
								],
							},
						},
						{
							type: 'cta',
							attrs: {
								heading: 'Want the same for your restaurant?',
								body: 'Book a free discovery call and let us show you.',
								buttons: [
									{
										label: 'See how we can help',
										action: 'link',
										url: '/contact',
									},
								],
							},
						},
					],
				}),
				meta: JSON.stringify({
					ogTitle: 'Case Study: Cal Pep Fonda — 40% fewer no-shows',
					ogDescription:
						'How a Vilanova restaurant switched to online booking and cut no-shows by 40%.',
					ogImage: '/images/case-studies/cal-pep.jpg',
				}),
				publishedAt: new Date('2026-03-15'),
				viewCount: 12847,
			},
			{
				companyId: companyMap.get('ferros-baix-llobregat'),
				slug: 'intro-ferros-bl',
				lang: 'en',
				title: 'Introduction — Taller for Ferros BL',
				status: 'published',
				template: 'intro',
				content: JSON.stringify({
					type: 'doc',
					content: [
						{
							type: 'hero',
							attrs: {
								heading: 'Nice to meet you, Ferros Baix Llobregat',
								subheading: "Here's how we can help streamline your invoicing.",
								cta: {
									label: 'View proposal',
									action: '/proposals/ferros-bl',
								},
							},
						},
						{
							type: 'richText',
							content: [
								{
									type: 'paragraph',
									content: [
										{
											type: 'text',
											text: 'We specialise in automation for mid-size industrial companies. After speaking with Marta and Jordi, we identified that manual invoicing is costing you 2 full days every month. This page outlines our approach.',
										},
									],
								},
							],
						},
						{
							type: 'cta',
							attrs: {
								heading: 'Next step',
								body: 'Review the proposal and let us know if you have questions.',
								buttons: [
									{
										label: 'View our proposal',
										action: 'link',
										url: '/proposals/ferros-bl',
									},
								],
							},
						},
					],
				}),
				meta: JSON.stringify({
					ogTitle: 'Taller for Ferros BL',
					ogDescription:
						'Custom automation proposal for Ferros Baix Llobregat.',
				}),
				publishedAt: new Date('2026-03-20'),
				viewCount: 8,
			},
			{
				companyId: null,
				slug: 'about',
				lang: 'en',
				title: 'About Taller',
				status: 'published',
				template: 'custom',
				content: JSON.stringify({
					type: 'doc',
					content: [
						{
							type: 'hero',
							attrs: {
								heading: 'I build digital tools for small businesses',
								subheading: 'One-person workshop. Mediterranean work ethic.',
								cta: { label: "Let's talk", action: '/contact' },
							},
						},
						{
							type: 'richText',
							content: [
								{
									type: 'paragraph',
									content: [
										{
											type: 'text',
											text: 'Taller is a one-person digital workshop based in Catalonia. I help small and mid-size businesses automate their operations, get found online, and stop losing clients to manual processes.',
										},
									],
								},
							],
						},
					],
				}),
				meta: JSON.stringify({
					ogTitle: 'About Taller',
					ogDescription: 'One-person digital workshop for small businesses.',
				}),
				publishedAt: new Date('2026-01-15'),
				viewCount: 531,
			},
			{
				companyId: null,
				slug: 'about',
				lang: 'ca',
				title: 'Sobre Taller',
				status: 'published',
				template: 'custom',
				content: JSON.stringify({
					type: 'doc',
					content: [
						{
							type: 'hero',
							attrs: {
								heading: 'Construeixo eines digitals per a petits negocis',
								subheading:
									'Taller unipersonal. Ètica de treball mediterrània.',
								cta: { label: 'Parlem', action: '/contacte' },
							},
						},
						{
							type: 'richText',
							content: [
								{
									type: 'paragraph',
									content: [
										{
											type: 'text',
											text: 'Taller és un taller digital unipersonal amb seu a Catalunya. Ajudo petites i mitjanes empreses a automatitzar les seves operacions, a ser trobades online i a deixar de perdre clients per processos manuals.',
										},
									],
								},
							],
						},
					],
				}),
				meta: JSON.stringify({
					ogTitle: 'Sobre Taller',
					ogDescription: 'Taller digital unipersonal per a petits negocis.',
				}),
				publishedAt: new Date('2026-01-15'),
				viewCount: 189,
			},
			{
				companyId: null,
				slug: 'about',
				lang: 'es',
				title: 'Sobre Taller',
				status: 'published',
				template: 'custom',
				content: JSON.stringify({
					type: 'doc',
					content: [
						{
							type: 'hero',
							attrs: {
								heading:
									'Construyo herramientas digitales para pequeños negocios',
								subheading:
									'Taller unipersonal. Ética de trabajo mediterránea.',
								cta: { label: 'Hablemos', action: '/contacto' },
							},
						},
						{
							type: 'richText',
							content: [
								{
									type: 'paragraph',
									content: [
										{
											type: 'text',
											text: 'Taller es un taller digital unipersonal con sede en Cataluña. Ayudo a pequeñas y medianas empresas a automatizar sus operaciones, a ser encontradas online y a dejar de perder clientes por procesos manuales.',
										},
									],
								},
							],
						},
					],
				}),
				meta: JSON.stringify({
					ogTitle: 'Sobre Taller',
					ogDescription: 'Taller digital unipersonal para pequeños negocios.',
				}),
				publishedAt: new Date('2026-01-15'),
				viewCount: 76,
			},
			{
				companyId: null,
				slug: 'summer-promo-2025',
				lang: 'en',
				title: 'Summer 2025 Promo — 20% Off Web Starter',
				status: 'archived',
				template: 'landing',
				content: JSON.stringify({
					type: 'doc',
					content: [
						{
							type: 'hero',
							attrs: {
								heading: 'Summer special: 20% off Web Starter',
								subheading: 'Offer ended September 30, 2025.',
								cta: { label: '', action: '' },
							},
						},
					],
				}),
				meta: JSON.stringify({
					ogTitle: 'Summer 2025 Promo',
					ogDescription: 'Limited time offer — 20% off Web Starter package.',
				}),
				publishedAt: new Date('2025-07-01'),
				expiresAt: new Date('2025-09-30'),
				viewCount: 2341,
			},
			{
				companyId: null,
				slug: 'spring-launch-2026',
				lang: 'en',
				title: 'Spring 2026 Launch — Free Discovery Call',
				status: 'published',
				template: 'landing',
				content: JSON.stringify({
					type: 'doc',
					content: [
						{
							type: 'hero',
							attrs: {
								heading: 'Free 30-minute discovery call',
								subheading: 'Book before May 31st and get a free audit.',
								cta: { label: 'Book now', action: '/contact' },
							},
						},
						{
							type: 'cta',
							attrs: {
								heading: "Don't miss out",
								body: 'This offer ends May 31st, 2026.',
								buttons: [
									{ label: 'Book now', action: 'link', url: '/contact' },
								],
							},
						},
					],
				}),
				meta: JSON.stringify({
					ogTitle: 'Spring 2026 — Free Discovery Call',
					ogDescription:
						'Book a free 30-minute discovery call before May 31st.',
				}),
				publishedAt: new Date('2026-04-01'),
				expiresAt: new Date('2026-05-31'),
				viewCount: 89,
			},
			{
				companyId: companyMap.get('hostal-pirineu'),
				slug: 'hostal-pirineu-booking',
				lang: 'en',
				title: 'Direct Booking — Hostal del Pirineu',
				status: 'draft',
				template: 'product-pitch',
				content: JSON.stringify({
					type: 'doc',
					content: [
						{
							type: 'hero',
							attrs: {
								heading: 'Stop paying 18% to Booking.com',
								subheading:
									'Your own direct booking channel for under 5% cost.',
								cta: { label: 'See the demo', action: '/demo/booking' },
							},
						},
						{
							type: 'valueProps',
							attrs: {
								heading: 'What you get',
								items: [
									{
										title: 'Real-time availability calendar',
										body: 'Guests see open dates instantly.',
									},
									{
										title: 'Upfront payment via Stripe or Redsys',
										body: 'Secure payments, no chargebacks.',
									},
									{
										title: 'Multi-language: Catalan, Spanish, French',
										body: 'Reach guests in their language.',
									},
								],
							},
						},
						{
							type: 'cta',
							attrs: {
								heading: 'See it in action',
								body: 'We built a live demo with your real room types.',
								buttons: [
									{
										label: 'See the demo',
										action: 'link',
										url: '/demo/booking',
									},
								],
							},
						},
					],
				}),
				meta: JSON.stringify({
					ogTitle: 'Direct Booking — Hostal del Pirineu',
					ogDescription: 'Direct reservation system for Hostal del Pirineu.',
				}),
				publishedAt: null,
				viewCount: 0,
			},
			{
				companyId: companyMap.get('hostal-pirineu'),
				slug: 'hostal-pirineu-booking',
				lang: 'ca',
				title: 'Reserves directes — Hostal del Pirineu',
				status: 'draft',
				template: 'product-pitch',
				content: JSON.stringify({
					type: 'doc',
					content: [
						{
							type: 'hero',
							attrs: {
								heading: 'Deixa de pagar un 18% a Booking.com',
								subheading: 'El teu propi canal de reserves per menys del 5%.',
								cta: { label: 'Veure la demo', action: '/demo/booking' },
							},
						},
						{
							type: 'valueProps',
							attrs: {
								heading: 'Què obtens',
								items: [
									{
										title: 'Calendari de disponibilitat en temps real',
										body: 'Els hostes veuen les dates obertes al moment.',
									},
									{
										title: 'Pagament anticipat via Stripe o Redsys',
										body: 'Pagaments segurs, sense devolucions.',
									},
									{
										title: 'Multi-idioma: català, castellà, francès',
										body: 'Arriba als hostes en el seu idioma.',
									},
								],
							},
						},
						{
							type: 'cta',
							attrs: {
								heading: 'Mira-ho en acció',
								body: 'Hem preparat una demo amb les teves habitacions reals.',
								buttons: [
									{
										label: 'Veure la demo',
										action: 'link',
										url: '/demo/booking',
									},
								],
							},
						},
					],
				}),
				meta: JSON.stringify({
					ogTitle: 'Reserves directes — Hostal del Pirineu',
					ogDescription:
						'Sistema de reserves directes per a Hostal del Pirineu.',
				}),
				publishedAt: null,
				viewCount: 0,
			},
		]
		yield* sql`INSERT INTO pages ${sql.insert(normalizeRows(stamp(pageRows)))}`
	})

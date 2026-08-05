/** biome-ignore-all lint/style/noNonNullAssertion: seed data */

import { type Preset, SEED_REFERENCE } from './shared'

export const DEMO_ORGS = [
	{ slug: 'taller', name: 'Taller Demo' },
	{ slug: 'restaurant', name: 'Restaurant Demo' },
] as const

const PRIMARY_DEMO_USER = {
	email: 'admin@taller.cat',
	password: 'batuda-dev-2026',
	name: 'Alice Admin',
	role: 'admin',
} as const

export const DEMO_USERS = [
	PRIMARY_DEMO_USER,
	{
		email: 'colleague@taller.cat',
		password: 'batuda-dev-2026',
		name: 'Carol Colleague',
		role: 'user',
	},
	{
		email: 'admin@restaurant.demo',
		password: 'batuda-dev-2026',
		name: 'Bob Owner',
		role: 'admin',
	},
	{
		email: 'boss@batuda.dev',
		password: 'batuda-dev-2026',
		name: 'Bea Boss',
		role: 'admin',
	},
	// `app_service` covers the superadmin-without-memberships persona.
	{
		email: 'superadmin@batuda.dev',
		password: 'batuda-dev-2026',
		name: 'Sam Superadmin',
		role: 'app_service',
	},
] as const

export const DEMO_MEMBERSHIPS = [
	{ email: 'admin@taller.cat', orgSlug: 'taller', role: 'owner' },
	{ email: 'colleague@taller.cat', orgSlug: 'taller', role: 'member' },
	{ email: 'admin@restaurant.demo', orgSlug: 'restaurant', role: 'owner' },
	// Alice spans both orgs so multi-org switching has data to exercise.
	{ email: 'admin@taller.cat', orgSlug: 'restaurant', role: 'member' },
	{ email: 'boss@batuda.dev', orgSlug: 'taller', role: 'admin' },
	{ email: 'boss@batuda.dev', orgSlug: 'restaurant', role: 'admin' },
] as const

export const TEST_USER = PRIMARY_DEMO_USER

export const PRODUCTS = [
	{
		slug: 'web-starter',
		name: 'Web Starter',
		type: 'service',
		status: 'active',
		description:
			'Lloc web professional amb SEO local i mòbil-first per a petits negocis.',
		defaultPrice: '990.00',
		priceType: 'fixed',
	},
	{
		slug: 'gestio-reserves',
		name: 'Gestió de Reserves',
		type: 'service',
		status: 'active',
		description:
			'Sistema de reserves online amb calendari, recordatoris i pagaments.',
		defaultPrice: '49.00',
		priceType: 'monthly',
	},
	{
		slug: 'automatitzacions',
		name: 'Automatitzacions',
		type: 'service',
		status: 'active',
		description:
			'Workflows automàtics: facturació, seguiment clients, notificacions.',
		defaultPrice: '1500.00',
		priceType: 'fixed',
	},
	{
		slug: 'ecommerce-local',
		name: 'Ecommerce Local',
		type: 'product',
		status: 'beta',
		description: 'Botiga online amb enviament local i integració amb TPV.',
		defaultPrice: '2500.00',
		priceType: 'fixed',
	},
	{
		slug: 'social-media-pack',
		name: 'Social Media Pack',
		type: 'service',
		status: 'idea',
		description:
			'Gestió de xarxes socials: contingut, programació i analítica.',
		defaultPrice: '300.00',
		priceType: 'monthly',
	},
	{
		slug: 'consultoria-custom',
		name: 'Consultoria a Mida',
		type: 'service',
		status: 'active',
		description: 'Projectes de consultoria digital amb abast i preu negociats.',
		defaultPrice: null,
		priceType: 'custom',
		metadata: { requiresDiscoveryCall: true },
	},
	{
		slug: 'crm-intern',
		name: 'CRM Intern (Dogfood)',
		type: 'product',
		status: 'beta',
		description:
			'El nostre propi CRM — usat internament per validar funcionalitats.',
		defaultPrice: null,
		priceType: null,
		metadata: { internal: true },
	},
]

export const COMPANIES = [
	{
		slug: 'cal-pep-fonda',
		name: 'Cal Pep Fonda',
		status: 'client',
		industry: 'Restauració',
		sizeRange: '1-10',
		country: 'ES',
		location: 'Vilanova i la Geltrú',
		priority: 1,
		website: 'https://calpepfonda.cat',
		email: 'info@calpepfonda.cat',
		phone: '+34 938 123 456',
		instagram: '@calpepfonda',
		productsFit: ['web-starter', 'gestio-reserves'],
		tags: ['gastro', 'garraf'],
		painPoints: 'Reserves per telèfon, perden clients els caps de setmana.',
		currentTools: 'Llibreta + WhatsApp',
		// Short brief — the page shows it whole.
		accountBrief: [
			'**Cal Pep Fonda** — fonda de tota la vida a Vilanova, 12 taules.',
			'',
			'Reserven per telèfon i **perden clients** els caps de setmana, quan no hi ha ningú per despenjar.',
			'',
			'Ja són clients del web; les reserves són la segona venda.',
		].join('\n'),
		fitVerdict: 'strong_fit',
		fitChecks: JSON.stringify([
			{
				criterion: 'Perden comandes amb el mètode actual',
				result: 'pass',
				evidenceQuote: 'Els caps de setmana no donem l’abast al telèfon',
			},
			{ criterion: 'Ja ens compra alguna cosa', result: 'pass' },
			{ criterion: 'Més de deu treballadors', result: 'fail' },
			{ criterion: 'Pressupost aprovat', result: 'unknown' },
		]),
		nextAction: 'Enviar factura mensual',
		latitude: 41.2241,
		longitude: 1.7254,
		geocodedAt: SEED_REFERENCE,
		geocodeSource: 'seed',
	},
	{
		slug: 'ferros-baix-llobregat',
		name: 'Ferros Baix Llobregat',
		status: 'proposal',
		industry: 'Serralleria',
		sizeRange: '11-50',
		country: 'ES',
		location: 'Cornellà de Llobregat',
		priority: 1,
		website: 'https://ferrosbl.com',
		email: 'gerencia@ferrosbl.com',
		phone: '+34 936 555 111',
		linkedin: 'ferros-baix-llobregat',
		productsFit: ['automatitzacions'],
		tags: ['indústria', 'facturació'],
		painPoints: 'Factures manuals amb Excel, errors freqüents al tancar mes.',
		currentTools: 'Excel + Contaplus',
		// Long brief — long enough that the page has to fold it.
		accountBrief: [
			'## Qui són',
			'',
			'Serralleria industrial a Cornellà, 24 treballadors. Fan estructures metàl·liques per obra pública i tancaments per a naus.',
			'',
			'## Per què ens interessa',
			'',
			'- Tanquen el mes **a mà, amb Excel i Contaplus** — el gerent diu que hi perden dos dies cada mes.',
			'- Han mirat dues eines grans i els van semblar cares i pesades.',
			'- Tenen pressupost aprovat per digitalitzar administració aquest any.',
			'',
			'## Estat',
			'',
			'Proposta enviada. Esperant que passi per la reunió de socis.',
			'',
			'## Riscos',
			'',
			'1. Qui porta administració va muntar l’Excel actual i no ho veu clar.',
			'2. Es plantegen fer-ho ells mateixos amb un becari.',
		].join('\n'),
		fitVerdict: 'strong_fit',
		fitChecks: JSON.stringify([
			{
				criterion: 'Tanca el mes a mà',
				result: 'pass',
				evidenceQuote: 'Perdem dos dies cada mes tancant factures',
			},
			{ criterion: 'Més de deu treballadors', result: 'pass' },
			{ criterion: 'Ja té un programa de gestió', result: 'fail' },
			{ criterion: 'Pressupost aprovat', result: 'unknown' },
		]),
		nextAction: 'Presentar proposta automatització',
		latitude: 41.3526,
		longitude: 2.0715,
		geocodedAt: SEED_REFERENCE,
		geocodeSource: 'seed',
	},
	{
		slug: 'bright-lane-boutique',
		name: 'Bright Lane Boutique',
		status: 'meeting',
		industry: 'Moda i complements',
		sizeRange: '1-10',
		country: 'ES',
		location: 'Barcelona',
		priority: 2,
		email: 'hello@brightlane.cat',
		phone: '+34 938 777 222',
		instagram: '@brightlanebcn',
		productsFit: ['ecommerce-local', 'web-starter'],
		tags: ['fashion', 'barcelona'],
		painPoints: 'Want to sell online but unsure where to start.',
		currentTools: 'Instagram direct',
		nextAction: 'Schedule ecommerce demo',
		latitude: 41.3874,
		longitude: 2.1686,
		geocodedAt: SEED_REFERENCE,
		geocodeSource: 'seed',
	},
	{
		slug: 'electricitat-del-valles',
		name: 'Electricitat del Vallès',
		status: 'contacted',
		industry: 'Instal·lacions elèctriques',
		sizeRange: '11-50',
		country: 'ES',
		location: 'Terrassa',
		priority: 2,
		website: 'https://electricitatvalles.cat',
		email: 'admin@electricitatvalles.cat',
		phone: '+34 937 333 444',
		productsFit: ['automatitzacions', 'web-starter'],
		tags: ['reformes', 'vallès'],
		painPoints: 'Web desactualitzada, no surten a Google.',
		currentTools: 'Pàgina estàtica antiga',
	},
	{
		slug: 'forn-de-pa-queralt',
		name: 'Forn de Pa Queralt',
		status: 'prospect',
		industry: 'Fleca i pastisseria',
		sizeRange: '1-10',
		country: 'ES',
		location: 'Berga',
		priority: 3,
		email: 'fornqueralt@gmail.com',
		phone: '+34 938 210 567',
		instagram: '@fornqueralt',
		productsFit: ['web-starter', 'social-media-pack'],
		tags: ['obrador', 'berguedà'],
	},
	{
		slug: 'coastal-freight',
		name: 'Coastal Freight SL',
		status: 'responded',
		industry: 'Transport de mercaderies',
		sizeRange: '11-50',
		country: 'ES',
		location: 'Mataró',
		priority: 2,
		website: 'https://coastalfreight.es',
		email: 'ops@coastalfreight.es',
		phone: '+34 937 888 999',
		productsFit: ['automatitzacions'],
		tags: ['logistics', 'maresme'],
		painPoints: 'Paper-based delivery notes, hard to trace shipments.',
		currentTools: 'Paper + fax',
		nextAction: 'Follow-up call',
		latitude: 41.5388,
		longitude: 2.4449,
		geocodedAt: SEED_REFERENCE,
		geocodeSource: 'seed',
	},
	{
		slug: 'hostal-pirineu',
		name: 'Hostal del Pirineu',
		status: 'meeting',
		industry: 'Allotjament',
		sizeRange: '1-10',
		country: 'ES',
		location: 'Benasc',
		priority: 1,
		website: 'https://hostalpirineu.com',
		email: 'reserves@hostalpirineu.com',
		phone: '+34 974 551 234',
		instagram: '@hostalpirineu',
		productsFit: ['gestio-reserves', 'web-starter'],
		tags: ['turisme', 'ribagorça'],
		painPoints: 'Booking cobra comissions altes, volen canal directe.',
		currentTools: 'Booking + llibreta',
		nextAction: 'Demo sistema de reserves',
	},
	{
		slug: 'distribuciones-martinez',
		name: 'Distribuciones Martínez',
		status: 'contacted',
		industry: 'Distribució',
		sizeRange: '11-50',
		country: 'ES',
		location: 'Alzira',
		priority: 2,
		website: 'https://dismartinez.es',
		email: 'ventas@dismartinez.es',
		phone: '+34 962 441 555',
		productsFit: ['automatitzacions', 'ecommerce-local'],
		tags: ['agroalimentari', 'ribera'],
		painPoints: 'Pedidos por teléfono, hojas de ruta manuales.',
		currentTools: 'WhatsApp + Excel',
	},
	{
		slug: 'park-stone-design',
		name: 'Park & Stone Design',
		status: 'dead',
		industry: 'Disseny d’interiors',
		sizeRange: '1-10',
		country: 'ES',
		location: 'Barcelona',
		priority: 3,
		email: 'hello@parkstonedesign.com',
		instagram: '@parkstonedesign',
		productsFit: ['web-starter'],
		tags: ['design', 'barcelona'],
		painPoints: 'Already had a web provider.',
	},
	{
		slug: 'ceramiques-emporda',
		name: 'Ceràmiques Empordà',
		status: 'prospect',
		industry: 'Ceràmica',
		sizeRange: '1-10',
		country: 'ES',
		location: "La Bisbal d'Empordà",
		priority: 2,
		website: 'https://ceramiquesemporda.cat',
		email: 'taller@ceramiquesemporda.cat',
		phone: '+34 972 640 333',
		instagram: '@ceramiquesemporda',
		productsFit: ['ecommerce-local', 'web-starter'],
		tags: ['artesania', 'empordà'],
		painPoints: 'Venen només a la botiga física, volen obrir canal online.',
	},
	{
		slug: 'tancaments-garraf',
		name: 'Tancaments Garraf SL',
		status: 'closed',
		industry: 'Fusteria d’alumini',
		sizeRange: '11-50',
		country: 'ES',
		location: 'Sitges',
		priority: 1,
		website: 'https://tancamentsgarraf.cat',
		email: 'info@tancamentsgarraf.cat',
		phone: '+34 938 111 222',
		productsFit: ['automatitzacions', 'web-starter'],
		tags: ['tancaments', 'garraf'],
		painPoints: 'Gestió de projectes amb fulls de càlcul compartits.',
		currentTools: 'Google Sheets + WhatsApp',
		nextAction: 'Tancar contracte anual',
		nextActionAt: new Date('2026-03-01'),
		lastContactedAt: new Date('2026-03-28'),
		latitude: 41.2371,
		longitude: 1.811,
		geocodedAt: SEED_REFERENCE,
		geocodeSource: 'seed',
	},
	{
		slug: 'consultoria-beta',
		name: 'Consultoria Beta',
		status: 'contacted',
		industry: 'Consultoria',
		sizeRange: '1-10',
		country: 'ES',
		location: 'València',
		priority: 3,
		email: 'hola@consultoriabeta.es',
		productsFit: ['web-starter'],
		tags: ['consultoria'],
	},
	{
		slug: 'empresa-fantasma',
		name: "L'Ànec d'Or — Distribucions & Logística, S.L.",
		status: 'prospect',
		industry: 'Distribució',
		sizeRange: '51-200',
		country: 'ES',
		location: 'Manresa',
		metadata: { notes: 'Found via Maps but no contact info available yet.' },
	},
	{
		slug: 'taller-mecanic-jove',
		name: 'Taller Mecànic Jove',
		status: 'responded',
		industry: 'Taller mecànic',
		sizeRange: '1-10',
		country: 'ES',
		location: 'Granollers',
		priority: 2,
		instagram: '@tallerjove',
		productsFit: ['web-starter'],
		tags: ['automoció', 'vallès'],
		lastContactedAt: new Date('2025-09-15'),
		nextAction: 'Recontactar — 6 mesos sense resposta',
		nextActionAt: new Date('2026-03-15'),
	},
]

export const MINIMAL_COMPANY_SLUGS = new Set([
	'cal-pep-fonda',
	'ferros-baix-llobregat',
])

export const MINIMAL_CONTACT_NAMES = new Set([
	'Pep Casals',
	'Marta Soler',
	'Jordi Puig',
])

export const getPresetData = (
	preset: Preset,
	companyMap: Map<string, string>,
	contactMap: Map<string, string>,
) => {
	const allContacts = [
		{
			companyId: companyMap.get('cal-pep-fonda')!,
			name: 'Pep Casals',
			role: 'Propietari',
			buyingRole: 'economic_buyer',
			email: 'pep@calpepfonda.cat',
			phone: '+34 938 123 456',
			whatsapp: '+34 638 123 456',
		},
		{
			companyId: companyMap.get('ferros-baix-llobregat')!,
			name: 'Marta Soler',
			role: 'Directora Financera',
			buyingRole: 'economic_buyer',
			email: 'marta@ferrosbl.com',
			phone: '+34 636 555 111',
		},
		{
			companyId: companyMap.get('ferros-baix-llobregat')!,
			name: 'Jordi Puig',
			role: 'Gerent',
			buyingRole: 'economic_buyer',
			email: 'gerencia@ferrosbl.com',
			emailStatus: 'bounced',
			emailStatusReason: 'Permanent/General',
		},
		{
			companyId: companyMap.get('bright-lane-boutique')!,
			name: 'Sarah Mitchell',
			role: 'Owner',
			buyingRole: 'economic_buyer',
			email: 'hello@brightlane.cat',
			instagram: '@sarahm_bcn',
		},
		{
			companyId: companyMap.get('hostal-pirineu')!,
			name: 'Arnau Ribas',
			role: 'Director',
			buyingRole: 'economic_buyer',
			email: 'reserves@hostalpirineu.com',
			phone: '+34 674 551 234',
		},
		{
			companyId: companyMap.get('coastal-freight')!,
			name: 'Tom Parker',
			role: 'Head of Logistics',
			buyingRole: null,
			email: 'ops@coastalfreight.es',
			phone: '+34 637 888 999',
		},
		{
			companyId: companyMap.get('tancaments-garraf')!,
			name: 'Ramon Vila',
			role: 'Gerent',
			buyingRole: 'economic_buyer',
			email: 'ramon@tancamentsgarraf.cat',
			phone: '+34 938 111 222',
			emailStatus: 'valid' as const,
			emailStatusReason: 'SMTP verified',
			emailStatusUpdatedAt: new Date('2026-03-20'),
		},
		{
			companyId: companyMap.get('tancaments-garraf')!,
			name: 'Laia Ferrer',
			role: 'Administrativa',
			buyingRole: null,
			email: 'admin@tancamentsgarraf.cat',
			emailStatus: 'complained' as const,
			emailStatusReason: 'Marked as spam 2026-03-10',
			emailStatusUpdatedAt: new Date('2026-03-10'),
			emailSoftBounceCount: 0,
		},
		{
			companyId: companyMap.get('tancaments-garraf')!,
			name: 'Oriol Camps',
			role: 'Cap de projectes',
			buyingRole: null,
			email: 'oriol@tancamentsgarraf.cat',
			phone: '+34 638 111 333',
			whatsapp: '+34 638 111 333',
			emailStatus: 'bounced' as const,
			emailStatusReason: 'Mailbox full',
			emailSoftBounceCount: 5,
			emailStatusUpdatedAt: new Date('2026-04-01'),
		},
		{
			companyId: companyMap.get('empresa-fantasma')!,
			name: 'Desconegut',
			role: null,
			buyingRole: null,
		},
		{
			companyId: companyMap.get('distribuciones-martinez')!,
			name: 'Carlos Martínez',
			role: 'Director Comercial',
			buyingRole: 'economic_buyer',
			email: 'carlos@dismartinez.es',
			phone: '+34 662 441 555',
			linkedin: 'carlos-martinez-dismartinez',
			emailStatus: 'valid' as const,
			emailStatusUpdatedAt: new Date('2026-03-25'),
		},
		{
			companyId: companyMap.get('distribuciones-martinez')!,
			name: 'Ana López',
			role: 'Responsable IT',
			buyingRole: null,
			email: 'ana.lopez@dismartinez.es',
			emailStatus: 'unknown' as const,
			emailSoftBounceCount: 2,
		},
		{
			companyId: companyMap.get('taller-mecanic-jove')!,
			name: 'Marc Jove',
			role: 'Propietari',
			buyingRole: 'economic_buyer',
			instagram: '@marcjove_tallerjove',
		},
	]

	const allInteractions = [
		{
			companyId: companyMap.get('cal-pep-fonda')!,
			contactId: contactMap.get('Pep Casals'),
			date: new Date('2026-02-10'),
			channel: 'visit',
			direction: 'outbound',
			type: 'meeting',
			subject: 'Visita al restaurant',
			summary:
				'Vam visitar el Pep al restaurant. Molt interessat en reserves online.',
			outcome: 'interested',
			nextAction: 'Preparar proposta web + reserves',
		},
		{
			companyId: companyMap.get('cal-pep-fonda')!,
			contactId: contactMap.get('Pep Casals'),
			date: new Date('2026-02-20'),
			channel: 'email',
			direction: 'outbound',
			type: 'followup',
			subject: 'Proposta enviada',
			summary: 'Enviat proposta web + gestió de reserves.',
			outcome: 'proposal_requested',
		},
		{
			companyId: companyMap.get('ferros-baix-llobregat')!,
			contactId: contactMap.get('Marta Soler'),
			date: new Date('2026-03-05'),
			channel: 'linkedin',
			direction: 'outbound',
			type: 'cold',
			subject: 'Primer contacte LinkedIn',
			summary:
				'Missatge fred a Marta. Va respondre interessada en automatitzar facturació.',
			outcome: 'responded',
			nextAction: 'Programar trucada amb gerent',
		},
		{
			companyId: companyMap.get('ferros-baix-llobregat')!,
			contactId: contactMap.get('Jordi Puig'),
			date: new Date('2026-03-15'),
			durationMin: 30,
			channel: 'phone',
			direction: 'outbound',
			type: 'meeting',
			subject: 'Trucada amb gerent',
			summary:
				'Jordi explica que perden 2 dies al mes tancant factures manualment.',
			outcome: 'meeting_scheduled',
			nextAction: 'Reunió presencial a la fàbrica',
		},
		{
			companyId: companyMap.get('bright-lane-boutique')!,
			contactId: contactMap.get('Sarah Mitchell'),
			date: new Date('2026-03-20'),
			channel: 'instagram',
			direction: 'inbound',
			type: 'cold',
			subject: 'Instagram DM',
			summary: 'Sarah reached out on Instagram asking about online shops.',
			outcome: 'interested',
			nextAction: 'Schedule ecommerce demo',
		},
		{
			companyId: companyMap.get('hostal-pirineu')!,
			contactId: contactMap.get('Arnau Ribas'),
			date: new Date('2026-03-10'),
			durationMin: 45,
			channel: 'visit',
			direction: 'outbound',
			type: 'meeting',
			subject: "Visita a l'hostal",
			summary:
				'Arnau vol un sistema de reserves directe per estalviar comissions de Booking.',
			outcome: 'interested',
			nextAction: 'Preparar demo online',
		},
		{
			companyId: companyMap.get('coastal-freight')!,
			contactId: contactMap.get('Tom Parker'),
			date: new Date('2026-03-25'),
			channel: 'phone',
			direction: 'inbound',
			type: 'cold',
			subject: 'Inbound call',
			summary:
				'Tom called after finding us in a directory. Interested in digitising delivery notes.',
			outcome: 'responded',
			nextAction: 'Send automation info pack',
		},
		{
			companyId: companyMap.get('tancaments-garraf')!,
			contactId: contactMap.get('Ramon Vila'),
			date: new Date('2026-03-18'),
			channel: 'whatsapp',
			direction: 'inbound',
			type: 'followup',
			subject: 'WhatsApp follow-up',
			summary:
				'Ramon va enviar fotos del seu sistema actual de fulls de càlcul per WhatsApp.',
			outcome: 'interested',
			nextAction: 'Preparar proposta',
			nextActionAt: '2026-04-05',
		},
		{
			companyId: companyMap.get('tancaments-garraf')!,
			contactId: contactMap.get('Ramon Vila'),
			date: new Date('2026-04-02'),
			durationMin: 120,
			channel: 'visit',
			direction: 'outbound',
			type: 'demo',
			subject: 'Demo presencial a Sitges',
			summary:
				'Demo de 2h a les oficines. Van voler veure integració amb Google Sheets. Molt positiu.',
			outcome: 'proposal_requested',
			nextAction: 'Enviar proposta formal',
			nextActionAt: '2026-04-10',
			metadata: { attendees: ['Ramon Vila', 'Oriol Camps'] },
		},
		{
			companyId: companyMap.get('distribuciones-martinez')!,
			contactId: contactMap.get('Carlos Martínez'),
			date: new Date('2026-03-28'),
			channel: 'email',
			direction: 'outbound',
			type: 'cold',
			subject: 'Primer contacte per email',
			summary: 'Email fred enviat. Sense resposta.',
			outcome: 'no_response',
		},
		{
			companyId: companyMap.get('park-stone-design')!,
			contactId: null,
			date: new Date('2026-02-15'),
			channel: 'linkedin',
			direction: 'outbound',
			type: 'cold',
			subject: 'LinkedIn outreach',
			summary: 'Contacted via LinkedIn. They already have a web provider.',
			outcome: 'not_interested',
		},
		{
			companyId: companyMap.get('ceramiques-emporda')!,
			contactId: null,
			date: new Date('2026-04-08'),
			channel: 'event',
			direction: 'inbound',
			type: 'meeting',
			subject: 'Fira de Ceràmica Empordà',
			summary: 'Trobada casual a la fira. Van mostrar interès en venda online.',
			outcome: 'interested',
			metadata: { eventName: 'Fira de Ceràmica 2026', booth: 'A12' },
		},
		{
			companyId: companyMap.get('taller-mecanic-jove')!,
			contactId: contactMap.get('Marc Jove'),
			date: new Date('2026-04-10'),
			channel: 'instagram',
			direction: 'inbound',
			type: 'check-in',
			subject: 'DM de seguiment',
			summary:
				'Marc va preguntar per Instagram si tenim plantilles per a tallers mecànics.',
			outcome: 'responded',
		},
		{
			companyId: companyMap.get('hostal-pirineu')!,
			contactId: contactMap.get('Arnau Ribas'),
			date: new Date('2026-04-05'),
			durationMin: 25,
			channel: 'phone',
			direction: 'outbound',
			type: 'check-in',
			subject: 'Seguiment post-demo',
			summary:
				'Arnau confirma que vol tirar endavant amb el sistema de reserves. Falta pressupost final.',
			outcome: 'meeting_scheduled',
			nextAction: 'Reunió final per tancar pressupost',
			nextActionAt: '2026-04-12',
		},
	]

	const allTasks = [
		{
			companyId: companyMap.get('ferros-baix-llobregat')!,
			contactId: contactMap.get('Jordi Puig'),
			type: 'visit',
			title: 'Reunió presencial a la fàbrica',
			dueAt: new Date('2026-04-05'),
		},
		{
			companyId: companyMap.get('bright-lane-boutique')!,
			contactId: contactMap.get('Sarah Mitchell'),
			type: 'call',
			title: 'Ecommerce demo videocall',
			dueAt: new Date('2026-04-03'),
		},
		{
			companyId: companyMap.get('hostal-pirineu')!,
			contactId: contactMap.get('Arnau Ribas'),
			type: 'email',
			title: 'Enviar demo reserves online',
			dueAt: new Date('2026-04-02'),
		},
		{
			companyId: companyMap.get('coastal-freight')!,
			contactId: contactMap.get('Tom Parker'),
			type: 'email',
			title: 'Send automation info pack',
			dueAt: new Date('2026-04-01'),
		},
		{
			companyId: companyMap.get('cal-pep-fonda')!,
			contactId: contactMap.get('Pep Casals'),
			type: 'followup',
			title: 'Revisió mensual amb Cal Pep',
			dueAt: new Date('2026-04-15'),
		},
		{
			companyId: companyMap.get('tancaments-garraf')!,
			contactId: contactMap.get('Ramon Vila'),
			type: 'proposal',
			title: 'Enviar proposta automatització Tancaments Garraf',
			dueAt: new Date('2026-04-10'),
		},
		{
			companyId: companyMap.get('cal-pep-fonda')!,
			contactId: contactMap.get('Pep Casals'),
			type: 'call',
			title: 'Trucada onboarding Cal Pep',
			dueAt: new Date('2026-03-05'),
			// `status='done'` and `completedAt` must be set together (DB CHECK).
			status: 'done',
			completedAt: new Date('2026-03-05'),
		},
		{
			companyId: companyMap.get('ferros-baix-llobregat')!,
			contactId: contactMap.get('Marta Soler'),
			type: 'email',
			title: 'Enviar cas pràctic facturació automàtica',
			dueAt: new Date('2026-03-20'),
		},
		{
			companyId: companyMap.get('distribuciones-martinez')!,
			contactId: null,
			type: 'other',
			title: 'Investigar competència logística a Alzira',
		},
		{
			companyId: companyMap.get('ceramiques-emporda')!,
			contactId: null,
			type: 'visit',
			title: 'Visitar taller a La Bisbal',
			dueAt: new Date('2026-05-01'),
			metadata: { travelRequired: true, estimatedKm: 130 },
		},
		// Varied lifecycle/source/priority so the board's middle states, the
		// agent/email/booking source chips, the priority rivets, and the snooze
		// view all have something to render.
		{
			companyId: companyMap.get('cal-pep-fonda')!,
			contactId: null,
			type: 'other',
			title: 'Draft a follow-up email for Cal Pep',
			priority: 'high',
			status: 'in_progress',
			dueAt: new Date('2026-04-18'),
		},
		{
			companyId: companyMap.get('ferros-baix-llobregat')!,
			contactId: null,
			type: 'email',
			title: 'Awaiting budget sign-off before the proposal',
			status: 'blocked',
			dueAt: new Date('2026-04-20'),
		},
		{
			companyId: companyMap.get('hostal-pirineu')!,
			contactId: null,
			type: 'call',
			title: 'Review the reservations demo recording',
			priority: 'low',
			status: 'in_review',
		},
		{
			companyId: companyMap.get('park-stone-design')!,
			contactId: null,
			type: 'other',
			title: 'Outreach cancelled — they kept their provider',
			status: 'cancelled',
		},
		{
			companyId: companyMap.get('cal-pep-fonda')!,
			contactId: null,
			type: 'followup',
			title: 'Revisit the Cal Pep upsell',
			snoozedUntil: new Date('2026-07-15'),
		},
	]

	// Enough work spread across the inbox rail that every shelf has something
	// on it and one of them needs a second page to show everything. The dates
	// hang off SEED_REFERENCE so two runs produce identical data, which also
	// means the shelves read against the seed's own "today" — to browse them as
	// today's work, seed with a fresh reference:
	//   SEED_REFERENCE_DATE="$(date -u +%FT%TZ)" pnpm cli seed
	const DAY = 86_400_000
	const fromReference = (offsetMs: number) =>
		new Date(SEED_REFERENCE.getTime() + offsetMs)
	// A fixed time of day, so a seed run at 23:50 doesn't push "today" onto
	// tomorrow. Mid-morning to late-afternoon UTC keeps these on the same
	// calendar date across the timezones the app is read in.
	const onReferenceDay = (dayOffset: number, hourUtc: number) => {
		const date = new Date(SEED_REFERENCE.getTime() + dayOffset * DAY)
		date.setUTCHours(hourUtc, 0, 0, 0)
		return date
	}
	// The backlog spreads over every company except the two the minimal preset
	// keeps, so those two are left with their hand-written tasks alone.
	const backlogCompanies = [...companyMap.entries()]
		.filter(([slug]) => !MINIMAL_COMPANY_SLUGS.has(slug))
		.map(([, id]) => id)
	const spreadCompany = (index: number) =>
		backlogCompanies[index % backlogCompanies.length]!

	const shelfSpread: ReadonlyArray<{
		companyId: string
		contactId: string | null
		type: string
		title: string
		status?: string
		dueAt?: Date
		snoozedUntil?: Date
		completedAt?: Date
	}> = [
		// Behind: due between yesterday and a month ago.
		...Array.from({ length: 12 }, (_, i) => ({
			companyId: spreadCompany(i),
			contactId: null,
			type: 'followup',
			title: `Chase the pending quote (${i + 1})`,
			dueAt: onReferenceDay(-(i + 1) * 2, 10),
		})),
		// Due today, spread across working hours so no timezone reads them as
		// belonging to the day before or after.
		...Array.from({ length: 8 }, (_, i) => ({
			companyId: spreadCompany(i + 12),
			contactId: null,
			type: 'call',
			title: `Call back about the trial (${i + 1})`,
			dueAt: onReferenceDay(0, 9 + i),
		})),
		// The rest of the week.
		...Array.from({ length: 10 }, (_, i) => ({
			companyId: spreadCompany(i + 20),
			contactId: null,
			type: 'email',
			title: `Send the revised proposal (${i + 1})`,
			dueAt: onReferenceDay((i % 6) + 1, 10),
		})),
		// Beyond the week — deliberately more than one page holds, so the
		// "Load more" button has something to fetch.
		...Array.from({ length: 55 }, (_, i) => ({
			companyId: spreadCompany(i + 30),
			contactId: null,
			type: 'other',
			title: `Review the account plan (${i + 1})`,
			dueAt: onReferenceDay(i + 8, 10),
		})),
		// Nobody has put a date on these.
		...Array.from({ length: 8 }, (_, i) => ({
			companyId: spreadCompany(i + 85),
			contactId: null,
			type: 'other',
			title: `Research their expansion plans (${i + 1})`,
		})),
		// Sleeping until later in the week.
		...Array.from({ length: 3 }, (_, i) => ({
			companyId: spreadCompany(i + 93),
			contactId: null,
			type: 'followup',
			title: `Revisit after their busy season (${i + 1})`,
			dueAt: onReferenceDay(0, 11),
			snoozedUntil: fromReference((i + 3) * DAY),
		})),
		// Finished within the last week, which is as far back as the rail looks.
		...Array.from({ length: 5 }, (_, i) => ({
			companyId: spreadCompany(i + 96),
			contactId: null,
			type: 'call',
			title: `Walked them through the handover (${i + 1})`,
			status: 'done' as const,
			dueAt: onReferenceDay(-(i + 1), 10),
			completedAt: onReferenceDay(-(i + 1), 11),
		})),
	]

	// `normalizeRows` writes explicit NULL for missing keys, bypassing Postgres column defaults.
	const withTaskDefaults = <
		T extends { status?: string; source?: string; priority?: string },
	>(
		task: T,
	) => ({
		status: 'open' as const,
		source: 'user' as const,
		priority: 'normal' as const,
		...task,
	})

	if (preset === 'minimal') {
		return {
			contacts: allContacts.filter(c => MINIMAL_CONTACT_NAMES.has(c.name)),
			interactions: allInteractions.filter(c =>
				MINIMAL_COMPANY_SLUGS.has(
					[...companyMap.entries()].find(([, id]) => id === c.companyId)?.[0] ??
						'',
				),
			),
			tasks: allTasks
				.filter(c =>
					MINIMAL_COMPANY_SLUGS.has(
						[...companyMap.entries()].find(
							([, id]) => id === c.companyId,
						)?.[0] ?? '',
					),
				)
				.map(withTaskDefaults),
		}
	}

	return {
		contacts: allContacts,
		interactions: allInteractions,
		tasks: [
			...allTasks.map(withTaskDefaults),
			...shelfSpread.map(withTaskDefaults),
		],
	}
}

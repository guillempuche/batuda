/** biome-ignore-all lint/style/noNonNullAssertion: seed data */
import { apiKey } from '@better-auth/api-key'
import { betterAuth } from 'better-auth'
import { admin, bearer, openAPI } from 'better-auth/plugins'
import { Config, Effect, Redacted } from 'effect'
import { SqlClient } from 'effect/unstable/sql'
import { PostgresDialect } from 'kysely'
import pg from 'pg'

// ── Helpers ──────────────────────────────────────────────

/** Ensure all objects in a batch have the same keys (required by sql.insert). */
const normalizeRows = <T extends Record<string, unknown>>(rows: T[]): T[] => {
	const allKeys = new Set<string>()
	for (const row of rows) for (const k of Object.keys(row)) allKeys.add(k)
	return rows.map(
		row =>
			Object.fromEntries(
				[...allKeys].map(k => [k, k in row ? row[k] : null]),
			) as T,
	)
}

// ── Presets ───────────────────────────────────────────────

export const PRESETS = ['minimal', 'full'] as const
export type Preset = (typeof PRESETS)[number]

// ── Test user ─────────────────────────────────────────────

export const TEST_USER = {
	email: 'dev@forja.cat',
	password: 'forja-dev-2026',
	name: 'Forja Dev',
}

// ── Seed data ─────────────────────────────────────────────

const PRODUCTS = [
	{
		slug: 'web-starter',
		name: 'Web Starter',
		type: 'service',
		status: 'active',
		description:
			'Lloc web professional amb SEO local i mòbil-first per a petits negocis.',
		defaultPrice: '990.00',
		priceType: 'fixed',
		targetIndustries: ['restauració', 'retail', 'serveis'],
	},
	{
		slug: 'gestio-reserves',
		name: 'Gestió de Reserves',
		type: 'microsaas',
		status: 'active',
		description:
			'Sistema de reserves online amb calendari, recordatoris i pagaments.',
		defaultPrice: '49.00',
		priceType: 'monthly',
		targetIndustries: ['restauració', 'hostaleria', 'serveis'],
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
		targetIndustries: ['manufactura', 'distribució', 'construcció'],
	},
	{
		slug: 'ecommerce-local',
		name: 'Ecommerce Local',
		type: 'product',
		status: 'beta',
		description: 'Botiga online amb enviament local i integració amb TPV.',
		defaultPrice: '2500.00',
		priceType: 'fixed',
		targetIndustries: ['retail', 'manufactura', 'distribució'],
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
		targetIndustries: ['restauració', 'retail', 'hostaleria'],
	},
]

const COMPANIES = [
	{
		slug: 'cal-pep-fonda',
		name: 'Cal Pep Fonda',
		status: 'client',
		industry: 'restauració',
		sizeRange: '6-10',
		region: 'cat',
		location: 'Vilanova i la Geltrú',
		source: 'referral',
		priority: 1,
		website: 'https://calpepfonda.cat',
		email: 'info@calpepfonda.cat',
		phone: '+34 938 123 456',
		instagram: '@calpepfonda',
		productsFit: ['web-starter', 'gestio-reserves'],
		tags: ['gastro', 'garraf'],
		painPoints: 'Reserves per telèfon, perden clients els caps de setmana.',
		currentTools: 'Llibreta + WhatsApp',
		nextAction: 'Enviar factura mensual',
	},
	{
		slug: 'ferros-baix-llobregat',
		name: 'Ferros Baix Llobregat',
		status: 'proposal',
		industry: 'manufactura',
		sizeRange: '26-50',
		region: 'cat',
		location: 'Cornellà de Llobregat',
		source: 'linkedin',
		priority: 1,
		website: 'https://ferrosbl.com',
		email: 'gerencia@ferrosbl.com',
		phone: '+34 936 555 111',
		linkedin: 'ferros-baix-llobregat',
		productsFit: ['automatitzacions'],
		tags: ['indústria', 'facturació'],
		painPoints: 'Factures manuals amb Excel, errors freqüents al tancar mes.',
		currentTools: 'Excel + Contaplus',
		nextAction: 'Presentar proposta automatització',
	},
	{
		slug: 'botiga-la-rambla',
		name: 'Botiga La Rambla',
		status: 'meeting',
		industry: 'retail',
		sizeRange: '1-5',
		region: 'cat',
		location: 'Igualada',
		source: 'instagram',
		priority: 2,
		email: 'hola@botigalarambla.cat',
		phone: '+34 938 777 222',
		instagram: '@botigalarambla',
		productsFit: ['ecommerce-local', 'web-starter'],
		tags: ['moda', 'anoia'],
		painPoints: 'Volen vendre online però no saben per on començar.',
		currentTools: 'Instagram direct',
		nextAction: 'Reunió demo ecommerce',
	},
	{
		slug: 'electricitat-del-valles',
		name: 'Electricitat del Vallès',
		status: 'contacted',
		industry: 'construcció',
		sizeRange: '11-25',
		region: 'cat',
		location: 'Terrassa',
		source: 'google_maps',
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
		industry: 'restauració',
		sizeRange: '1-5',
		region: 'cat',
		location: 'Berga',
		source: 'firecrawl',
		priority: 3,
		email: 'fornqueralt@gmail.com',
		phone: '+34 938 210 567',
		instagram: '@fornqueralt',
		productsFit: ['web-starter', 'social-media-pack'],
		tags: ['obrador', 'berguedà'],
	},
	{
		slug: 'transport-maresme',
		name: 'Transport Maresme SL',
		status: 'responded',
		industry: 'transport',
		sizeRange: '11-25',
		region: 'cat',
		location: 'Mataró',
		source: 'exa',
		priority: 2,
		website: 'https://transportmaresme.com',
		email: 'logistica@transportmaresme.com',
		phone: '+34 937 888 999',
		productsFit: ['automatitzacions'],
		tags: ['logística', 'maresme'],
		painPoints: 'Albarans en paper, difícil traçabilitat.',
		currentTools: 'Paper + fax',
		nextAction: 'Trucada de seguiment',
	},
	{
		slug: 'hostal-pirineu',
		name: 'Hostal del Pirineu',
		status: 'meeting',
		industry: 'hostaleria',
		sizeRange: '6-10',
		region: 'ara',
		location: 'Benasc',
		source: 'referral',
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
		slug: 'fruites-valencia',
		name: 'Fruites València',
		status: 'contacted',
		industry: 'distribució',
		sizeRange: '26-50',
		region: 'cv',
		location: 'Alzira',
		source: 'manual',
		priority: 2,
		website: 'https://fruitesvalencia.es',
		email: 'vendes@fruitesvalencia.es',
		phone: '+34 962 441 555',
		productsFit: ['automatitzacions', 'ecommerce-local'],
		tags: ['agroalimentari', 'ribera'],
		painPoints: 'Comandes per telèfon, fulls de ruta manuals.',
		currentTools: 'WhatsApp + Excel',
	},
	{
		slug: 'disseny-eixample',
		name: 'Disseny Eixample',
		status: 'dead',
		industry: 'serveis',
		sizeRange: '1-5',
		region: 'cat',
		location: 'Barcelona',
		source: 'linkedin',
		priority: 3,
		email: 'hola@dissenyeixample.com',
		instagram: '@dissenyeixample',
		productsFit: ['web-starter'],
		tags: ['disseny', 'barcelona'],
		painPoints: 'Ja tenien proveïdor web.',
	},
	{
		slug: 'ceramiques-emporda',
		name: 'Ceràmiques Empordà',
		status: 'prospect',
		industry: 'manufactura',
		sizeRange: '6-10',
		region: 'cat',
		location: "La Bisbal d'Empordà",
		source: 'firecrawl',
		priority: 2,
		website: 'https://ceramiquesemporda.cat',
		email: 'taller@ceramiquesemporda.cat',
		phone: '+34 972 640 333',
		instagram: '@ceramiquesemporda',
		productsFit: ['ecommerce-local', 'web-starter'],
		tags: ['artesania', 'empordà'],
		painPoints: 'Venen només a la botiga física, volen obrir canal online.',
	},
]

const MINIMAL_COMPANY_SLUGS = new Set([
	'cal-pep-fonda',
	'ferros-baix-llobregat',
])

const MINIMAL_CONTACT_NAMES = new Set([
	'Pep Casals',
	'Marta Soler',
	'Jordi Puig',
])

// ── Preset data builder ───────────────────────────────────

const getPresetData = (
	preset: Preset,
	companyMap: Map<string, string>,
	contactMap: Map<string, string>,
) => {
	const allContacts = [
		{
			companyId: companyMap.get('cal-pep-fonda')!,
			name: 'Pep Casals',
			role: 'Propietari',
			isDecisionMaker: true,
			email: 'pep@calpepfonda.cat',
			phone: '+34 938 123 456',
			whatsapp: '+34 638 123 456',
		},
		{
			companyId: companyMap.get('ferros-baix-llobregat')!,
			name: 'Marta Soler',
			role: 'Directora Financera',
			isDecisionMaker: true,
			email: 'marta@ferrosbl.com',
			phone: '+34 636 555 111',
		},
		{
			companyId: companyMap.get('ferros-baix-llobregat')!,
			name: 'Jordi Puig',
			role: 'Gerent',
			isDecisionMaker: true,
			email: 'gerencia@ferrosbl.com',
			emailStatus: 'bounced',
			emailStatusReason: 'Permanent/General',
		},
		{
			companyId: companyMap.get('botiga-la-rambla')!,
			name: 'Laia Font',
			role: 'Propietària',
			isDecisionMaker: true,
			email: 'hola@botigalarambla.cat',
			instagram: '@laiafont',
		},
		{
			companyId: companyMap.get('hostal-pirineu')!,
			name: 'Arnau Ribas',
			role: 'Director',
			isDecisionMaker: true,
			email: 'reserves@hostalpirineu.com',
			phone: '+34 674 551 234',
		},
		{
			companyId: companyMap.get('transport-maresme')!,
			name: 'Ramon Vidal',
			role: 'Cap de Logística',
			isDecisionMaker: false,
			email: 'logistica@transportmaresme.com',
			phone: '+34 637 888 999',
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
			companyId: companyMap.get('botiga-la-rambla')!,
			contactId: contactMap.get('Laia Font'),
			date: new Date('2026-03-20'),
			channel: 'instagram',
			direction: 'inbound',
			type: 'cold',
			subject: 'DM per Instagram',
			summary:
				'Laia ens va escriure per Instagram preguntant per botigues online.',
			outcome: 'interested',
			nextAction: 'Programar demo ecommerce',
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
			companyId: companyMap.get('transport-maresme')!,
			contactId: contactMap.get('Ramon Vidal'),
			date: new Date('2026-03-25'),
			channel: 'phone',
			direction: 'inbound',
			type: 'cold',
			subject: 'Trucada entrant',
			summary:
				"Ramon ens va trucar després de veure'ns a un directori. Interessat en digitalitzar albarans.",
			outcome: 'responded',
			nextAction: 'Enviar info automatitzacions',
		},
	]

	const allTasks = [
		{
			companyId: companyMap.get('ferros-baix-llobregat')!,
			contactId: contactMap.get('Jordi Puig'),
			type: 'visit',
			title: 'Reunió presencial a la fàbrica',
			notes: 'Portar portàtil per demo. Preguntar pels volums de factures.',
			dueAt: new Date('2026-04-05'),
		},
		{
			companyId: companyMap.get('botiga-la-rambla')!,
			contactId: contactMap.get('Laia Font'),
			type: 'call',
			title: 'Demo ecommerce per videocall',
			notes: 'Mostrar plantilla retail + integració Instagram Shop.',
			dueAt: new Date('2026-04-03'),
		},
		{
			companyId: companyMap.get('hostal-pirineu')!,
			contactId: contactMap.get('Arnau Ribas'),
			type: 'email',
			title: 'Enviar demo reserves online',
			notes: 'Incloure link a la demo amb dades de prova.',
			dueAt: new Date('2026-04-02'),
		},
		{
			companyId: companyMap.get('transport-maresme')!,
			contactId: contactMap.get('Ramon Vidal'),
			type: 'email',
			title: 'Enviar informació automatitzacions',
			notes: "PDF amb casos d'ús logística + preus.",
			dueAt: new Date('2026-04-01'),
		},
		{
			companyId: companyMap.get('cal-pep-fonda')!,
			contactId: contactMap.get('Pep Casals'),
			type: 'followup',
			title: 'Revisió mensual amb Cal Pep',
			notes: 'Revisar mètriques web i reserves del mes.',
			dueAt: new Date('2026-04-15'),
		},
	]

	const withContactDefaults = <
		T extends {
			emailStatus?: string
			emailSoftBounceCount?: number
		},
	>(
		contact: T,
	) => ({
		emailStatus: 'unknown' as const,
		emailSoftBounceCount: 0,
		...contact,
	})

	if (preset === 'minimal') {
		return {
			contacts: allContacts
				.filter(c => MINIMAL_CONTACT_NAMES.has(c.name))
				.map(withContactDefaults),
			interactions: allInteractions.filter(c =>
				MINIMAL_COMPANY_SLUGS.has(
					[...companyMap.entries()].find(([, id]) => id === c.companyId)?.[0] ??
						'',
				),
			),
			tasks: allTasks.filter(c =>
				MINIMAL_COMPANY_SLUGS.has(
					[...companyMap.entries()].find(([, id]) => id === c.companyId)?.[0] ??
						'',
				),
			),
		}
	}

	return {
		contacts: allContacts.map(withContactDefaults),
		interactions: allInteractions,
		tasks: allTasks,
	}
}

// ── Seed reset ────────────────────────────────────────────

export const seedReset = Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient
	yield* Effect.logInfo('Truncating CRM tables...')
	yield* sql`TRUNCATE companies, products, pages CASCADE`
})

// ── Seed auth ─────────────────────────────────────────────

export const seedAuth = Effect.gen(function* () {
	yield* Effect.logInfo('Seeding auth user...')
	const dbUrl = yield* Config.redacted('DATABASE_URL')
	const secret = yield* Config.string('BETTER_AUTH_SECRET').pipe(
		Config.withDefault('change-me-in-production'),
	)

	const pool = new pg.Pool({ connectionString: Redacted.value(dbUrl) })
	// Mirrors `apps/server/src/lib/auth.ts`: `emailAndPassword.disableSignUp`
	// is `true` so the public `/auth/sign-up/email` endpoint is closed. The
	// seed uses the admin plugin's server-side `auth.api.createUser`, which
	// bypasses the signup gate entirely — this is the same escape hatch the
	// invite flow will use in production to provision a new team member.
	const auth = betterAuth({
		basePath: '/auth',
		secret,
		database: { dialect: new PostgresDialect({ pool }), type: 'postgres' },
		emailAndPassword: { enabled: true, disableSignUp: true },
		user: {
			additionalFields: {
				isAgent: { type: 'boolean', required: false, defaultValue: false },
			},
		},
		plugins: [
			openAPI(),
			bearer(),
			admin(),
			apiKey({ enableSessionForAPIKeys: true }),
		],
	})

	yield* Effect.promise(() =>
		auth.api.createUser({
			body: {
				email: TEST_USER.email,
				password: TEST_USER.password,
				name: TEST_USER.name,
				role: 'admin',
			},
		}),
	).pipe(
		Effect.tap(() => Effect.logInfo(`Created auth user: ${TEST_USER.email}`)),
		Effect.catchCause(() =>
			Effect.logInfo(`Auth user already exists: ${TEST_USER.email}`),
		),
	)

	yield* Effect.logInfo('')
	yield* Effect.logInfo('┌─── Auth credentials ───────────────────────┐')
	yield* Effect.logInfo(`│  Email:    ${TEST_USER.email.padEnd(31)}│`)
	yield* Effect.logInfo(`│  Password: ${TEST_USER.password.padEnd(31)}│`)
	yield* Effect.logInfo(`│  Name:     ${TEST_USER.name.padEnd(31)}│`)
	yield* Effect.logInfo('│  Role:     admin                           │')
	yield* Effect.logInfo('└────────────────────────────────────────────┘')
	yield* Effect.logInfo('')
	yield* Effect.logInfo('Sign in:')
	yield* Effect.logInfo(
		`  curl -X POST http://localhost:3010/auth/sign-in/email \\`,
	)
	yield* Effect.logInfo(`    -H 'content-type: application/json' \\`)
	yield* Effect.logInfo(
		`    -d '{"email":"${TEST_USER.email}","password":"${TEST_USER.password}"}'`,
	)

	yield* Effect.promise(() => pool.end())
})

// ── Seed effect ───────────────────────────────────────────

export const seed = (preset: Preset) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient

		const companies =
			preset === 'minimal'
				? COMPANIES.filter(c => MINIMAL_COMPANY_SLUGS.has(c.slug))
				: COMPANIES

		const products =
			preset === 'minimal'
				? PRODUCTS.filter(c =>
						['web-starter', 'automatitzacions'].includes(c.slug),
					)
				: PRODUCTS

		// 1. Products
		yield* Effect.logInfo(`Seeding products (${preset})...`)
		const insertedProducts = yield* sql<{
			id: string
			slug: string
		}>`INSERT INTO products ${sql.insert(normalizeRows(products))} RETURNING id, slug`
		for (const p of insertedProducts) {
			yield* Effect.logInfo(`  product: ${p.slug} (${p.id})`)
		}

		// 2. Companies
		yield* Effect.logInfo(`Seeding companies (${preset})...`)
		const insertedCompanies = yield* sql<{
			id: string
			slug: string
			status: string
		}>`INSERT INTO companies ${sql.insert(normalizeRows(companies))} RETURNING id, slug, status`

		const companyMap = new Map(insertedCompanies.map(c => [c.slug, c.id]))
		for (const c of insertedCompanies) {
			yield* Effect.logInfo(`  company: ${c.slug} [${c.status}] (${c.id})`)
		}

		// 3. Contacts
		yield* Effect.logInfo('Seeding contacts...')
		// Pass empty contactMap for initial contact build — contactIds not needed yet
		const data = getPresetData(preset, companyMap, new Map())
		const insertedContacts = yield* sql<{
			id: string
			name: string
		}>`INSERT INTO contacts ${sql.insert(normalizeRows(data.contacts))} RETURNING id, name`

		const contactMap = new Map(insertedContacts.map(c => [c.name, c.id]))
		for (const c of insertedContacts) {
			yield* Effect.logInfo(`  contact: ${c.name} (${c.id})`)
		}

		// 4. Interactions (rebuild with real contactMap for contactId references)
		yield* Effect.logInfo('Seeding interactions...')
		const dataWithContacts = getPresetData(preset, companyMap, contactMap)
		const insertedInteractions = yield* sql<{
			id: string
			channel: string
			type: string
		}>`INSERT INTO interactions ${sql.insert(normalizeRows(dataWithContacts.interactions))} RETURNING id, channel, type`
		for (const i of insertedInteractions.slice(0, 3)) {
			yield* Effect.logInfo(`  interaction: ${i.channel}/${i.type} (${i.id})`)
		}
		if (insertedInteractions.length > 3) {
			yield* Effect.logInfo(`  ... and ${insertedInteractions.length - 3} more`)
		}

		// 5. Tasks
		yield* Effect.logInfo('Seeding tasks...')
		const insertedTasks = yield* sql<{
			id: string
			title: string
		}>`INSERT INTO tasks ${sql.insert(normalizeRows(dataWithContacts.tasks))} RETURNING id, title`
		for (const t of insertedTasks.slice(0, 3)) {
			yield* Effect.logInfo(`  task: ${t.title} (${t.id})`)
		}
		if (insertedTasks.length > 3) {
			yield* Effect.logInfo(`  ... and ${insertedTasks.length - 3} more`)
		}

		// Full preset extras
		if (preset === 'full') {
			// 6. Documents
			yield* Effect.logInfo('Seeding documents...')
			yield* sql`INSERT INTO documents ${sql.insert(
				normalizeRows([
					{
						companyId: companyMap.get('cal-pep-fonda')!,
						interactionId: insertedInteractions[0]?.id,
						type: 'prenote',
						title: 'Preparació visita Cal Pep',
						content:
							'## Objectiu\nVeure el restaurant, entendre flux de reserves actual.\n\n## Preguntes\n- Quants coberts per servei?\n- Fan reserves per WhatsApp o telèfon?\n- Tenen web?',
					},
					{
						companyId: companyMap.get('cal-pep-fonda')!,
						interactionId: insertedInteractions[0]?.id,
						type: 'postnote',
						title: 'Resum visita Cal Pep',
						content:
							'## Resum\n60 coberts, 2 serveis/dia. Reserves per telèfon, perden un 15% de clients que no esperen.\n\n## Decisió\nVol web + reserves. Pressupost aprovat fins a 1500 EUR.',
					},
					{
						companyId: companyMap.get('ferros-baix-llobregat')!,
						interactionId: null,
						type: 'research',
						title: 'Anàlisi Ferros BL',
						content:
							"## Empresa\n40 treballadors, 2 naus a Cornellà. Facturen ~3M EUR/any.\n\n## Problemes detectats\n- Facturació manual: 2 dies/mes\n- Errors de transcripció: ~5% factures\n- Sense control d'estocs en temps real",
					},
					{
						companyId: companyMap.get('hostal-pirineu')!,
						interactionId: insertedInteractions[5]?.id,
						type: 'visit_notes',
						title: 'Notes visita Hostal Pirineu',
						content:
							'## Context\n12 habitacions, temporada alta juny-setembre + esquí desembre-març.\n\n## Comissions\nBooking: 15-18%. Volen baixar a <5% amb canal directe.\n\n## Requisits\n- Calendari amb disponibilitat\n- Pagament anticipat (Stripe/Redsys)\n- Multi-idioma: ca, es, fr',
					},
				]),
			)}`

			// 7. Proposals
			yield* Effect.logInfo('Seeding proposals...')
			const productMap = new Map(insertedProducts.map(p => [p.slug, p.id]))
			yield* sql`INSERT INTO proposals ${sql.insert(
				normalizeRows([
					{
						companyId: companyMap.get('cal-pep-fonda')!,
						contactId: contactMap.get('Pep Casals'),
						status: 'accepted',
						title: 'Web + Gestió Reserves — Cal Pep Fonda',
						lineItems: JSON.stringify([
							{
								product_id: productMap.get('web-starter'),
								qty: 1,
								price: '990.00',
								notes: 'Web responsive amb SEO local',
							},
							{
								product_id: productMap.get('gestio-reserves'),
								qty: 12,
								price: '49.00',
								notes: '12 mesos gestió de reserves',
							},
						]),
						totalValue: '1578.00',
						sentAt: new Date('2026-02-22'),
						respondedAt: new Date('2026-02-25'),
						notes: 'Acceptat per telèfon. Inici projecte 1 de març.',
					},
					{
						companyId: companyMap.get('ferros-baix-llobregat')!,
						contactId: contactMap.get('Jordi Puig'),
						status: 'draft',
						title: 'Automatització facturació — Ferros BL',
						lineItems: JSON.stringify([
							{
								product_id: productMap.get('automatitzacions'),
								qty: 1,
								price: '1500.00',
								notes: 'Setup inicial + integració Contaplus',
							},
						]),
						totalValue: '1500.00',
						sentAt: null,
						respondedAt: null,
						notes: 'Pendent de reunió presencial per tancar detalls.',
					},
				]),
			)}`

			// 8. Pages
			yield* Effect.logInfo('Seeding pages...')
			const pageRows = [
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
									title: 'Reserves Online per Cal Pep Fonda',
									subtitle:
										'Gestiona les teves reserves des del mòbil, sense trucades.',
								},
							},
							{
								type: 'value-props',
								attrs: {
									items: [
										'Calendari en temps real',
										'Recordatoris automàtics per SMS',
										'Integració amb Google Maps',
									],
								},
							},
							{
								type: 'cta',
								attrs: { text: 'Comença ara', url: '/contacte' },
							},
						],
					}),
					meta: JSON.stringify({
						og_title: 'Reserves Online — Cal Pep Fonda',
						og_description: 'Sistema de reserves online per al teu restaurant.',
					}),
					publishedAt: new Date('2026-03-01'),
					viewCount: 47,
				},
				{
					companyId: null,
					slug: 'automatitzacions-industria',
					lang: 'ca',
					title: 'Automatitzacions per a la Indústria',
					status: 'draft',
					template: 'landing',
					content: JSON.stringify({
						type: 'doc',
						content: [
							{
								type: 'hero',
								attrs: {
									title: 'Automatitza la teva fàbrica',
									subtitle:
										'Redueix errors i estalvia temps amb workflows intel·ligents.',
								},
							},
							{
								type: 'value-props',
								attrs: {
									items: [
										'Facturació automàtica',
										"Control d'estocs en temps real",
										'Integració amb ERP existent',
									],
								},
							},
						],
					}),
					meta: JSON.stringify({
						og_title: 'Automatitzacions Industrials',
						og_description:
							"Solucions d'automatització per a empreses industrials catalanes.",
					}),
					publishedAt: null,
					viewCount: 0,
				},
			]
			yield* sql`INSERT INTO pages ${sql.insert(pageRows)}`
		}

		const counts = {
			products: insertedProducts.length,
			companies: insertedCompanies.length,
			contacts: insertedContacts.length,
			interactions: insertedInteractions.length,
			tasks: insertedTasks.length,
			documents: preset === 'full' ? 4 : 0,
			proposals: preset === 'full' ? 2 : 0,
			pages: preset === 'full' ? 2 : 0,
		}

		yield* Effect.logInfo('Seed complete!')
		return counts
	})

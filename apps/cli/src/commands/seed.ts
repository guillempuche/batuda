/** biome-ignore-all lint/style/noNonNullAssertion: seed data */
import { createCipheriv, hkdfSync, randomBytes, randomUUID } from 'node:crypto'

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { apiKey } from '@better-auth/api-key'
import { betterAuth } from 'better-auth'
import { admin, bearer, openAPI, organization } from 'better-auth/plugins'
import { adminAc, defaultAc } from 'better-auth/plugins/admin/access'
import { Config, Effect, Redacted } from 'effect'
import { SqlClient } from 'effect/unstable/sql'
import pg from 'pg'

import { buildBetterAuthConfig } from '@batuda/auth'

// 1×1 transparent PNG (67 bytes) — used by attachment demo messages so
// the chip render path has real bytes flowing through MinIO.
const ONE_PIXEL_PNG = Buffer.from(
	'89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c62000100000500010d0a2db40000000049454e44ae426082',
	'hex',
)

// Minimal valid PDF (~290 bytes). Empty single-page A4 document.
// Used as the M8 quote.pdf attachment so the chip download produces
// bytes a PDF viewer will at least open without erroring.
const TINY_PDF = Buffer.from(
	[
		'%PDF-1.4',
		'1 0 obj <</Type/Catalog/Pages 2 0 R>> endobj',
		'2 0 obj <</Type/Pages/Kids[3 0 R]/Count 1>> endobj',
		'3 0 obj <</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>> endobj',
		'xref',
		'0 4',
		'0000000000 65535 f ',
		'0000000009 00000 n ',
		'0000000054 00000 n ',
		'0000000104 00000 n ',
		'trailer <</Size 4/Root 1 0 R>>',
		'startxref',
		'160',
		'%%EOF',
	].join('\n'),
	'utf8',
)

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

/**
 * Build a minimal silent WAV file in-memory. 8 kHz mono 16-bit PCM, ~0.1 s.
 * Good enough for the seed — tiny (~1.6 KB) and a real player opens it without
 * complaint, so the "has audio" UI path is exercisable.
 */
const silentWav = (durationSec = 0.1, sampleRate = 8000): Buffer => {
	const samples = Math.floor(durationSec * sampleRate)
	const dataSize = samples * 2
	const buf = Buffer.alloc(44 + dataSize)
	buf.write('RIFF', 0)
	buf.writeUInt32LE(36 + dataSize, 4)
	buf.write('WAVE', 8)
	buf.write('fmt ', 12)
	buf.writeUInt32LE(16, 16)
	buf.writeUInt16LE(1, 20)
	buf.writeUInt16LE(1, 22)
	buf.writeUInt32LE(sampleRate, 24)
	buf.writeUInt32LE(sampleRate * 2, 28)
	buf.writeUInt16LE(2, 32)
	buf.writeUInt16LE(16, 34)
	buf.write('data', 36)
	buf.writeUInt32LE(dataSize, 40)
	return buf
}

// ── Presets ───────────────────────────────────────────────

export const PRESETS = ['minimal', 'full'] as const
export type Preset = (typeof PRESETS)[number]

// ── Demo personas ─────────────────────────────────────────
//
// Two orgs, three users, four memberships. Alice has dual membership so the
// dev tour (and tests) can exercise the multi-org-user code path without
// minting another account. Restaurant intentionally stays empty in v1 —
// its purpose is to be the "other org" reference; a future preset can
// populate it.

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
	// Member-everywhere admin. Models the "company-wide admin who happens
	// to belong to every org" persona — the cross-org reach is expressed
	// via memberships, not a Better Auth role.
	{
		email: 'boss@batuda.dev',
		password: 'batuda-dev-2026',
		name: 'Bea Boss',
		role: 'admin',
	},
	// Role-based superadmin. `app_service` is a Batuda-specific admin
	// role recognised by the Better Auth admin plugin (see
	// apps/server/src/lib/auth.ts adminRoles config). Has zero
	// memberships by design — the e2e test pins what behaviour the UI
	// should give such a user when the membership-scoped switcher
	// returns nothing.
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
	// Multi-org user: Alice is owner of taller and a regular member of
	// restaurant. The dev tour and the org-isolation tests rely on this.
	{ email: 'admin@taller.cat', orgSlug: 'restaurant', role: 'member' },
	// Boss is admin in every demo org — the membership-based equivalent
	// of a superadmin.
	{ email: 'boss@batuda.dev', orgSlug: 'taller', role: 'admin' },
	{ email: 'boss@batuda.dev', orgSlug: 'restaurant', role: 'admin' },
] as const

// Backward-compat shim — every existing seed reference (e.g. CRM rows that
// stamp the seed user as creator) keeps pointing at the same email and
// password so an existing dev login still works after this refactor.
export const TEST_USER = PRIMARY_DEMO_USER

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
		type: 'service',
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
	// ── Edge-case products ──
	{
		slug: 'consultoria-custom',
		name: 'Consultoria a Mida',
		type: 'service',
		status: 'active',
		description: 'Projectes de consultoria digital amb abast i preu negociats.',
		defaultPrice: null,
		priceType: 'custom',
		targetIndustries: ['serveis', 'other'],
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
		targetIndustries: null,
		metadata: { internal: true },
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
		latitude: 41.2241,
		longitude: 1.7254,
		geocodedAt: new Date(),
		geocodeSource: 'seed',
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
		latitude: 41.3526,
		longitude: 2.0715,
		geocodedAt: new Date(),
		geocodeSource: 'seed',
	},
	{
		slug: 'bright-lane-boutique',
		name: 'Bright Lane Boutique',
		status: 'meeting',
		industry: 'retail',
		sizeRange: '1-5',
		region: 'cat',
		location: 'Barcelona',
		source: 'instagram',
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
		geocodedAt: new Date(),
		geocodeSource: 'seed',
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
		slug: 'coastal-freight',
		name: 'Coastal Freight SL',
		status: 'responded',
		industry: 'transport',
		sizeRange: '11-25',
		region: 'cat',
		location: 'Mataró',
		source: 'exa',
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
		geocodedAt: new Date(),
		geocodeSource: 'seed',
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
		slug: 'distribuciones-martinez',
		name: 'Distribuciones Martínez',
		status: 'contacted',
		industry: 'distribució',
		sizeRange: '26-50',
		region: 'cv',
		location: 'Alzira',
		source: 'manual',
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
		industry: 'serveis',
		sizeRange: '1-5',
		region: 'cat',
		location: 'Barcelona',
		source: 'linkedin',
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
	// ── Edge-case companies ──
	{
		slug: 'tancaments-garraf',
		name: 'Tancaments Garraf SL',
		status: 'closed',
		industry: 'construcció',
		sizeRange: '11-25',
		region: 'cat',
		location: 'Sitges',
		source: 'referral',
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
		geocodedAt: new Date(),
		geocodeSource: 'seed',
	},
	{
		slug: 'consultoria-beta',
		name: 'Consultoria Beta',
		status: 'contacted',
		industry: 'other',
		sizeRange: '1-5',
		region: 'cv',
		location: 'València',
		source: 'manual',
		priority: 3,
		email: 'hola@consultoriabeta.es',
		productsFit: ['web-starter'],
		tags: ['consultoria'],
	},
	{
		slug: 'empresa-fantasma',
		name: "L'Ànec d'Or — Distribucions & Logística, S.L.",
		status: 'prospect',
		industry: 'distribució',
		sizeRange: '51-200',
		region: 'cat',
		location: 'Manresa',
		source: 'google_maps',
		priority: 3,
		metadata: { notes: 'Found via Maps but no contact info available yet.' },
	},
	{
		slug: 'taller-mecanic-jove',
		name: 'Taller Mecànic Jove',
		status: 'responded',
		industry: 'serveis',
		sizeRange: '6-10',
		region: 'cat',
		location: 'Granollers',
		source: 'instagram',
		priority: 2,
		instagram: '@tallerjove',
		productsFit: ['web-starter'],
		tags: ['automoció', 'vallès'],
		lastContactedAt: new Date('2025-09-15'),
		nextAction: 'Recontactar — 6 mesos sense resposta',
		nextActionAt: new Date('2026-03-15'),
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
			companyId: companyMap.get('bright-lane-boutique')!,
			name: 'Sarah Mitchell',
			role: 'Owner',
			isDecisionMaker: true,
			email: 'hello@brightlane.cat',
			instagram: '@sarahm_bcn',
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
			companyId: companyMap.get('coastal-freight')!,
			name: 'Tom Parker',
			role: 'Head of Logistics',
			isDecisionMaker: false,
			email: 'ops@coastalfreight.es',
			phone: '+34 637 888 999',
		},
		// ── Edge-case contacts ──
		{
			companyId: companyMap.get('tancaments-garraf')!,
			name: 'Ramon Vila',
			role: 'Gerent',
			isDecisionMaker: true,
			email: 'ramon@tancamentsgarraf.cat',
			phone: '+34 938 111 222',
			emailStatus: 'valid' as const,
			emailStatusReason: 'SMTP verified',
			emailStatusUpdatedAt: new Date('2026-03-20'),
			notes: 'Prefereix trucades al matí, abans de les 10h.',
		},
		{
			companyId: companyMap.get('tancaments-garraf')!,
			name: 'Laia Ferrer',
			role: 'Administrativa',
			isDecisionMaker: false,
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
			isDecisionMaker: false,
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
			isDecisionMaker: false,
			notes:
				'No contact info found — company discovered via Google Maps scrape.',
		},
		{
			companyId: companyMap.get('distribuciones-martinez')!,
			name: 'Carlos Martínez',
			role: 'Director Comercial',
			isDecisionMaker: true,
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
			isDecisionMaker: false,
			email: 'ana.lopez@dismartinez.es',
			emailStatus: 'unknown' as const,
			emailSoftBounceCount: 2,
			notes: 'Only responds on LinkedIn, rarely checks email.',
		},
		{
			companyId: companyMap.get('taller-mecanic-jove')!,
			name: 'Marc Jove',
			role: 'Propietari',
			isDecisionMaker: true,
			instagram: '@marcjove_tallerjove',
			notes: 'Instagram only — no email or phone provided.',
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
		// ── Edge-case interactions ──
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
			notes: 'Portar portàtil per demo. Preguntar pels volums de factures.',
			dueAt: new Date('2026-04-05'),
		},
		{
			companyId: companyMap.get('bright-lane-boutique')!,
			contactId: contactMap.get('Sarah Mitchell'),
			type: 'call',
			title: 'Ecommerce demo videocall',
			notes: 'Show retail template + Instagram Shop integration.',
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
			companyId: companyMap.get('coastal-freight')!,
			contactId: contactMap.get('Tom Parker'),
			type: 'email',
			title: 'Send automation info pack',
			notes: 'PDF with logistics use cases + pricing.',
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
		// ── Edge-case tasks ──
		{
			companyId: companyMap.get('tancaments-garraf')!,
			contactId: contactMap.get('Ramon Vila'),
			type: 'proposal',
			title: 'Enviar proposta automatització Tancaments Garraf',
			notes: 'Incloure integració Google Sheets + facturació.',
			dueAt: new Date('2026-04-10'),
		},
		{
			companyId: companyMap.get('cal-pep-fonda')!,
			contactId: contactMap.get('Pep Casals'),
			type: 'call',
			title: 'Trucada onboarding Cal Pep',
			notes: 'Fet — vam configurar el calendari de reserves.',
			dueAt: new Date('2026-03-05'),
			// `tasks_completed_at_matches_status` requires status='done' iff
			// completed_at IS NOT NULL — set both together or neither.
			status: 'done',
			completedAt: new Date('2026-03-05'),
		},
		{
			companyId: companyMap.get('ferros-baix-llobregat')!,
			contactId: contactMap.get('Marta Soler'),
			type: 'email',
			title: 'Enviar cas pràctic facturació automàtica',
			notes: "Hauria d'haver sortit fa dues setmanes.",
			dueAt: new Date('2026-03-20'),
		},
		{
			companyId: companyMap.get('distribuciones-martinez')!,
			contactId: null,
			type: 'other',
			title: 'Investigar competència logística a Alzira',
			notes: 'Buscar si tenen proveïdor IT actual.',
		},
		{
			companyId: companyMap.get('ceramiques-emporda')!,
			contactId: null,
			type: 'visit',
			title: 'Visitar taller a La Bisbal',
			dueAt: new Date('2026-05-01'),
			metadata: { travelRequired: true, estimatedKm: 130 },
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

	// `normalizeRows` (the column-shape aligner used by every `sql.insert`
	// here) sets keys missing from a row to explicit NULL. Explicit NULL
	// bypasses Postgres column defaults, so any row that omits `status`
	// would trip the `tasks.status NOT NULL` constraint as soon as another
	// row in the same batch sets it. Stamp the default at this layer so the
	// per-row literals above can stay as terse as possible.
	const withTaskDefaults = <T extends { status?: string }>(task: T) => ({
		status: 'open' as const,
		...task,
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
		contacts: allContacts.map(withContactDefaults),
		interactions: allInteractions,
		tasks: allTasks.map(withTaskDefaults),
	}
}

// ── Seed reset ────────────────────────────────────────────

export const seedReset = Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient
	yield* Effect.logInfo('Truncating CRM tables...')
	// `inboxes` is wiped via DELETE rather than TRUNCATE CASCADE because
	// `member.primary_inbox_id` is a FK to inboxes. TRUNCATE CASCADE
	// ignores `ON DELETE SET NULL` and would unconditionally truncate the
	// `member` table too — wiping every membership the identity seed just
	// created. DELETE honours the SET NULL action and leaves members intact.
	yield* sql`DELETE FROM inboxes`
	yield* sql`TRUNCATE companies, products, pages, research_runs, sources, user_research_policy, provider_quotas, provider_usage, email_thread_links, email_messages, call_recordings CASCADE`
})

// ── Seed auth ─────────────────────────────────────────────

export const seedIdentities = Effect.gen(function* () {
	yield* Effect.logInfo('Seeding orgs, users, memberships...')
	const dbUrl = yield* Config.redacted('DATABASE_URL')
	const secret = yield* Config.string('BETTER_AUTH_SECRET')
	const baseURL = yield* Config.string('BETTER_AUTH_BASE_URL').pipe(
		Config.withDefault('http://localhost:3010'),
	)

	const pool = new pg.Pool({ connectionString: Redacted.value(dbUrl) })

	// Refuse to seed when CRM rows reference org ids that don't exist in
	// `organization`. Symptom of a partial reset (e.g. running
	// `pnpm cli seed` after the auth tables got truncated separately):
	// auth.api.createOrganization mints fresh ids, leaving every old CRM
	// row pointing at a dead org. RLS then silently hides those rows from
	// the dashboard — the demo looks empty for no obvious reason. This
	// gate catches it at the source instead of letting a broken seed land.
	const orphanCheck = yield* Effect.tryPromise({
		try: () =>
			pool.query<{ table: string; orphan_count: string }>(`
				SELECT 'companies' AS table, count(*)::text AS orphan_count
				FROM companies c
				WHERE NOT EXISTS (
					SELECT 1 FROM organization o WHERE o.id = c.organization_id
				)
				UNION ALL
				SELECT 'contacts', count(*)::text
				FROM contacts c
				WHERE NOT EXISTS (
					SELECT 1 FROM organization o WHERE o.id = c.organization_id
				)
			`),
		catch: cause => new Error(String(cause)),
	})
	const orphanRows = orphanCheck.rows.filter(r => Number(r.orphan_count) > 0)
	if (orphanRows.length > 0) {
		yield* Effect.promise(() => pool.end())
		const summary = orphanRows
			.map(r => `${r.table}=${r.orphan_count}`)
			.join(', ')
		return yield* Effect.fail(
			new Error(
				`CRM data references organization ids that no longer exist (${summary}). ` +
					'This usually means the auth tables were reset without re-seeding ' +
					'the CRM rows. Run `pnpm cli db reset && pnpm cli seed` for a clean slate.',
			),
		)
	}
	// Uses the shared `buildBetterAuthConfig` — same plugins/config as the
	// server, so API keys, sessions, and orgs created here validate against
	// the running /auth/* routes. `disableSignUp: true` closes the public
	// signup endpoint; the admin plugin's `auth.api.createUser` is the
	// bypass for users, and the organization plugin handles orgs/members.
	const auth = betterAuth(
		buildBetterAuthConfig({
			env: {
				secret,
				baseURL,
				useSecureCookies: false,
				trustedOrigins: [],
			},
			pool,
			plugins: [
				openAPI(),
				bearer(),
				// Mirror apps/server/src/lib/auth.ts adminRoles + roles so the
				// seed's createUser accepts role: 'app_service' for the
				// superadmin persona.
				admin({
					adminRoles: ['admin', 'app_service'],
					roles: {
						admin: adminAc,
						user: defaultAc.newRole({ user: [], session: [] }),
						app_service: adminAc,
					},
				}),
				organization(),
				apiKey({ enableSessionForAPIKeys: true }),
			],
		}),
	)

	// 1. Users — must come first because Better Auth's createOrganization
	// requires `body.userId` (no HTTP session here) to attach the creator
	// as the first member atomically.
	const userIdsByEmail = new Map<string, string>()
	for (const u of DEMO_USERS) {
		yield* Effect.tryPromise(() =>
			auth.api.createUser({
				body: {
					email: u.email,
					password: u.password,
					name: u.name,
					// `app_service` is allowed at runtime via the admin
					// plugin's adminRoles, but Better Auth's static role
					// type doesn't widen with adminRoles config; cast here
					// keeps the narrow type for the common admin/user case.
					role: u.role as 'admin' | 'user',
				},
			}),
		).pipe(
			Effect.tap(() => Effect.logInfo(`  user: ${u.email}`)),
			Effect.catchCause(cause =>
				Effect.logInfo(
					`  user create failed (will keep going): ${u.email} — ${String(cause)}`,
				),
			),
		)
		const found = yield* Effect.tryPromise({
			try: () =>
				pool.query<{ id: string }>(
					'SELECT id FROM "user" WHERE email = $1 LIMIT 1',
					[u.email],
				),
			catch: cause => new Error(String(cause)),
		})
		const row = found.rows[0]
		if (row) userIdsByEmail.set(u.email, row.id)
	}

	// 2. Orgs — pass `userId` of the first declared owner so Better Auth
	// can create the owner membership atomically. Subsequent memberships
	// are added in step 3.
	const orgIdsBySlug = new Map<string, string>()
	for (const o of DEMO_ORGS) {
		const firstOwner = DEMO_MEMBERSHIPS.find(
			m => m.orgSlug === o.slug && m.role === 'owner',
		)
		const ownerUserId = firstOwner
			? userIdsByEmail.get(firstOwner.email)
			: undefined
		if (!ownerUserId) {
			yield* Effect.logInfo(`  org skipped (no owner resolved): ${o.slug}`)
			continue
		}
		yield* Effect.promise(() =>
			auth.api.createOrganization({
				body: { name: o.name, slug: o.slug, userId: ownerUserId },
			}),
		).pipe(
			Effect.tap(() => Effect.logInfo(`  org: ${o.slug}`)),
			Effect.catchCause(() =>
				Effect.logInfo(`  org already exists: ${o.slug}`),
			),
		)
		const found = yield* Effect.tryPromise({
			try: () =>
				pool.query<{ id: string }>(
					'SELECT id FROM "organization" WHERE slug = $1 LIMIT 1',
					[o.slug],
				),
			catch: cause => new Error(String(cause)),
		})
		const row = found.rows[0]
		if (row) orgIdsBySlug.set(o.slug, row.id)
	}

	// 3. Memberships — skip the role='owner' rows, they're already
	// attached as a side-effect of createOrganization above.
	for (const m of DEMO_MEMBERSHIPS) {
		if (m.role === 'owner') continue
		const userId = userIdsByEmail.get(m.email)
		const orgId = orgIdsBySlug.get(m.orgSlug)
		if (!userId || !orgId) continue
		yield* Effect.promise(() =>
			auth.api.addMember({
				body: { userId, organizationId: orgId, role: m.role },
			}),
		).pipe(
			Effect.tap(() =>
				Effect.logInfo(`  member: ${m.email} → ${m.orgSlug} (${m.role})`),
			),
			Effect.catchCause(() =>
				Effect.logInfo(`  member already exists: ${m.email} → ${m.orgSlug}`),
			),
		)
	}

	const emailWidth = Math.max(...DEMO_USERS.map(u => u.email.length))
	const pwWidth = Math.max(...DEMO_USERS.map(u => u.password.length))
	const nameWidth = Math.max(...DEMO_USERS.map(u => u.name.length))

	yield* Effect.logInfo('')
	yield* Effect.logInfo('─── Demo users (sign in with any of these) ───')
	for (const u of DEMO_USERS) {
		const memberships = DEMO_MEMBERSHIPS.filter(m => m.email === u.email)
			.map(m => `${m.orgSlug} (${m.role})`)
			.join(', ')
		yield* Effect.logInfo(
			`  ${u.email.padEnd(emailWidth)}  ${u.password.padEnd(pwWidth)}  ${u.name.padEnd(nameWidth)}  → ${memberships}`,
		)
	}
	yield* Effect.logInfo('')
	yield* Effect.logInfo(`Sign-in URL: ${baseURL}/auth/sign-in/email`)

	yield* Effect.promise(() => pool.end())
})

// ── Seed effect ───────────────────────────────────────────

export const seed = (preset: Preset) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient

		// Wrap the whole seed in one transaction so a crash partway
		// through (e.g. seedReset DELETEs and then a later INSERT or
		// S3 PUT fails) rolls back to the prior state instead of
		// leaving the DB stuck at "1 inbox of 4" + "0 messages" — the
		// exact stuck state observed when a previous run was Ctrl-C'd
		// after seedReset but before the inbox loop completed.
		// S3/MinIO uploads inside this block are NOT transactional —
		// orphaned attachment objects use deterministic keys and get
		// overwritten on the next successful run.
		return yield* sql.withTransaction(
			Effect.gen(function* () {
				// Always truncate before seeding so the command is idempotent.
				yield* seedReset

				// Every CRM row in this seed lives under the taller org. Restaurant
				// stays empty by design (the multi-org-isolation tests provision
				// rows there on demand). Resolved from the database so the seed
				// works whether or not seedIdentities just ran.
				const tallerOrgRows = yield* sql<{ id: string }>`
			SELECT id FROM "organization" WHERE slug = 'taller' LIMIT 1
		`
				const tallerOrgId = tallerOrgRows[0]?.id
				if (!tallerOrgId) {
					return yield* Effect.fail(
						new Error(
							'CRM seed requires the taller demo org. Run `pnpm cli seed` (which seeds identities before CRM data) or `pnpm cli db reset && pnpm cli seed` for a clean slate.',
						),
					)
				}
				// Helper: stamp organization_id on every row before sql.insert.
				const stamp = <T extends Record<string, unknown>>(
					rows: ReadonlyArray<T>,
				) => rows.map(r => ({ ...r, organizationId: tallerOrgId }))

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
				}>`INSERT INTO products ${sql.insert(normalizeRows(stamp(products)))} RETURNING id, slug`
				for (const p of insertedProducts) {
					yield* Effect.logInfo(`  product: ${p.slug} (${p.id})`)
				}

				// 2. Companies
				yield* Effect.logInfo(`Seeding companies (${preset})...`)
				const insertedCompanies = yield* sql<{
					id: string
					slug: string
					status: string
				}>`INSERT INTO companies ${sql.insert(normalizeRows(stamp(companies)))} RETURNING id, slug, status`

				const companyMap = new Map(insertedCompanies.map(c => [c.slug, c.id]))
				for (const c of insertedCompanies) {
					yield* Effect.logInfo(`  company: ${c.slug} [${c.status}] (${c.id})`)
				}

				// 2b. One Restaurant-org company so the multi-org switcher e2e can
				// prove that data re-scopes after setActive (a label-only flip
				// could pass without the queries refetching). Slug is unique
				// across orgs by design — a Taller-only slug must not be visible
				// when Restaurant is active and vice versa.
				const restaurantOrgRows = yield* sql<{ id: string }>`
			SELECT id FROM "organization" WHERE slug = 'restaurant' LIMIT 1
		`
				const restaurantOrgId = restaurantOrgRows[0]?.id
				if (restaurantOrgId) {
					yield* sql`INSERT INTO companies ${sql.insert([
						normalizeRows([
							{
								organizationId: restaurantOrgId,
								slug: 'marisqueria-del-port',
								name: 'Marisqueria del Port',
								status: 'client',
								industry: 'restauració',
								sizeRange: '6-10',
								region: 'cat',
								location: 'Sitges',
								source: 'referral',
								priority: 1,
								website: 'https://marisqueriadelport.cat',
								email: 'reserves@marisqueriadelport.cat',
								phone: null,
								productsFit: ['gestio-reserves'],
								tags: ['gastro', 'garraf'],
								painPoints: null,
								currentTools: null,
								nextAction: null,
								latitude: null,
								longitude: null,
								geocodedAt: null,
								geocodeSource: null,
							},
						])[0]!,
					])}`
					yield* Effect.logInfo('  company: marisqueria-del-port (restaurant)')
				}

				// 3. Contacts
				yield* Effect.logInfo('Seeding contacts...')
				// Pass empty contactMap for initial contact build — contactIds not needed yet
				const data = getPresetData(preset, companyMap, new Map())
				const insertedContacts = yield* sql<{
					id: string
					name: string
				}>`INSERT INTO contacts ${sql.insert(normalizeRows(stamp(data.contacts)))} RETURNING id, name`

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
				}>`INSERT INTO interactions ${sql.insert(normalizeRows(stamp(dataWithContacts.interactions)))} RETURNING id, channel, type`
				for (const i of insertedInteractions.slice(0, 3)) {
					yield* Effect.logInfo(
						`  interaction: ${i.channel}/${i.type} (${i.id})`,
					)
				}
				if (insertedInteractions.length > 3) {
					yield* Effect.logInfo(
						`  ... and ${insertedInteractions.length - 3} more`,
					)
				}

				// Mirror TimelineActivityService: one timeline_activity row per seeded
				// interaction, plus the cadence-column bump on companies/contacts.
				// Kept as SQL here so we don't have to import the server service into
				// the CLI bundle.
				yield* sql`
			INSERT INTO timeline_activity (
				organization_id, kind, entity_type, entity_id, company_id, contact_id,
				channel, direction, occurred_at, summary, payload
			)
			SELECT
				${tallerOrgId},
				CASE WHEN channel IN ('phone','call') THEN 'call_logged'
				     ELSE 'system_event' END,
				'interaction', id, company_id, contact_id,
				channel, direction, date, summary,
				jsonb_build_object(
					'type', type, 'subject', subject, 'outcome', outcome,
					'nextAction', next_action, 'nextActionAt', next_action_at,
					'durationMin', duration_min
				)
			FROM interactions
		`
				yield* sql`
			UPDATE companies c SET
				last_email_at   = (SELECT MAX(date) FROM interactions WHERE company_id = c.id AND channel = 'email'),
				last_call_at    = (SELECT MAX(date) FROM interactions WHERE company_id = c.id AND channel IN ('phone', 'call')),
				last_meeting_at = (SELECT MAX(date) FROM interactions WHERE company_id = c.id AND channel IN ('visit', 'event')),
				last_contacted_at = GREATEST(last_contacted_at, (SELECT MAX(date) FROM interactions WHERE company_id = c.id))
		`
				yield* sql`
			UPDATE contacts co SET
				last_email_at   = (SELECT MAX(date) FROM interactions WHERE contact_id = co.id AND channel = 'email'),
				last_call_at    = (SELECT MAX(date) FROM interactions WHERE contact_id = co.id AND channel IN ('phone', 'call')),
				last_meeting_at = (SELECT MAX(date) FROM interactions WHERE contact_id = co.id AND channel IN ('visit', 'event'))
		`

				// 5. Tasks
				yield* Effect.logInfo('Seeding tasks...')
				const insertedTasks = yield* sql<{
					id: string
					title: string
				}>`INSERT INTO tasks ${sql.insert(normalizeRows(stamp(dataWithContacts.tasks)))} RETURNING id, title`
				for (const t of insertedTasks.slice(0, 3)) {
					yield* Effect.logInfo(`  task: ${t.title} (${t.id})`)
				}
				if (insertedTasks.length > 3) {
					yield* Effect.logInfo(`  ... and ${insertedTasks.length - 3} more`)
				}

				// 5b. Calendar — event types, representative events, attendees.
				// Covers the three source branches (booking/email/internal) and
				// the three video-URL extractors (Zoom/Teams/Meet) so Batuda
				// /calendar renders every badge after a single `pnpm cli seed`.
				// Event-type upsert is idempotent with `pnpm cli calendar seed`.
				yield* Effect.logInfo('Seeding calendar...')
				const calendarEventTypeSeeds = [
					{
						slug: 'discovery',
						provider: 'calcom',
						title: 'Discovery call',
						durationMinutes: 30,
						locationKind: 'video',
					},
					{
						slug: 'demo',
						provider: 'calcom',
						title: 'Product demo',
						durationMinutes: 45,
						locationKind: 'video',
					},
					{
						slug: 'kickoff',
						provider: 'calcom',
						title: 'Project kickoff',
						durationMinutes: 60,
						locationKind: 'video',
					},
					{
						slug: 'support',
						provider: 'calcom',
						title: 'Support check-in',
						durationMinutes: 15,
						locationKind: 'video',
					},
					{
						slug: 'onsite-visit',
						provider: 'calcom',
						title: 'Onsite visit',
						durationMinutes: 120,
						locationKind: 'address',
					},
					{
						slug: 'internal-block',
						provider: 'internal',
						title: 'Internal focus block',
						durationMinutes: 60,
						locationKind: 'none',
					},
				] as const
				for (const et of calendarEventTypeSeeds) {
					yield* sql`
				INSERT INTO calendar_event_types (
					organization_id, slug, provider, provider_event_type_id, title,
					duration_minutes, location_kind, default_location_value, active
				) VALUES (
					${tallerOrgId}, ${et.slug}, ${et.provider}, NULL, ${et.title},
					${et.durationMinutes}, ${et.locationKind}, NULL, true
				) ON CONFLICT (organization_id, slug) DO UPDATE SET
					title = EXCLUDED.title,
					duration_minutes = EXCLUDED.duration_minutes,
					location_kind = EXCLUDED.location_kind,
					updated_at = now()
			`
				}
				const [discoveryType] = yield* sql<{ id: string }>`
			SELECT id FROM calendar_event_types
			WHERE organization_id = ${tallerOrgId} AND slug = 'discovery'
			LIMIT 1
		`
				const [internalType] = yield* sql<{ id: string }>`
			SELECT id FROM calendar_event_types
			WHERE organization_id = ${tallerOrgId} AND slug = 'internal-block'
			LIMIT 1
		`
				const calDay = 24 * 60 * 60 * 1000
				const now = Date.now()
				const calcomCompany = companyMap.get('cal-pep-fonda')
				const ferrosCompany = companyMap.get('ferros-baix-llobregat')
				const hostalCompany = companyMap.get('hostal-pirineu')
				const tancamentsCompany = companyMap.get('tancaments-garraf')
				const calendarEventSeeds = [
					// Email-sourced Zoom invite 3 days out — exercises the URL
					// extractor fallback and the "from email" badge.
					{
						source: 'email',
						provider: 'email',
						providerBookingId: null,
						icalUid: 'zoom-seed-1@calendar.batuda',
						icalSequence: 0,
						eventTypeId: null,
						startAt: new Date(now + 3 * calDay),
						endAt: new Date(now + 3 * calDay + 30 * 60 * 1000),
						status: 'confirmed',
						title: 'Zoom sync with Cal Pep',
						locationType: 'video',
						locationValue: 'https://acme.zoom.us/j/1234567890',
						videoCallUrl: 'https://acme.zoom.us/j/1234567890',
						organizerEmail: 'organizer@externo.com',
						companyId: calcomCompany ?? null,
						contactId: null,
						interactionId: null,
						metadata: null,
						rawIcs: null,
					},
					// Teams invite 5 days out.
					{
						source: 'email',
						provider: 'email',
						providerBookingId: null,
						icalUid: 'teams-seed-1@calendar.batuda',
						icalSequence: 0,
						eventTypeId: null,
						startAt: new Date(now + 5 * calDay),
						endAt: new Date(now + 5 * calDay + 60 * 60 * 1000),
						status: 'confirmed',
						title: 'Teams review — Ferros BL',
						locationType: 'video',
						locationValue: 'Microsoft Teams Meeting',
						videoCallUrl: 'https://teams.microsoft.com/l/meetup-join/abc',
						organizerEmail: 'pm@ferros-bl.cat',
						companyId: ferrosCompany ?? null,
						contactId: null,
						interactionId: null,
						metadata: null,
						rawIcs: null,
					},
					// Google Meet invite 7 days out.
					{
						source: 'email',
						provider: 'email',
						providerBookingId: null,
						icalUid: 'meet-seed-1@calendar.batuda',
						icalSequence: 0,
						eventTypeId: null,
						startAt: new Date(now + 7 * calDay),
						endAt: new Date(now + 7 * calDay + 30 * 60 * 1000),
						status: 'confirmed',
						title: 'Meet — Hostal Pirineu booking flow',
						locationType: 'video',
						locationValue: 'https://meet.google.com/abc-defg-hij',
						videoCallUrl: 'https://meet.google.com/abc-defg-hij',
						organizerEmail: 'owner@hostal-pirineu.cat',
						companyId: hostalCompany ?? null,
						contactId: null,
						interactionId: null,
						metadata: null,
						rawIcs: null,
					},
					// Upcoming cal.com booking — exercises source='booking' path.
					{
						source: 'booking',
						provider: 'calcom',
						providerBookingId: 'seed-cal-booking-1',
						icalUid: 'seed-cal-1@calendar.batuda',
						icalSequence: 0,
						eventTypeId: discoveryType?.id ?? null,
						startAt: new Date(now + 2 * calDay),
						endAt: new Date(now + 2 * calDay + 30 * 60 * 1000),
						status: 'confirmed',
						title: 'Discovery call — Tancaments Garraf',
						locationType: 'video',
						locationValue: null,
						videoCallUrl: 'https://cal.com/video/seed-cal-booking-1',
						organizerEmail: TEST_USER.email,
						companyId: tancamentsCompany ?? null,
						contactId: null,
						interactionId: null,
						metadata: { source: 'batuda' },
						rawIcs: null,
					},
					// Cancelled booking — keeps the row for audit.
					{
						source: 'booking',
						provider: 'calcom',
						providerBookingId: 'seed-cal-booking-2',
						icalUid: 'seed-cal-2@calendar.batuda',
						icalSequence: 1,
						eventTypeId: discoveryType?.id ?? null,
						startAt: new Date(now + 4 * calDay),
						endAt: new Date(now + 4 * calDay + 30 * 60 * 1000),
						status: 'cancelled',
						title: 'Discovery call — Ferros BL (cancelled)',
						locationType: 'video',
						locationValue: null,
						videoCallUrl: null,
						organizerEmail: TEST_USER.email,
						companyId: ferrosCompany ?? null,
						contactId: null,
						interactionId: null,
						metadata: { cancelledReason: 'prospect_rescheduled' },
						rawIcs: null,
					},
					// Internal focus block — no company, no attendees.
					{
						source: 'internal',
						provider: 'internal',
						providerBookingId: null,
						icalUid: `internal-seed-1-${randomUUID()}@calendar.batuda`,
						icalSequence: 0,
						eventTypeId: internalType?.id ?? null,
						startAt: new Date(now + 1 * calDay),
						endAt: new Date(now + 1 * calDay + 90 * 60 * 1000),
						status: 'confirmed',
						title: 'Deep work — proposal draft',
						locationType: 'none',
						locationValue: null,
						videoCallUrl: null,
						organizerEmail: TEST_USER.email,
						companyId: null,
						contactId: null,
						interactionId: null,
						metadata: null,
						rawIcs: null,
					},
				]
				const insertedCalendarEvents = yield* sql<{
					id: string
					source: string
					title: string
				}>`
			INSERT INTO calendar_events ${sql.insert(normalizeRows(stamp(calendarEventSeeds)))}
			RETURNING id, source, title
		`
				// Attendees for the four non-internal events. One organizer +
				// one attendee each so the sidebar shows "with N".
				const attendeeRows = insertedCalendarEvents
					.filter(e => e.source !== 'internal')
					.flatMap(e => [
						{
							eventId: e.id,
							email: TEST_USER.email,
							name: TEST_USER.name,
							contactId: null,
							companyId: null,
							rsvp: 'accepted',
							isOrganizer: e.source === 'booking',
						},
						{
							eventId: e.id,
							email:
								e.source === 'email'
									? 'organizer@externo.com'
									: 'prospect@example.com',
							name: null,
							contactId: null,
							companyId: null,
							rsvp: e.source === 'email' ? 'needs-action' : 'accepted',
							isOrganizer: e.source === 'email',
						},
					])
				if (attendeeRows.length > 0) {
					yield* sql`
				INSERT INTO calendar_event_attendees ${sql.insert(normalizeRows(stamp(attendeeRows)))}
			`
				}
				// A handful of task_events so the undo drawer in /tasks has
				// audit rows to render for the first few seeded tasks.
				const taskEventRows = insertedTasks.slice(0, 3).map(t => ({
					taskId: t.id,
					actorId: null,
					actorKind: 'user',
					change: { kind: 'created', snapshot: { title: t.title } },
				}))
				if (taskEventRows.length > 0) {
					yield* sql`INSERT INTO task_events ${sql.insert(normalizeRows(stamp(taskEventRows)))}`
				}
				yield* Effect.logInfo(
					`  ${insertedCalendarEvents.length} events, ${attendeeRows.length} attendees, ${taskEventRows.length} task events`,
				)

				// 6. Research policy
				yield* Effect.logInfo('Seeding research policy...')
				const [testUser] = yield* sql<{
					id: string
				}>`SELECT id FROM "user" WHERE email = ${TEST_USER.email} LIMIT 1`
				if (testUser) {
					yield* sql`INSERT INTO user_research_policy ${sql.insert([
						{
							userId: testUser.id,
							budgetCents: 100,
							paidBudgetCents: 500,
							autoApprovePaidCents: 200,
							paidMonthlyCapCents: 2000,
						},
					])} ON CONFLICT (user_id) DO NOTHING`
					yield* Effect.logInfo(`  policy: user ${testUser.id}`)
				} else {
					yield* Effect.logInfo(
						'  (skipped — auth user not found, run seed auth first)',
					)
				}

				// Inboxes — one human + one agent per demo org. The dev compose
				// stack runs Mailpit at localhost:1025 (SMTP) / 1143 (IMAP); each
				// inbox is wired to it with security='plain'. Credentials are
				// AES-256-GCM via the HKDF-SHA256 per-inbox-subkey scheme
				// (apps/server/src/services/credential-crypto.ts) — the same one
				// the worker decrypts with at runtime.
				const masterKeyB64 = yield* Config.string('EMAIL_CREDENTIAL_KEY')
				const masterKey = Buffer.from(masterKeyB64, 'base64')
				if (masterKey.length !== 32) {
					return yield* Effect.fail(
						new Error(
							'EMAIL_CREDENTIAL_KEY must be a base64 string decoding to 32 bytes. Run `pnpm cli setup` or check apps/cli/.env.',
						),
					)
				}

				const restaurantOrgRow = yield* sql<{
					id: string
				}>`SELECT id FROM "organization" WHERE slug = 'restaurant' LIMIT 1`
				const restaurantOrgIdForInbox = restaurantOrgRow[0]?.id ?? null

				interface InboxSpec {
					readonly email: string
					readonly displayName: string
					readonly ownerEmail: string
					readonly orgId: string
					readonly purpose: 'human' | 'agent'
					readonly isDefault: boolean
					readonly footerText: string
				}

				const inboxSpecs: InboxSpec[] = [
					{
						email: 'admin@taller.cat',
						displayName: 'Alice Admin',
						ownerEmail: 'admin@taller.cat',
						orgId: tallerOrgId,
						purpose: 'human',
						isDefault: true,
						footerText: '— Alice Admin\nTaller Demo · taller.cat',
					},
					{
						email: 'agent@taller.cat',
						displayName: 'Alice Agent',
						ownerEmail: 'admin@taller.cat',
						orgId: tallerOrgId,
						purpose: 'agent',
						isDefault: false,
						footerText: "Automated response from Alice's agent.",
					},
				]
				if (restaurantOrgIdForInbox) {
					inboxSpecs.push(
						{
							email: 'admin@restaurant.demo',
							displayName: 'Bob Owner',
							ownerEmail: 'admin@restaurant.demo',
							orgId: restaurantOrgIdForInbox,
							purpose: 'human',
							isDefault: true,
							footerText: '— Bob Owner\nRestaurant Demo',
						},
						{
							email: 'agent@restaurant.demo',
							displayName: 'Bob Agent',
							ownerEmail: 'admin@restaurant.demo',
							orgId: restaurantOrgIdForInbox,
							purpose: 'agent',
							isDefault: false,
							footerText: "Automated response from Bob's agent.",
						},
					)
				}

				const ownerEmails = [...new Set(inboxSpecs.map(s => s.ownerEmail))]
				const ownerRows = yield* sql<{
					id: string
					email: string
				}>`SELECT id, email FROM "user" WHERE email = ANY(${ownerEmails as string[]})`
				const userIdByEmail = new Map(ownerRows.map(r => [r.email, r.id]))

				interface SeededInbox {
					readonly id: string
					readonly email: string
					readonly orgId: string
				}
				const seededInboxes: SeededInbox[] = []

				for (const spec of inboxSpecs) {
					const ownerId = userIdByEmail.get(spec.ownerEmail)
					if (!ownerId) {
						yield* Effect.logInfo(
							`  (skipped inbox ${spec.email} — owner not found, run seed auth first)`,
						)
						continue
					}
					const inboxId = randomUUID()
					const subkey = Buffer.from(
						hkdfSync(
							'sha256',
							masterKey,
							Buffer.alloc(0),
							Buffer.from(inboxId, 'utf8'),
							32,
						),
					)
					const nonce = randomBytes(12)
					const cipher = createCipheriv('aes-256-gcm', subkey, nonce)
					const ciphertext = Buffer.concat([
						cipher.update('demo-imap-password', 'utf8'),
						cipher.final(),
					])
					const tag = cipher.getAuthTag()
					yield* sql`
				INSERT INTO inboxes ${sql.insert({
					id: inboxId,
					organizationId: spec.orgId,
					email: spec.email,
					displayName: spec.displayName,
					purpose: spec.purpose,
					ownerUserId: ownerId,
					isDefault: spec.isDefault,
					isPrivate: false,
					active: true,
					imapHost: 'localhost',
					imapPort: 1143,
					imapSecurity: 'plain',
					smtpHost: 'localhost',
					smtpPort: 1025,
					smtpSecurity: 'plain',
					username: spec.email,
					passwordCiphertext: ciphertext,
					passwordNonce: nonce,
					passwordTag: tag,
					grantStatus: 'connected',
				})}
			`
					yield* sql`
				INSERT INTO inbox_footers ${sql.insert({
					organizationId: spec.orgId,
					inboxId,
					name: 'default',
					bodyJson: JSON.stringify([
						{
							type: 'paragraph',
							spans: [{ kind: 'text', value: spec.footerText }],
						},
					]),
					isDefault: true,
				})}
			`
					yield* Effect.logInfo(
						`  inbox: ${spec.email} (${spec.purpose}, owner ${ownerId})`,
					)
					seededInboxes.push({
						id: inboxId,
						email: spec.email,
						orgId: spec.orgId,
					})
				}

				// Demo messages — direct INSERT into email_messages + thread_links
				// + message_participants, with per-attachment objects uploaded to
				// MinIO so the chip download path resolves to real bytes. We
				// don't go through the mail-worker IMAP-fetch path because the
				// dev compose stack ships Mailpit, which speaks SMTP/POP3/HTTP
				// but not IMAP — so no fixture data could ever be ingested.
				// `pnpm cli email inject` and the e2e SMTP helper still target
				// Mailpit for outbound assertions; only inbound seeding is
				// direct.
				const tallerHuman = seededInboxes.find(
					i => i.email === 'admin@taller.cat',
				)
				const tallerAgent = seededInboxes.find(
					i => i.email === 'agent@taller.cat',
				)
				const restaurantHuman = seededInboxes.find(
					i => i.email === 'admin@restaurant.demo',
				)
				const restaurantAgent = seededInboxes.find(
					i => i.email === 'agent@restaurant.demo',
				)

				// One S3 client for the seed's attachment uploads. Same
				// credentials the worker uses; sibling-of-raw-RFC822 keys.
				const seedStorageEndpoint = yield* Config.string('STORAGE_ENDPOINT')
				const seedStorageRegion = yield* Config.string('STORAGE_REGION')
				const seedStorageAccessKeyId = yield* Config.string(
					'STORAGE_ACCESS_KEY_ID',
				)
				const seedStorageSecretAccessKey = yield* Config.redacted(
					'STORAGE_SECRET_ACCESS_KEY',
				)
				const seedStorageBucket = yield* Config.string('STORAGE_BUCKET')
				const seedS3 = new S3Client({
					endpoint: seedStorageEndpoint,
					region: seedStorageRegion,
					credentials: {
						accessKeyId: seedStorageAccessKeyId,
						secretAccessKey: Redacted.value(seedStorageSecretAccessKey),
					},
					forcePathStyle: true,
				})

				interface SeedAttachment {
					readonly filename: string
					readonly contentType: string
					readonly content: Buffer
				}

				interface SeedMessageArgs {
					readonly inbox: SeededInbox
					readonly threadRootMessageId: string
					readonly threadSubject: string
					readonly messageId: string
					readonly fromAddress: string
					readonly toAddresses: readonly string[]
					readonly ccAddresses?: readonly string[]
					readonly subject: string
					readonly textBody?: string
					readonly htmlBody?: string
					readonly inReplyTo?: string
					readonly references?: readonly string[]
					readonly attachments?: readonly SeedAttachment[]
					readonly receivedAt?: Date
					readonly inboundClassification?: 'normal' | 'spam'
					readonly direction?: 'inbound' | 'outbound'
					readonly folder?: string
				}

				// Slug a Message-ID into something object-storage friendly. The
				// resulting key sits under `messages/<org>/<inbox>/seed/<slug>/`
				// so it's clearly distinguishable from worker-written keys
				// (which use `<uidvalidity>/<uid>` numeric segments).
				const slugMessageId = (id: string): string =>
					id.replace(/[<>@]/g, '').replace(/[^A-Za-z0-9._-]/g, '-')

				const insertSeedMessage = (args: SeedMessageArgs) =>
					Effect.gen(function* () {
						yield* sql`
					INSERT INTO email_thread_links ${sql.insert({
						organizationId: args.inbox.orgId,
						inboxId: args.inbox.id,
						externalThreadId: args.threadRootMessageId,
						subject: args.threadSubject,
					})}
					ON CONFLICT (organization_id, external_thread_id) DO NOTHING
				`

						const slug = slugMessageId(args.messageId)
						const rawRfc822Ref = `messages/${args.inbox.orgId}/${args.inbox.id}/seed/${slug}.eml`

						const attachmentsMeta: Array<{
							index: number
							filename: string
							contentType: string
							sizeBytes: number
							cid: string | null
							isInline: boolean
							storageKey: string
						}> = []
						if (args.attachments) {
							for (let i = 0; i < args.attachments.length; i++) {
								const a = args.attachments[i]!
								const storageKey = `messages/${args.inbox.orgId}/${args.inbox.id}/seed/${slug}/attachment-${i}.bin`
								yield* Effect.tryPromise({
									try: () =>
										seedS3.send(
											new PutObjectCommand({
												Bucket: seedStorageBucket,
												Key: storageKey,
												Body: a.content,
												ContentType: a.contentType,
											}),
										),
									catch: e =>
										new Error(
											`seed attachment upload failed for ${storageKey}: ${e instanceof Error ? e.message : String(e)}`,
										),
								})
								attachmentsMeta.push({
									index: i,
									filename: a.filename,
									contentType: a.contentType,
									sizeBytes: a.content.length,
									cid: null,
									isInline: false,
									storageKey,
								})
							}
						}

						const dbMessageRow: Record<string, unknown> = {
							organizationId: args.inbox.orgId,
							inboxId: args.inbox.id,
							messageId: args.messageId,
							inReplyTo: args.inReplyTo ?? null,
							references: args.references ?? [],
							direction: args.direction ?? 'inbound',
							folder: args.folder ?? 'INBOX',
							rawRfc822Ref,
							subject: args.subject,
							receivedAt: args.receivedAt ?? new Date(),
							textBody: args.textBody ?? null,
							htmlBody: args.htmlBody ?? null,
							textPreview:
								args.textBody !== undefined
									? args.textBody.slice(0, 200)
									: null,
							recipients: JSON.stringify({
								to: args.toAddresses,
								cc: args.ccAddresses ?? [],
								bcc: [],
							}),
							attachments: JSON.stringify(attachmentsMeta),
							status: 'normal',
							inboundClassification: args.inboundClassification ?? null,
						}
						const insertedRows = yield* sql<{ id: string }>`
					INSERT INTO email_messages ${sql.insert(dbMessageRow)}
					RETURNING id
				`
						const inserted = insertedRows[0]
						if (!inserted) return

						type Participant = {
							emailMessageId: string
							emailAddress: string
							role: string
						}
						const participants: Participant[] = [
							{
								emailMessageId: inserted.id,
								emailAddress: args.fromAddress.toLowerCase(),
								role: 'from',
							},
							...args.toAddresses.map(addr => ({
								emailMessageId: inserted.id,
								emailAddress: addr.toLowerCase(),
								role: 'to',
							})),
							...(args.ccAddresses ?? []).map(addr => ({
								emailMessageId: inserted.id,
								emailAddress: addr.toLowerCase(),
								role: 'cc',
							})),
						]
						yield* sql`
					INSERT INTO message_participants ${sql.insert(participants)}
					ON CONFLICT DO NOTHING
				`
					})

				if (tallerHuman) {
					const m1Id = '<m1-quote@calpepfonda.cat>'
					const m2Id = '<m2-quote-followup@calpepfonda.cat>'
					const m3Id = '<m3-kickoff@ferrosbl.com>'
					const m8Id = '<m8-vendor-quote@example.com>'
					const m9Id = `<m9-${randomUUID()}@taller.cat>`
					const m12Id = `<m12-${randomUUID()}@scam.example>`

					// M1 — thread root, plain text
					yield* insertSeedMessage({
						inbox: tallerHuman,
						threadRootMessageId: m1Id,
						threadSubject: 'Quote for the booking module',
						messageId: m1Id,
						fromAddress: 'pep@calpepfonda.cat',
						toAddresses: ['admin@taller.cat'],
						subject: 'Quote for the booking module',
						textBody:
							'Hola Alice,\n\nM’agradaria saber el preu del mòdul de reserves.\n\nGràcies,\nPep',
						receivedAt: new Date('2026-04-30T09:00:00Z'),
					})
					// M2 — Pep replies, threads with M1
					yield* insertSeedMessage({
						inbox: tallerHuman,
						threadRootMessageId: m1Id,
						threadSubject: 'Quote for the booking module',
						messageId: m2Id,
						fromAddress: 'pep@calpepfonda.cat',
						toAddresses: ['admin@taller.cat'],
						subject: 'Re: Quote for the booking module',
						textBody:
							'Una pregunta més: també suporta cancel·lacions automàtiques?\n\nPep',
						inReplyTo: m1Id,
						references: [m1Id],
						receivedAt: new Date('2026-05-01T10:30:00Z'),
					})
					// M3 — rich HTML body, with Cc so the thread-render Cc-toggle
					// path has data to reveal.
					yield* insertSeedMessage({
						inbox: tallerHuman,
						threadRootMessageId: m3Id,
						threadSubject: 'Project kickoff materials',
						messageId: m3Id,
						fromAddress: 'kickoff@ferrosbl.com',
						toAddresses: ['admin@taller.cat'],
						ccAddresses: ['marta@ferrosbl.com'],
						subject: 'Project kickoff materials',
						textBody:
							'Hi Alice,\n\nQuick recap of kickoff items:\n- Stakeholder list\n- Booking flow walkthrough\n\nAgenda link: https://taller.cat/kickoff',
						htmlBody:
							'<p>Hi Alice,</p>' +
							'<p>Quick recap of <strong>kickoff items</strong>:</p>' +
							'<ul><li>Stakeholder list</li><li>Booking flow walkthrough</li></ul>' +
							'<p><a href="https://taller.cat/kickoff">Agenda link</a></p>',
						receivedAt: new Date('2026-05-01T14:00:00Z'),
					})
					// M8 — multi-attachment vendor quote (real PDF + PNG bytes)
					yield* insertSeedMessage({
						inbox: tallerHuman,
						threadRootMessageId: m8Id,
						threadSubject: 'Vendor quote — final',
						messageId: m8Id,
						fromAddress: 'vendor@example.com',
						toAddresses: ['admin@taller.cat'],
						subject: 'Vendor quote — final',
						textBody: 'See attached.',
						attachments: [
							{
								filename: 'quote.pdf',
								contentType: 'application/pdf',
								content: TINY_PDF,
							},
							{
								filename: 'logo.png',
								contentType: 'image/png',
								content: ONE_PIXEL_PNG,
							},
						],
						receivedAt: new Date('2026-05-02T09:15:00Z'),
					})

					// M9 — Alice's outbound reply on the booking-module thread.
					yield* insertSeedMessage({
						inbox: tallerHuman,
						threadRootMessageId: m1Id,
						threadSubject: 'Quote for the booking module',
						messageId: m9Id,
						fromAddress: 'admin@taller.cat',
						toAddresses: ['pep@calpepfonda.cat'],
						subject: 'Re: Quote for the booking module',
						textBody:
							'Hi Pep,\n\nAttached is the quote for the booking module. Let me know what you think.\n\nAlice',
						inReplyTo: m1Id,
						references: [m1Id],
						direction: 'outbound',
						folder: 'Sent',
						receivedAt: new Date('2026-05-02T11:00:00Z'),
					})

					// M12 — standalone spam-classified inbound.
					yield* insertSeedMessage({
						inbox: tallerHuman,
						threadRootMessageId: m12Id,
						threadSubject: 'URGENT: wire transfer needed',
						messageId: m12Id,
						fromAddress: 'finance@scam.example',
						toAddresses: ['admin@taller.cat'],
						subject: 'URGENT: wire transfer needed',
						textBody:
							'Dear customer, please wire €5000 to the account below within 24 hours.',
						inboundClassification: 'spam',
						receivedAt: new Date('2026-05-03T08:00:00Z'),
					})

					yield* Effect.logInfo(
						'  taller human: M1+M2 (thread), M3 (rich+Cc), M8 (2 attachments), M9 (outbound), M12 (spam)',
					)
				}
				if (tallerAgent) {
					const m4Id = '<m4-photos@hostalpirineu.com>'
					yield* insertSeedMessage({
						inbox: tallerAgent,
						threadRootMessageId: m4Id,
						threadSubject: 'Visit photos attached',
						messageId: m4Id,
						fromAddress: 'photos@hostalpirineu.com',
						toAddresses: ['agent@taller.cat'],
						subject: 'Visit photos attached',
						textBody: "Hi, photos from yesterday's visit attached.",
						attachments: [
							{
								filename: 'photo.png',
								contentType: 'image/png',
								content: ONE_PIXEL_PNG,
							},
						],
						receivedAt: new Date('2026-05-02T16:30:00Z'),
					})
					yield* Effect.logInfo('  taller agent: M4 (single attachment)')
				}
				if (restaurantHuman) {
					const m5Id = '<m5-welcome@batuda.dev>'
					const m6Id = '<m6-welcome-followup@batuda.dev>'
					yield* insertSeedMessage({
						inbox: restaurantHuman,
						threadRootMessageId: m5Id,
						threadSubject: 'Welcome to Batuda',
						messageId: m5Id,
						fromAddress: 'noreply@batuda.dev',
						toAddresses: ['admin@restaurant.demo'],
						subject: 'Welcome to Batuda',
						textBody:
							'Welcome Bob! Reply when ready and we’ll set up your first inbox.',
						receivedAt: new Date('2026-05-01T09:00:00Z'),
					})
					yield* insertSeedMessage({
						inbox: restaurantHuman,
						threadRootMessageId: m5Id,
						threadSubject: 'Welcome to Batuda',
						messageId: m6Id,
						fromAddress: 'noreply@batuda.dev',
						toAddresses: ['admin@restaurant.demo'],
						subject: 'Re: Welcome to Batuda',
						textBody: 'Quick follow-up — let me know if anything is unclear.',
						inReplyTo: m5Id,
						references: [m5Id],
						receivedAt: new Date('2026-05-01T15:00:00Z'),
					})
					yield* Effect.logInfo('  restaurant human: M5+M6 (thread)')
				}
				if (restaurantAgent) {
					const m7Id = '<m7-ooo@example.com>'
					yield* insertSeedMessage({
						inbox: restaurantAgent,
						threadRootMessageId: m7Id,
						threadSubject: 'Out of office',
						messageId: m7Id,
						fromAddress: 'support@example.com',
						toAddresses: ['agent@restaurant.demo'],
						subject: 'Out of office',
						textBody: 'Out today, back Monday.',
						receivedAt: new Date('2026-05-02T07:00:00Z'),
					})
					yield* Effect.logInfo('  restaurant agent: M7 (single)')
				}

				yield* Effect.logInfo('Demo emails seeded — open /emails to see them.')

				// Full preset extras
				if (preset === 'full') {
					// 6. Documents
					yield* Effect.logInfo('Seeding documents...')
					yield* sql`INSERT INTO documents ${sql.insert(
						normalizeRows(
							stamp([
								{
									companyId: companyMap.get('cal-pep-fonda')!,
									interactionId: insertedInteractions[0]?.id,
									type: 'prenote',
									title: 'Visit prep — Cal Pep',
									content:
										'## Goal\nSee the restaurant, understand current booking flow.\n\n## Questions\n- How many covers per service?\n- Do they take reservations via WhatsApp or phone?\n- Do they have a website?',
								},
								{
									companyId: companyMap.get('cal-pep-fonda')!,
									interactionId: insertedInteractions[0]?.id,
									type: 'postnote',
									title: 'Visit summary — Cal Pep',
									content:
										"## Summary\n60 covers, 2 services/day. Phone-only reservations — they lose ~15% of walk-ups who won't wait.\n\n## Decision\nWants website + booking. Budget approved up to 1500 EUR.",
								},
								{
									companyId: companyMap.get('ferros-baix-llobregat')!,
									interactionId: null,
									type: 'research',
									title: 'Company analysis — Ferros BL',
									content:
										'## Company\n40 employees, 2 warehouses in Cornellà. Revenue ~3M EUR/year.\n\n## Pain points detected\n- Manual invoicing: 2 days/month\n- Transcription errors: ~5% of invoices\n- No real-time stock control',
								},
								{
									companyId: companyMap.get('hostal-pirineu')!,
									interactionId: insertedInteractions[5]?.id,
									type: 'visit_notes',
									title: 'Visit notes — Hostal Pirineu',
									content:
										'## Context\n12 rooms, high season June–September + ski December–March.\n\n## Commissions\nBooking: 15–18%. They want to drop below 5% with a direct channel.\n\n## Requirements\n- Availability calendar\n- Upfront payment (Stripe/Redsys)\n- Multi-language: ca, es, fr',
								},
								{
									companyId: companyMap.get('tancaments-garraf')!,
									interactionId: null,
									type: 'call_notes',
									title: 'Demo debrief — Tancaments Garraf',
									content:
										'## Attendees\nRamon Vila (owner), Oriol Camps (project manager)\n\n## Key points\n- Currently tracking 12 concurrent projects in shared Google Sheets\n- Lost a client last month due to a missed deadline nobody saw in the spreadsheet\n- Want a dashboard with alerts per project phase\n\n## Objections\n- Worried about migration effort from existing sheets\n- Need offline access for site visits',
								},
								{
									companyId: companyMap.get('distribuciones-martinez')!,
									interactionId: null,
									type: 'general',
									title: 'Competitor landscape — logistics in Alzira',
									content:
										'## Notes\nNo direct competitor offering digital delivery notes in this area.\nClosest: a Valencia-based firm doing fleet GPS, but not document digitisation.\n\n## Opportunity\nFirst-mover advantage if we land Distribuciones Martínez as a reference client.',
								},
							]),
						),
					)}`

					// 7. Proposals
					yield* Effect.logInfo('Seeding proposals...')
					const productMap = new Map(insertedProducts.map(p => [p.slug, p.id]))
					yield* sql`INSERT INTO proposals ${sql.insert(
						normalizeRows(
							stamp([
								{
									companyId: companyMap.get('cal-pep-fonda')!,
									contactId: contactMap.get('Pep Casals'),
									status: 'accepted',
									title: 'Web + Booking — Cal Pep Fonda',
									lineItems: JSON.stringify([
										{
											product_id: productMap.get('web-starter'),
											qty: 1,
											price: '990.00',
											notes: 'Responsive website with local SEO',
										},
										{
											product_id: productMap.get('gestio-reserves'),
											qty: 12,
											price: '49.00',
											notes: '12 months booking management',
										},
									]),
									totalValue: '1578.00',
									sentAt: new Date('2026-02-22'),
									respondedAt: new Date('2026-02-25'),
									notes: 'Accepted by phone. Project start March 1st.',
								},
								{
									companyId: companyMap.get('ferros-baix-llobregat')!,
									contactId: contactMap.get('Jordi Puig'),
									status: 'draft',
									title: 'Invoicing automation — Ferros BL',
									lineItems: JSON.stringify([
										{
											product_id: productMap.get('automatitzacions'),
											qty: 1,
											price: '1500.00',
											notes: 'Initial setup + Contaplus integration',
										},
									]),
									totalValue: '1500.00',
									sentAt: null,
									respondedAt: null,
									notes: 'Pending on-site meeting to finalise details.',
								},
								{
									companyId: companyMap.get('hostal-pirineu')!,
									contactId: contactMap.get('Arnau Ribas'),
									status: 'sent',
									title: 'Direct booking system — Hostal del Pirineu',
									lineItems: JSON.stringify([
										{
											product_id: productMap.get('web-starter'),
											qty: 1,
											price: '990.00',
											notes: 'Multi-language site (ca/es/fr)',
										},
										{
											product_id: productMap.get('gestio-reserves'),
											qty: 12,
											price: '49.00',
											notes: 'Booking engine, 12 months',
										},
									]),
									totalValue: '1578.00',
									sentAt: new Date('2026-04-06'),
									expiresAt: new Date('2026-05-06'),
									notes: 'Sent after the on-site visit. Waiting for reply.',
								},
								{
									companyId: companyMap.get('bright-lane-boutique')!,
									contactId: contactMap.get('Sarah Mitchell'),
									status: 'viewed',
									title: 'Ecommerce setup — Bright Lane Boutique',
									lineItems: JSON.stringify([
										{
											product_id: productMap.get('ecommerce-local'),
											qty: 1,
											price: '2500.00',
											notes: 'Online store with Instagram Shop integration',
										},
										{
											product_id: productMap.get('web-starter'),
											qty: 1,
											price: '990.00',
											notes: 'Landing page + SEO',
										},
										{
											product_id: productMap.get('social-media-pack'),
											qty: 3,
											price: '300.00',
											notes: '3 months social media management',
										},
									]),
									totalValue: '4390.00',
									sentAt: new Date('2026-04-01'),
									expiresAt: new Date('2026-04-30'),
									notes: 'Sarah opened the proposal link on April 3rd.',
								},
								{
									companyId: companyMap.get('tancaments-garraf')!,
									contactId: contactMap.get('Ramon Vila'),
									status: 'negotiating',
									title: 'Project management automation — Tancaments Garraf',
									lineItems: JSON.stringify([
										{
											product_id: productMap.get('automatitzacions'),
											qty: 1,
											price: '1500.00',
											notes: 'Google Sheets to dashboard migration',
										},
										{
											product_id: productMap.get('web-starter'),
											qty: 1,
											price: '990.00',
											notes: 'Corporate website refresh',
										},
										{
											product_id: productMap.get('consultoria-custom'),
											qty: 1,
											price: '800.00',
											notes: 'Discovery + custom workflow mapping',
										},
										{
											product_id: productMap.get('consultoria-custom'),
											qty: 1,
											price: '600.00',
											notes: 'Staff training (2 sessions)',
										},
										{
											product_id: productMap.get('gestio-reserves'),
											qty: 6,
											price: '49.00',
											notes: '6 months appointment scheduling pilot',
										},
									]),
									totalValue: '4184.00',
									sentAt: new Date('2026-04-08'),
									expiresAt: new Date('2026-05-08'),
									notes: 'Ramon wants to reduce scope. Negotiating line items.',
								},
								{
									companyId: companyMap.get('park-stone-design')!,
									contactId: null,
									status: 'rejected',
									title: 'Website redesign — Park & Stone Design',
									lineItems: JSON.stringify([
										{
											product_id: productMap.get('web-starter'),
											qty: 1,
											price: '990.00',
											notes: 'Portfolio website',
										},
									]),
									totalValue: '990.00',
									sentAt: new Date('2026-02-18'),
									respondedAt: new Date('2026-02-20'),
									notes: 'Already had a web provider. Polite decline.',
								},
								{
									companyId: companyMap.get('coastal-freight')!,
									contactId: contactMap.get('Tom Parker'),
									status: 'expired',
									title: 'Delivery note digitisation — Coastal Freight',
									lineItems: JSON.stringify([
										{
											product_id: productMap.get('automatitzacions'),
											qty: 1,
											price: '1500.00',
											notes: 'Paper to digital workflow',
										},
									]),
									totalValue: '1500.00',
									currency: 'USD',
									sentAt: new Date('2026-02-01'),
									expiresAt: new Date('2026-03-01'),
									notes: 'Tom never responded. Proposal expired.',
								},
							]),
						),
					)}`

					// 8. Pages
					yield* Effect.logInfo('Seeding pages...')
					const pageRows = [
						// ── Published pages ──
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
								ogDescription:
									'Sistema de reserves online per al teu restaurant.',
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
								ogDescription:
									'Sistema de reservas online para tu restaurante.',
							}),
							publishedAt: new Date('2026-03-01'),
							viewCount: 12,
						},
						// ── Draft pages ──
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
						// ── Case study (published, high views) ──
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
						// ── Intro page ──
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
											subheading:
												"Here's how we can help streamline your invoicing.",
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
						// ── Custom template page ──
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
											subheading:
												'One-person workshop. Mediterranean work ethic.',
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
								ogDescription:
									'One-person digital workshop for small businesses.',
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
											heading:
												'Construeixo eines digitals per a petits negocis',
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
								ogDescription:
									'Taller digital unipersonal per a petits negocis.',
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
								ogDescription:
									'Taller digital unipersonal para pequeños negocios.',
							}),
							publishedAt: new Date('2026-01-15'),
							viewCount: 76,
						},
						// ── Archived page ──
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
								ogDescription:
									'Limited time offer — 20% off Web Starter package.',
							}),
							publishedAt: new Date('2025-07-01'),
							expiresAt: new Date('2025-09-30'),
							viewCount: 2341,
						},
						// ── Page with expiry in the future ──
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
						// ── Product pitch for Hostal (multi-lang) ──
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
								ogDescription:
									'Direct reservation system for Hostal del Pirineu.',
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
											subheading:
												'El teu propi canal de reserves per menys del 5%.',
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

					// 10. Research runs + sources
					yield* Effect.logInfo('Seeding research runs & sources...')
					const researchRunRows = [
						{
							kind: 'leaf',
							query:
								'restaurants in Vilanova i la Geltrú looking for online booking',
							mode: 'deep',
							status: 'succeeded',
							context: JSON.stringify({
								industry: 'restauració',
								region: 'garraf',
							}),
							findings: JSON.stringify({
								summary:
									'Found 12 restaurants, 3 already have booking systems.',
								prospects: ['cal-pep-fonda', 'forn-de-pa-queralt'],
							}),
							briefMd:
								'## Results\nFound 12 restaurants in Vilanova. 3 already have online booking (TheFork, ElTenedor). 9 are phone-only — strong opportunity.\n\n### Top prospects\n1. Cal Pep Fonda — 60 covers, no web\n2. Forn de Pa Queralt — artisan bakery, Instagram only',
							budgetCents: 50,
							costCents: 35,
							tokensIn: 12400,
							tokensOut: 3200,
							createdBy: testUser?.id ?? 'seed',
							startedAt: new Date('2026-02-08T10:00:00Z'),
							completedAt: new Date('2026-02-08T10:02:30Z'),
						},
						{
							kind: 'leaf',
							query: 'industrial companies Baix Llobregat manual invoicing',
							mode: 'quick',
							status: 'failed',
							context: JSON.stringify({
								industry: 'manufactura',
								region: 'baix-llobregat',
							}),
							findings: JSON.stringify({}),
							briefMd: null,
							budgetCents: 30,
							costCents: 12,
							tokensIn: 4500,
							tokensOut: 800,
							createdBy: testUser?.id ?? 'seed',
							startedAt: new Date('2026-03-01T14:00:00Z'),
							completedAt: new Date('2026-03-01T14:00:45Z'),
						},
						{
							kind: 'leaf',
							query: 'ecommerce platforms for small retail in Barcelona',
							mode: 'deep',
							status: 'queued',
							context: JSON.stringify({
								industry: 'retail',
								region: 'barcelona',
							}),
							findings: JSON.stringify({}),
							budgetCents: 50,
							costCents: 0,
							tokensIn: 0,
							tokensOut: 0,
							createdBy: testUser?.id ?? 'seed',
						},
						{
							kind: 'leaf',
							query: 'logistics digitisation companies Maresme',
							mode: 'deep',
							status: 'running',
							context: JSON.stringify({
								industry: 'transport',
								region: 'maresme',
							}),
							findings: JSON.stringify({}),
							budgetCents: 40,
							costCents: 18,
							tokensIn: 8000,
							tokensOut: 0,
							createdBy: testUser?.id ?? 'seed',
							startedAt: new Date('2026-04-12T09:00:00Z'),
						},
						{
							kind: 'leaf',
							query: 'hostaleria Pirineu reserves directes',
							mode: 'quick',
							status: 'cancelled',
							context: JSON.stringify({
								industry: 'hostaleria',
								region: 'pirineu',
							}),
							findings: JSON.stringify({}),
							budgetCents: 20,
							costCents: 5,
							tokensIn: 2000,
							tokensOut: 400,
							createdBy: testUser?.id ?? 'seed',
							startedAt: new Date('2026-03-08T11:00:00Z'),
							completedAt: new Date('2026-03-08T11:00:20Z'),
						},
						{
							kind: 'leaf',
							query: 'ceramics ecommerce La Bisbal',
							mode: 'deep',
							status: 'deleted',
							context: JSON.stringify({ industry: 'manufactura' }),
							findings: JSON.stringify({}),
							budgetCents: 30,
							costCents: 0,
							tokensIn: 0,
							tokensOut: 0,
							createdBy: testUser?.id ?? 'seed',
						},
					]
					const insertedRuns = yield* sql<{
						id: string
						status: string
					}>`INSERT INTO research_runs ${sql.insert(normalizeRows(stamp(researchRunRows)))} RETURNING id, status`
					yield* Effect.logInfo(`  ${insertedRuns.length} research runs`)

					// Group run with children
					const groupRun = yield* sql<{
						id: string
					}>`INSERT INTO research_runs ${sql.insert(
						stamp([
							{
								kind: 'group',
								query: 'Full market scan: small businesses in Catalonia',
								mode: 'deep',
								status: 'succeeded',
								context: JSON.stringify({ scope: 'catalonia' }),
								findings: JSON.stringify({ childCount: 2 }),
								briefMd:
									'## Market scan\nGrouped 2 sub-queries covering restaurants and retail in Catalonia.',
								budgetCents: 100,
								costCents: 47,
								tokensIn: 16900,
								tokensOut: 4000,
								createdBy: testUser?.id ?? 'seed',
								startedAt: new Date('2026-02-05T09:00:00Z'),
								completedAt: new Date('2026-02-05T09:05:00Z'),
							},
						]),
					)} RETURNING id`
					yield* sql`INSERT INTO research_runs ${sql.insert(
						normalizeRows(
							stamp([
								{
									parentId: groupRun[0]!.id,
									kind: 'leaf',
									query: 'restaurants Catalonia without websites',
									mode: 'deep',
									status: 'succeeded',
									findings: JSON.stringify({ count: 45 }),
									briefMd:
										'Found 45 restaurants in Catalonia without a website or with outdated sites.',
									budgetCents: 50,
									costCents: 25,
									tokensIn: 9000,
									tokensOut: 2200,
									createdBy: testUser?.id ?? 'seed',
									startedAt: new Date('2026-02-05T09:00:30Z'),
									completedAt: new Date('2026-02-05T09:03:00Z'),
								},
								{
									parentId: groupRun[0]!.id,
									kind: 'followup',
									query: 'retail shops Barcelona Instagram-only',
									mode: 'deep',
									status: 'succeeded',
									findings: JSON.stringify({ count: 18 }),
									briefMd:
										'Found 18 retail shops in Barcelona selling only via Instagram DM.',
									budgetCents: 50,
									costCents: 22,
									tokensIn: 7900,
									tokensOut: 1800,
									createdBy: testUser?.id ?? 'seed',
									startedAt: new Date('2026-02-05T09:03:00Z'),
									completedAt: new Date('2026-02-05T09:05:00Z'),
								},
							]),
						),
					)}`
					yield* Effect.logInfo('  + 1 group with 2 children')

					// Sources
					yield* Effect.logInfo('Seeding sources...')
					yield* sql`INSERT INTO sources ${sql.insert(
						normalizeRows([
							{
								id: 'src_firecrawl_001',
								kind: 'web',
								provider: 'firecrawl',
								url: 'https://calpepfonda.cat',
								urlHash: 'fc_hash_001',
								domain: 'calpepfonda.cat',
								title: 'Cal Pep Fonda — Restaurant a Vilanova',
								language: 'ca',
								contentHash: 'sha256_aabbcc001',
								contentRef: 'sources/fc_001.md',
							},
							{
								id: 'src_exa_001',
								kind: 'web',
								provider: 'exa',
								url: 'https://coastalfreight.es/about',
								urlHash: 'exa_hash_001',
								domain: 'coastalfreight.es',
								title: 'Coastal Freight — About Us',
								language: 'en',
								contentHash: 'sha256_ddeeff001',
								contentRef: 'sources/exa_001.md',
							},
							{
								id: 'src_firecrawl_002',
								kind: 'web',
								provider: 'firecrawl',
								url: 'https://ceramiquesemporda.cat/taller',
								urlHash: 'fc_hash_002',
								domain: 'ceramiquesemporda.cat',
								title: 'Ceràmiques Empordà — El Taller',
								language: 'ca',
								contentHash: 'sha256_112233001',
								contentRef: 'sources/fc_002.md',
							},
							{
								id: 'src_registry_001',
								kind: 'registry',
								provider: 'libreborme',
								url: 'https://libreborme.net/borme/empresa/ferros-baix-llobregat/',
								urlHash: 'reg_hash_001',
								domain: 'libreborme.net',
								title: 'Ferros Baix Llobregat SL — libreBORME',
								language: 'es',
								contentHash: 'sha256_445566001',
								contentRef: 'sources/reg_001.json',
							},
							{
								id: 'src_report_001',
								kind: 'report',
								provider: 'einforma',
								url: 'https://einforma.com/reports/ferros-bl-basic',
								urlHash: 'rep_hash_001',
								domain: 'einforma.com',
								title: 'Basic report — Ferros BL',
								language: 'es',
								contentHash: 'sha256_778899001',
								contentRef: 'sources/rep_001.json',
							},
							{
								id: 'src_archive_001',
								kind: 'archive',
								provider: 'wayback',
								url: 'https://web.archive.org/web/2024/https://tancamentsgarraf.cat',
								urlHash: 'arc_hash_001',
								domain: 'web.archive.org',
								title: 'Archived — Tancaments Garraf (2024)',
								language: 'ca',
								contentHash: 'sha256_aabb11001',
								contentRef: 'sources/arc_001.html',
							},
						]),
					)}`
					yield* Effect.logInfo('  6 sources')

					// Provider quotas + usage
					if (testUser) {
						yield* Effect.logInfo('Seeding provider quotas & usage...')
						yield* sql`INSERT INTO provider_quotas ${sql.insert(
							normalizeRows([
								{
									userId: testUser.id,
									provider: 'firecrawl',
									billingModel: 'monthly_plan',
									syncMode: 'api',
									quotaTotal: 500,
									quotaUnit: 'credits',
									periodMonths: 1,
									periodAnchor: '2026-04-01',
									centsPerUnit: 0,
									warnAtPct: 80,
								},
								{
									userId: testUser.id,
									provider: 'exa',
									billingModel: 'monthly_plan',
									syncMode: 'api',
									quotaTotal: 1000,
									quotaUnit: 'searches',
									periodMonths: 1,
									periodAnchor: '2026-04-01',
									centsPerUnit: 0,
									warnAtPct: 80,
								},
								{
									userId: testUser.id,
									provider: 'einforma',
									billingModel: 'pay_per_call',
									syncMode: 'manual',
									quotaTotal: 10,
									quotaUnit: 'reports',
									periodMonths: 1,
									periodAnchor: '2026-04-01',
									centsPerUnit: 150,
									warnAtPct: 90,
								},
							]),
						)}`
						yield* sql`INSERT INTO provider_usage ${sql.insert(
							normalizeRows([
								{
									userId: testUser.id,
									provider: 'firecrawl',
									periodStart: '2026-04-01',
									unitsConsumed: 387,
								},
								{
									userId: testUser.id,
									provider: 'exa',
									periodStart: '2026-04-01',
									unitsConsumed: 142,
								},
								{
									userId: testUser.id,
									provider: 'exa',
									periodStart: '2026-03-01',
									unitsConsumed: 890,
								},
								{
									userId: testUser.id,
									provider: 'einforma',
									periodStart: '2026-04-01',
									unitsConsumed: 1,
								},
							]),
						)}`
						yield* Effect.logInfo('  3 quotas, 4 usage rows')
					}

					// Call recordings — mix of MinIO-uploaded + missing/deleted so the UI
					// exercises both "playable" and "file gone" paths. interaction_id is
					// UNIQUE, so we can only attach one recording per interaction; we
					// target the 6 phone/visit interactions seeded above.
					yield* Effect.logInfo('Seeding call recordings...')
					const phoneVisitRows = yield* sql<{
						id: string
						subject: string | null
					}>`SELECT id, subject FROM interactions WHERE channel IN ('phone', 'visit')`
					const idBySubject = new Map<string, string>()
					for (const row of phoneVisitRows) {
						if (row.subject) idBySubject.set(row.subject, row.id)
					}

					const storageEndpoint = yield* Config.string('STORAGE_ENDPOINT')
					const storageRegion = yield* Config.string('STORAGE_REGION')
					const storageAccessKeyId = yield* Config.string(
						'STORAGE_ACCESS_KEY_ID',
					)
					const storageSecretAccessKey = yield* Config.redacted(
						'STORAGE_SECRET_ACCESS_KEY',
					)
					const storageBucket = yield* Config.string('STORAGE_BUCKET')
					const s3 = new S3Client({
						endpoint: storageEndpoint,
						region: storageRegion,
						credentials: {
							accessKeyId: storageAccessKeyId,
							secretAccessKey: Redacted.value(storageSecretAccessKey),
						},
						forcePathStyle: true,
					})
					const wavBody = silentWav(0.1)

					type RecordingSpec = {
						subject: string
						companySlug: string
						upload: boolean
						durationSec: number
						transcriptStatus?: 'pending' | 'done' | 'failed'
						transcriptText?: string
						transcriptError?: string
						transcriptSegments?: unknown
						detectedLanguages?: unknown
						transcribedAt?: Date
						provider?: string
						providerRequestId?: string
						callerSpeakerId?: string
						deletedAt?: Date
					}

					const recordingSpecs: RecordingSpec[] = [
						// Uploaded, transcription not attempted (transcript_status = null).
						{
							subject: 'Visita al restaurant',
							companySlug: 'cal-pep-fonda',
							upload: true,
							durationSec: 240,
						},
						// Uploaded, transcription done with full text + language detected.
						{
							subject: 'Trucada amb gerent',
							companySlug: 'ferros-baix-llobregat',
							upload: true,
							durationSec: 1820,
							transcriptStatus: 'done',
							transcriptText:
								"Jordi Puig: Bon dia, gràcies per la trucada.\nComercial: Bon dia Jordi, tenim la proposta que comentàvem la setmana passada. Volia confirmar que les dates encaixen.\nJordi: Sí, d'acord, podem començar al maig.",
							transcribedAt: new Date('2026-03-15T10:42:00Z'),
							provider: 'whisper-large-v3',
							providerRequestId: 'wh_req_ferros_001',
							detectedLanguages: { primary: 'ca', confidence: 0.97 },
						},
						// Missing file, transcription stuck pending (the provider never
						// completed — exercises the "still working" spinner path).
						{
							subject: "Visita a l'hostal",
							companySlug: 'hostal-pirineu',
							upload: false,
							durationSec: 2700,
							transcriptStatus: 'pending',
							provider: 'whisper-large-v3',
							providerRequestId: 'wh_req_hostal_pending',
						},
						// Missing file, transcription failed with a provider error.
						{
							subject: 'Inbound call',
							companySlug: 'coastal-freight',
							upload: false,
							durationSec: 180,
							transcriptStatus: 'failed',
							transcriptError:
								'audio too quiet to transcribe (SNR < 3 dB on primary channel)',
							provider: 'whisper-large-v3',
							providerRequestId: 'wh_req_coastal_001',
						},
						// GDPR soft-delete — audio file purged, metadata kept for audit.
						{
							subject: 'Demo presencial a Sitges',
							companySlug: 'tancaments-garraf',
							upload: false,
							durationSec: 7200,
							deletedAt: new Date('2026-04-05T00:00:00Z'),
						},
						// Uploaded, transcription done with diarized segments + multi-lang.
						{
							subject: 'Seguiment post-demo',
							companySlug: 'hostal-pirineu',
							upload: true,
							durationSec: 1480,
							transcriptStatus: 'done',
							transcriptText:
								'Comercial: Hola Arnau, com ha anat la prova amb el personal?\nArnau Ribas: Bé, molt bé. A veure, té moltes funcions, ens anirà bé.',
							transcribedAt: new Date('2026-04-05T15:30:00Z'),
							provider: 'whisper-large-v3',
							providerRequestId: 'wh_req_hostal_002',
							callerSpeakerId: 'speaker_0',
							detectedLanguages: {
								primary: 'ca',
								secondary: 'es',
								confidence: 0.92,
							},
							transcriptSegments: [
								{
									start: 0,
									end: 3.2,
									speaker: 'speaker_0',
									text: 'Hola Arnau, com ha anat la prova amb el personal?',
								},
								{
									start: 3.2,
									end: 8.5,
									speaker: 'speaker_1',
									text: 'Bé, molt bé. A veure, té moltes funcions, ens anirà bé.',
								},
							],
						},
					]

					const recordingRows: Array<Record<string, unknown>> = []
					let uploadedCount = 0
					for (const spec of recordingSpecs) {
						const interactionId = idBySubject.get(spec.subject)
						if (!interactionId) continue
						const companyId = companyMap.get(spec.companySlug)!
						const storageKey = `recordings/${companyId}/${randomUUID()}.wav`
						if (spec.upload) {
							yield* Effect.tryPromise(() =>
								s3.send(
									new PutObjectCommand({
										Bucket: storageBucket,
										Key: storageKey,
										Body: wavBody,
										ContentType: 'audio/wav',
										ContentLength: wavBody.byteLength,
									}),
								),
							)
							uploadedCount += 1
						}
						recordingRows.push({
							interactionId,
							storageKey,
							mimeType: 'audio/wav',
							byteSize: wavBody.byteLength,
							durationSec: spec.durationSec,
							transcriptStatus: spec.transcriptStatus ?? null,
							transcriptText: spec.transcriptText ?? null,
							transcriptError: spec.transcriptError ?? null,
							transcriptSegments:
								spec.transcriptSegments != null
									? JSON.stringify(spec.transcriptSegments)
									: null,
							detectedLanguages:
								spec.detectedLanguages != null
									? JSON.stringify(spec.detectedLanguages)
									: null,
							transcribedAt: spec.transcribedAt ?? null,
							provider: spec.provider ?? null,
							providerRequestId: spec.providerRequestId ?? null,
							callerSpeakerId: spec.callerSpeakerId ?? null,
							deletedAt: spec.deletedAt ?? null,
						})
					}

					if (recordingRows.length > 0) {
						yield* sql`INSERT INTO call_recordings ${sql.insert(
							normalizeRows(stamp(recordingRows)),
						)}`
						yield* Effect.logInfo(
							`  ${recordingRows.length} recordings (${uploadedCount} uploaded, ${recordingRows.length - uploadedCount} missing/deleted)`,
						)
					}
				}

				const counts = {
					products: insertedProducts.length,
					companies: insertedCompanies.length,
					contacts: insertedContacts.length,
					interactions: insertedInteractions.length,
					tasks: insertedTasks.length,
					researchPolicy: testUser ? 1 : 0,
					documents: preset === 'full' ? 6 : 0,
					proposals: preset === 'full' ? 7 : 0,
					pages: preset === 'full' ? 14 : 0,
					emailThreads: preset === 'full' ? 12 : 0,
					emailMessages: preset === 'full' ? 16 : 0,
					researchRuns: preset === 'full' ? 9 : 0,
					sources: preset === 'full' ? 6 : 0,
					callRecordings: preset === 'full' ? 6 : 0,
				}

				yield* Effect.logInfo('Seed complete!')
				return counts
			}),
		)
	})

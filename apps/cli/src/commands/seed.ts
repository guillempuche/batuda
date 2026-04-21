/** biome-ignore-all lint/style/noNonNullAssertion: seed data */
import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { apiKey } from '@better-auth/api-key'
import { betterAuth } from 'better-auth'
import { admin, bearer, openAPI } from 'better-auth/plugins'
import { Config, Effect, Redacted } from 'effect'
import { SqlClient } from 'effect/unstable/sql'
import pg from 'pg'

import { buildBetterAuthConfig } from '@batuda/auth'

// ── Helpers ──────────────────────────────────────────────

/** AgentMail-shaped thread ID: `thd_<16 chars>` — mirrors real wire data. */
const amThreadId = (slug: string): string =>
	`thd_${slug
		.replace(/[^a-z0-9]/gi, '')
		.toLowerCase()
		.slice(0, 16)}`

/** AgentMail-shaped RFC-5322 message ID: `<…@agentmail.to>`. */
const amMessageId = (slug: string): string =>
	`<${slug.replace(/[^a-z0-9]/gi, '').toLowerCase()}@agentmail.to>`

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

// ── Local-inbox file writer ───────────────────────────────
// The local-inbox provider reads bodies from apps/server/.dev-inbox/*.md,
// so seeded threads need matching files on disk for getThread to serve them.

const DEV_INBOX_DIR = resolve(
	import.meta.dirname,
	'..',
	'..',
	'..',
	'server',
	'.dev-inbox',
)

const pad = (n: number, width = 2) => n.toString().padStart(width, '0')
const filenameStamp = (d: Date) =>
	`${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}-${pad(d.getUTCMilliseconds(), 3)}`

const slugify = (s: string) =>
	s
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 50) || 'untitled'

const formatList = (items: readonly string[]): string =>
	items.length === 0 ? '[]' : `\n${items.map(i => `  - ${i}`).join('\n')}`

const messageSlugFromId = (providerMessageId: string): string =>
	providerMessageId.replace(/^</, '').replace(/@agentmail\.to>$/, '')

const SEED_MESSAGE_BODIES: Record<string, { from: string; body: string }> = {
	calpep01: {
		from: 'admin@taller.cat',
		body: 'Hola Pep,\n\nT’envio la proposta per la web i el sistema de reserves. Avisa’m quan tinguis un moment per revisar-la.\n\nSalutacions,\nTaller',
	},
	calpep02: {
		from: 'pep@calpepfonda.cat',
		body: 'Hola,\n\nGràcies per la proposta. Ens reunim dijous per parlar-ne?',
	},
	ferrosmarta01: {
		from: 'admin@taller.cat',
		body: 'Hola Marta,\n\nAquesta és una primera aproximació per l’automatització de processos comercials. Adjunto un esborrany d’agenda.',
	},
	ferrosjordi01: {
		from: 'admin@taller.cat',
		body: 'Hola Jordi,\n\nSeguim amb la demo de facturació. Et va bé dimarts a les 10?',
	},
	coastal01: {
		from: 'admin@taller.cat',
		body: 'Hi Tom,\n\nHere is a quick write-up on our delivery-note digitisation pilot. Happy to jump on a call.',
	},
	hostal01: {
		from: 'admin@taller.cat',
		body: 'Hola Arnau,\n\nProposta inicial per al sistema de reserves de l’Hostal. Repassem-la quan puguis.',
	},
	hostal02: {
		from: 'reserves@hostalpirineu.com',
		body: 'Hola,\n\nMolt bé, ens encaixa. Podries enviar un pressupost detallat?',
	},
	brightlane01: {
		from: 'admin@taller.cat',
		body: 'Hi Sarah,\n\nFollowing up on the ecommerce roadmap — let me know if Tuesday works for the review call.',
	},
	dismartinez01: {
		from: 'admin@taller.cat',
		body: 'Hola Carlos,\n\nPrimera presa de contacte sobre automatització logística. Quedo pendent de la teva resposta.',
	},
	parkstone01: {
		from: 'admin@taller.cat',
		body: 'Hi,\n\nSharing our website redesign offer as discussed. Full scope inside.',
	},
	nocompany01: {
		from: 'visitor@example.org',
		body: 'Hola,\n\nTinc interes en els vostres serveis. Podem parlar aquesta setmana?',
	},
	tancaments01: {
		from: 'admin@taller.cat',
		body: 'Hola Ramon,\n\nAdjunto la proposta d’automatització per a Tancaments Garraf.',
	},
	tancaments02: {
		from: 'ramon@tancamentsgarraf.cat',
		body: 'Hola,\n\nGràcies. Tenim alguns dubtes sobre el calendari — te’ls envio aviat.',
	},
	tancaments03: {
		from: 'admin@taller.cat',
		body: 'Hola Ramon,\n\nRespostes als teus dubtes sobre el calendari, punt per punt.',
	},
	spamreject01: {
		from: 'marketing@spam-sender.biz',
		body: '🔥 Boost your sales 10x with our magical SEO funnel. Reply STOP to unsubscribe.',
	},
	blocklist01: {
		from: 'scammer@blocked-domain.tld',
		body: 'Urgent wire transfer required immediately. Please confirm bank details.',
	},
}

type DevInboxThreadLike = { providerThreadId: string; subject: string }
type DevInboxMessageLike = {
	providerMessageId: string
	providerThreadId: string
	direction: string
	recipients: string
	inboundClassification: string | null
	statusUpdatedAt: Date
}

const writeDevInboxFiles = (
	threadRows: readonly DevInboxThreadLike[],
	messageRows: readonly DevInboxMessageLike[],
) =>
	Effect.gen(function* () {
		yield* Effect.tryPromise(() =>
			mkdir(DEV_INBOX_DIR, { recursive: true }),
		).pipe(Effect.orDie)

		// Drop any previously seeded files so rolling-date reseeds don't
		// accumulate duplicates under different timestamp prefixes. Hand-dropped
		// dev files (magic-link captures, ad-hoc probes) are preserved.
		const seedMessageIds = new Set(messageRows.map(m => m.providerMessageId))
		const existing = yield* Effect.tryPromise(() =>
			readdir(DEV_INBOX_DIR),
		).pipe(Effect.orDie)
		for (const name of existing) {
			if (!name.endsWith('.md')) continue
			const path = resolve(DEV_INBOX_DIR, name)
			const contents = yield* Effect.tryPromise(() =>
				readFile(path, 'utf8'),
			).pipe(Effect.orDie)
			const match = contents.match(/^messageId:\s*(.+)$/m)
			if (match && seedMessageIds.has(match[1]!.trim())) {
				yield* Effect.tryPromise(() => unlink(path)).pipe(Effect.orDie)
			}
		}

		const subjectByThread = new Map(
			threadRows.map(t => [t.providerThreadId, t.subject]),
		)

		for (const msg of messageRows) {
			const slug = messageSlugFromId(msg.providerMessageId)
			const meta = SEED_MESSAGE_BODIES[slug] ?? {
				from:
					msg.direction === 'outbound'
						? 'admin@taller.cat'
						: 'sender@example.com',
				body: 'Seeded dev message.',
			}
			const recipients = JSON.parse(msg.recipients) as {
				to: string[]
				cc: string[]
				bcc: string[]
			}
			const subject =
				subjectByThread.get(msg.providerThreadId) ?? '(no subject)'
			const stamp = filenameStamp(msg.statusUpdatedAt)
			const recipient = slugify(recipients.to[0] ?? 'unknown')
			const filename = `${stamp}__${recipient}__${slugify(subject)}.md`
			const labels =
				msg.inboundClassification === 'spam'
					? ['spam']
					: msg.inboundClassification === 'blocked'
						? ['blocked']
						: []
			const fm = [
				`sentAt: ${msg.statusUpdatedAt.toISOString()}`,
				`provider: local-inbox`,
				`messageId: ${msg.providerMessageId}`,
				`threadId: ${msg.providerThreadId}`,
				`from: ${meta.from}`,
				`to: ${formatList(recipients.to)}`,
				`cc: ${formatList(recipients.cc)}`,
				`bcc: ${formatList(recipients.bcc)}`,
				`replyTo: null`,
				`subject: ${subject}`,
				`text: null`,
				`html: null`,
				`labels: ${formatList(labels)}`,
				`attachments: []`,
			].join('\n')
			const content = `---\n${fm}\n---\n\n${meta.body}\n`
			yield* Effect.tryPromise(() =>
				writeFile(resolve(DEV_INBOX_DIR, filename), content, 'utf8'),
			).pipe(Effect.orDie)
		}
	})

// ── Test user ─────────────────────────────────────────────

export const TEST_USER = {
	email: 'admin@taller.cat',
	password: 'batuda-dev-2026',
	name: 'Taller Dev',
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
	yield* sql`TRUNCATE companies, products, pages, research_runs, sources, user_research_policy, provider_quotas, provider_usage, inboxes, email_thread_links, email_messages, call_recordings CASCADE`
})

// ── Seed auth ─────────────────────────────────────────────

export const seedAuth = Effect.gen(function* () {
	yield* Effect.logInfo('Seeding auth user...')
	const dbUrl = yield* Config.redacted('DATABASE_URL')
	const secret = yield* Config.string('BETTER_AUTH_SECRET')
	const baseURL = yield* Config.string('BETTER_AUTH_BASE_URL').pipe(
		Config.withDefault('http://localhost:3010'),
	)

	const pool = new pg.Pool({ connectionString: Redacted.value(dbUrl) })
	// Uses the shared `buildBetterAuthConfig` — same plugins/config as the
	// server, so API keys / users created here validate against the running
	// /auth/* routes. `disableSignUp: true` closes the public signup endpoint;
	// the admin plugin's `auth.api.createUser` below is the bypass.
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
				admin(),
				apiKey({ enableSessionForAPIKeys: true }),
			],
		}),
	)

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

		// Always truncate before seeding so the command is idempotent.
		yield* seedReset

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

		// Mirror TimelineActivityService: one timeline_activity row per seeded
		// interaction, plus the cadence-column bump on companies/contacts.
		// Kept as SQL here so we don't have to import the server service into
		// the CLI bundle.
		yield* sql`
			INSERT INTO timeline_activity (
				kind, entity_type, entity_id, company_id, contact_id,
				channel, direction, occurred_at, summary, payload
			)
			SELECT
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
		}>`INSERT INTO tasks ${sql.insert(normalizeRows(dataWithContacts.tasks))} RETURNING id, title`
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
					slug, provider, provider_event_type_id, title,
					duration_minutes, location_kind, default_location_value, active
				) VALUES (
					${et.slug}, ${et.provider}, NULL, ${et.title},
					${et.durationMinutes}, ${et.locationKind}, NULL, true
				) ON CONFLICT (slug) DO UPDATE SET
					title = EXCLUDED.title,
					duration_minutes = EXCLUDED.duration_minutes,
					location_kind = EXCLUDED.location_kind,
					updated_at = now()
			`
		}
		const [discoveryType] = yield* sql<{ id: string }>`
			SELECT id FROM calendar_event_types WHERE slug = 'discovery' LIMIT 1
		`
		const [internalType] = yield* sql<{ id: string }>`
			SELECT id FROM calendar_event_types WHERE slug = 'internal-block' LIMIT 1
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
			INSERT INTO calendar_events ${sql.insert(normalizeRows(calendarEventSeeds))}
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
				INSERT INTO calendar_event_attendees ${sql.insert(normalizeRows(attendeeRows))}
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
			yield* sql`INSERT INTO task_events ${sql.insert(normalizeRows(taskEventRows))}`
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
										{ label: 'Get started', action: 'link', url: '/contact' },
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
										{ label: 'Comença ara', action: 'link', url: '/contacte' },
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
						ogDescription: 'Limited time offer — 20% off Web Starter package.',
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
			yield* sql`INSERT INTO pages ${sql.insert(normalizeRows(pageRows))}`

			// 9. Email inboxes (local metadata mirroring provider inboxes).
			// Two seed inboxes to start: a human inbox (default) and an agent
			// inbox for AI workflows. Operators add/remove more via the inbox
			// management UI.
			yield* Effect.logInfo('Seeding email inboxes...')
			const humanInboxId = 'admin@taller.cat'
			const agentInboxId = 'hola@taller.cat'

			const inboxRows = [
				{
					provider: 'agentmail',
					providerInboxId: humanInboxId,
					email: humanInboxId,
					displayName: 'Guillem Puche',
					purpose: 'human',
					ownerUserId: null,
					isDefault: true,
					active: true,
					clientId: 'batuda:human',
				},
				{
					provider: 'agentmail',
					providerInboxId: agentInboxId,
					email: agentInboxId,
					displayName: 'Taller team (shared with AI)',
					purpose: 'shared',
					ownerUserId: null,
					isDefault: false,
					active: true,
					clientId: 'batuda:shared',
				},
			]
			yield* sql`INSERT INTO inboxes ${sql.insert(normalizeRows(inboxRows))}`

			const inboxIdRows = yield* sql<{
				id: string
				providerInboxId: string
			}>`SELECT id, provider_inbox_id FROM inboxes`
			const inboxIdMap = new Map(
				inboxIdRows.map(r => [r.providerInboxId, r.id]),
			)
			const humanInboxUuid = inboxIdMap.get(humanInboxId)!

			// 10. Email threads + messages
			yield* Effect.logInfo('Seeding email threads & messages...')
			const inboxId = humanInboxId

			const emailThreadRows = [
				{
					provider: 'agentmail',
					providerThreadId: amThreadId('calpep01'),
					providerInboxId: inboxId,
					companyId: companyMap.get('cal-pep-fonda')!,
					contactId: contactMap.get('Pep Casals'),
					subject: 'Proposal: Web + Booking for Cal Pep Fonda',
					status: 'open',
				},
				{
					provider: 'agentmail',
					providerThreadId: amThreadId('ferros01'),
					providerInboxId: inboxId,
					companyId: companyMap.get('ferros-baix-llobregat')!,
					contactId: contactMap.get('Marta Soler'),
					subject: 'Automation enquiry — Ferros BL',
					status: 'open',
				},
				{
					provider: 'agentmail',
					providerThreadId: amThreadId('ferros02'),
					providerInboxId: inboxId,
					companyId: companyMap.get('ferros-baix-llobregat')!,
					contactId: contactMap.get('Jordi Puig'),
					subject: 'Meeting follow-up — invoicing demo',
					status: 'open',
				},
				{
					provider: 'agentmail',
					providerThreadId: amThreadId('coastal01'),
					providerInboxId: inboxId,
					companyId: companyMap.get('coastal-freight')!,
					contactId: contactMap.get('Tom Parker'),
					subject: 'Delivery note digitisation info',
					status: 'open',
				},
				{
					provider: 'agentmail',
					providerThreadId: amThreadId('hostal01'),
					providerInboxId: inboxId,
					companyId: companyMap.get('hostal-pirineu')!,
					contactId: contactMap.get('Arnau Ribas'),
					subject: 'Booking system proposal — Hostal del Pirineu',
					status: 'open',
				},
				{
					provider: 'agentmail',
					providerThreadId: amThreadId('brightlane01'),
					providerInboxId: inboxId,
					companyId: companyMap.get('bright-lane-boutique')!,
					contactId: contactMap.get('Sarah Mitchell'),
					subject: 'Ecommerce setup — next steps',
					status: 'open',
				},
				{
					provider: 'agentmail',
					providerThreadId: amThreadId('dismartinez01'),
					providerInboxId: inboxId,
					companyId: companyMap.get('distribuciones-martinez')!,
					contactId: contactMap.get('Carlos Martínez'),
					subject: 'Cold outreach — logistics automation',
					status: 'open',
				},
				{
					provider: 'agentmail',
					providerThreadId: amThreadId('parkstone01'),
					providerInboxId: inboxId,
					companyId: companyMap.get('park-stone-design')!,
					contactId: null,
					subject: 'Website redesign offer',
					status: 'closed',
				},
				{
					provider: 'agentmail',
					providerThreadId: amThreadId('nocompany01'),
					providerInboxId: inboxId,
					companyId: null,
					contactId: null,
					subject: 'General enquiry from website form',
					status: 'open',
				},
				{
					provider: 'agentmail',
					providerThreadId: amThreadId('tancaments01'),
					providerInboxId: inboxId,
					companyId: companyMap.get('tancaments-garraf')!,
					contactId: contactMap.get('Ramon Vila'),
					subject: 'Automation proposal — Tancaments Garraf',
					status: 'open',
				},
				// Unsolicited pitch that AgentMail flagged as spam on receive.
				{
					provider: 'agentmail',
					providerThreadId: amThreadId('spamreject'),
					providerInboxId: inboxId,
					companyId: null,
					contactId: null,
					subject: '🔥 Boost your sales 10x with our SEO magic',
					status: 'open',
				},
				// Sender hit an AgentMail block list on receive.
				{
					provider: 'agentmail',
					providerThreadId: amThreadId('blocklist'),
					providerInboxId: inboxId,
					companyId: null,
					contactId: null,
					subject: 'RE: urgent wire transfer needed',
					status: 'open',
				},
			]
			const emailThreadRowsWithInbox = emailThreadRows.map(r => ({
				...r,
				inboxId: humanInboxUuid,
			}))
			yield* sql`INSERT INTO email_thread_links ${sql.insert(normalizeRows(emailThreadRowsWithInbox))}`

			const seededAt = new Date()
			const hoursAgo = (h: number) =>
				new Date(seededAt.getTime() - h * 60 * 60 * 1000)
			const daysAgo = (d: number) => hoursAgo(d * 24)

			const emailMessageRows = [
				// Thread: Cal Pep — delivered outbound + delivered inbound reply
				{
					provider: 'agentmail',
					providerMessageId: amMessageId('calpep01'),
					providerThreadId: amThreadId('calpep01'),
					providerInboxId: inboxId,
					direction: 'outbound',
					companyId: companyMap.get('cal-pep-fonda')!,
					contactId: contactMap.get('Pep Casals'),
					recipients: JSON.stringify({
						to: ['pep@calpepfonda.cat'],
						cc: [],
						bcc: [],
					}),
					status: 'delivered',
					inboundClassification: null,
					statusUpdatedAt: daysAgo(56),
				},
				{
					provider: 'agentmail',
					providerMessageId: amMessageId('calpep02'),
					providerThreadId: amThreadId('calpep01'),
					providerInboxId: inboxId,
					direction: 'inbound',
					companyId: companyMap.get('cal-pep-fonda')!,
					contactId: contactMap.get('Pep Casals'),
					recipients: JSON.stringify({
						to: ['admin@taller.cat'],
						cc: [],
						bcc: [],
					}),
					status: 'delivered',
					inboundClassification: 'normal',
					statusUpdatedAt: daysAgo(55),
				},
				// Thread: Ferros (Marta) — sent, not yet delivered
				{
					provider: 'agentmail',
					providerMessageId: amMessageId('ferrosmarta01'),
					providerThreadId: amThreadId('ferros01'),
					providerInboxId: inboxId,
					direction: 'outbound',
					companyId: companyMap.get('ferros-baix-llobregat')!,
					contactId: contactMap.get('Marta Soler'),
					recipients: JSON.stringify({
						to: ['marta@ferrosbl.com'],
						cc: [],
						bcc: [],
					}),
					status: 'sent',
					inboundClassification: null,
					statusUpdatedAt: daysAgo(42),
				},
				// Thread: Ferros (Jordi) — hard bounce
				{
					provider: 'agentmail',
					providerMessageId: amMessageId('ferrosjordi01'),
					providerThreadId: amThreadId('ferros02'),
					providerInboxId: inboxId,
					direction: 'outbound',
					companyId: companyMap.get('ferros-baix-llobregat')!,
					contactId: contactMap.get('Jordi Puig'),
					recipients: JSON.stringify({
						to: ['gerencia@ferrosbl.com'],
						cc: [],
						bcc: [],
					}),
					status: 'bounced',
					statusReason: 'Permanent/General — mailbox does not exist',
					bounceType: 'Permanent',
					bounceSubType: 'General',
					inboundClassification: null,
					statusUpdatedAt: daysAgo(32),
				},
				// Thread: Coastal — soft bounce
				{
					provider: 'agentmail',
					providerMessageId: amMessageId('coastal01'),
					providerThreadId: amThreadId('coastal01'),
					providerInboxId: inboxId,
					direction: 'outbound',
					companyId: companyMap.get('coastal-freight')!,
					contactId: contactMap.get('Tom Parker'),
					recipients: JSON.stringify({
						to: ['ops@coastalfreight.es'],
						cc: [],
						bcc: [],
					}),
					status: 'bounced_soft',
					statusReason: 'Transient/MailboxFull',
					bounceType: 'Transient',
					bounceSubType: 'MailboxFull',
					inboundClassification: null,
					statusUpdatedAt: daysAgo(22),
				},
				// Thread: Hostal — delivered outbound + inbound reply
				{
					provider: 'agentmail',
					providerMessageId: amMessageId('hostal01'),
					providerThreadId: amThreadId('hostal01'),
					providerInboxId: inboxId,
					direction: 'outbound',
					companyId: companyMap.get('hostal-pirineu')!,
					contactId: contactMap.get('Arnau Ribas'),
					recipients: JSON.stringify({
						to: ['reserves@hostalpirineu.com'],
						cc: [],
						bcc: [],
					}),
					status: 'delivered',
					inboundClassification: null,
					statusUpdatedAt: daysAgo(11),
				},
				{
					provider: 'agentmail',
					providerMessageId: amMessageId('hostal02'),
					providerThreadId: amThreadId('hostal01'),
					providerInboxId: inboxId,
					direction: 'inbound',
					companyId: companyMap.get('hostal-pirineu')!,
					contactId: contactMap.get('Arnau Ribas'),
					recipients: JSON.stringify({
						to: ['admin@taller.cat'],
						cc: [],
						bcc: [],
					}),
					status: 'delivered',
					inboundClassification: 'normal',
					statusUpdatedAt: hoursAgo(10 * 24 + 6),
				},
				// Thread: Bright Lane — complained (spam)
				{
					provider: 'agentmail',
					providerMessageId: amMessageId('brightlane01'),
					providerThreadId: amThreadId('brightlane01'),
					providerInboxId: inboxId,
					direction: 'outbound',
					companyId: companyMap.get('bright-lane-boutique')!,
					contactId: contactMap.get('Sarah Mitchell'),
					recipients: JSON.stringify({
						to: ['hello@brightlane.cat'],
						cc: [],
						bcc: [],
					}),
					status: 'complained',
					statusReason: 'Recipient marked as spam',
					inboundClassification: null,
					statusUpdatedAt: daysAgo(15),
				},
				// Thread: Distribuciones — rejected (provider rejected sending)
				{
					provider: 'agentmail',
					providerMessageId: amMessageId('dismartinez01'),
					providerThreadId: amThreadId('dismartinez01'),
					providerInboxId: inboxId,
					direction: 'outbound',
					companyId: companyMap.get('distribuciones-martinez')!,
					contactId: contactMap.get('Carlos Martínez'),
					recipients: JSON.stringify({
						to: ['carlos@dismartinez.es'],
						cc: [],
						bcc: [],
					}),
					status: 'rejected',
					statusReason: 'Sending quota exceeded',
					inboundClassification: null,
					statusUpdatedAt: daysAgo(20),
				},
				// Thread: Park & Stone — delivered then no reply (closed thread)
				{
					provider: 'agentmail',
					providerMessageId: amMessageId('parkstone01'),
					providerThreadId: amThreadId('parkstone01'),
					providerInboxId: inboxId,
					direction: 'outbound',
					companyId: companyMap.get('park-stone-design')!,
					contactId: null,
					recipients: JSON.stringify({
						to: ['hello@parkstonedesign.com'],
						cc: [],
						bcc: [],
					}),
					status: 'delivered',
					inboundClassification: null,
					statusUpdatedAt: daysAgo(61),
				},
				// Thread: No company — inbound from unknown sender
				{
					provider: 'agentmail',
					providerMessageId: amMessageId('nocompany01'),
					providerThreadId: amThreadId('nocompany01'),
					providerInboxId: inboxId,
					direction: 'inbound',
					companyId: null,
					contactId: null,
					recipients: JSON.stringify({
						to: ['admin@taller.cat'],
						cc: [],
						bcc: [],
					}),
					status: 'delivered',
					inboundClassification: 'normal',
					statusUpdatedAt: daysAgo(7),
				},
				// Thread: Tancaments — multi-message thread (outbound delivered, inbound delivered, outbound delivered)
				{
					provider: 'agentmail',
					providerMessageId: amMessageId('tancaments01'),
					providerThreadId: amThreadId('tancaments01'),
					providerInboxId: inboxId,
					direction: 'outbound',
					companyId: companyMap.get('tancaments-garraf')!,
					contactId: contactMap.get('Ramon Vila'),
					recipients: JSON.stringify({
						to: ['ramon@tancamentsgarraf.cat'],
						cc: [],
						bcc: [],
					}),
					status: 'delivered',
					inboundClassification: null,
					statusUpdatedAt: daysAgo(29),
				},
				{
					provider: 'agentmail',
					providerMessageId: amMessageId('tancaments02'),
					providerThreadId: amThreadId('tancaments01'),
					providerInboxId: inboxId,
					direction: 'inbound',
					companyId: companyMap.get('tancaments-garraf')!,
					contactId: contactMap.get('Ramon Vila'),
					recipients: JSON.stringify({
						to: ['admin@taller.cat'],
						cc: [],
						bcc: [],
					}),
					status: 'delivered',
					inboundClassification: 'normal',
					statusUpdatedAt: hoursAgo(29 * 24 - 6),
				},
				{
					provider: 'agentmail',
					providerMessageId: amMessageId('tancaments03'),
					providerThreadId: amThreadId('tancaments01'),
					providerInboxId: inboxId,
					direction: 'outbound',
					companyId: companyMap.get('tancaments-garraf')!,
					contactId: contactMap.get('Ramon Vila'),
					recipients: JSON.stringify({
						to: ['ramon@tancamentsgarraf.cat'],
						cc: [],
						bcc: [],
					}),
					status: 'delivered',
					inboundClassification: null,
					statusUpdatedAt: daysAgo(28),
				},
				// Inbound spam — unsolicited pitch, flagged by AgentMail
				{
					provider: 'agentmail',
					providerMessageId: amMessageId('spamreject01'),
					providerThreadId: amThreadId('spamreject'),
					providerInboxId: inboxId,
					direction: 'inbound',
					companyId: null,
					contactId: null,
					recipients: JSON.stringify({
						to: ['info@taller.cat'],
						cc: [],
						bcc: [],
					}),
					status: 'delivered',
					inboundClassification: 'spam',
					statusUpdatedAt: daysAgo(6),
				},
				// Inbound from blocked sender — AgentMail block list match
				{
					provider: 'agentmail',
					providerMessageId: amMessageId('blocklist01'),
					providerThreadId: amThreadId('blocklist'),
					providerInboxId: inboxId,
					direction: 'inbound',
					companyId: null,
					contactId: null,
					recipients: JSON.stringify({
						to: ['info@taller.cat'],
						cc: [],
						bcc: [],
					}),
					status: 'delivered',
					inboundClassification: 'blocked',
					statusUpdatedAt: daysAgo(5),
				},
			]
			yield* sql`INSERT INTO email_messages ${sql.insert(normalizeRows(emailMessageRows))}`
			yield* Effect.logInfo(
				`  ${emailThreadRows.length} threads, ${emailMessageRows.length} messages`,
			)

			// message_participants — one row per (email × address × role).
			// Uses the same shape as the migration backfill so dev seeds and
			// real production data are read back identically.
			yield* sql`
				INSERT INTO message_participants (email_message_id, email_address, role)
				SELECT m.id, lower(addr.value), roles.role_name
				FROM email_messages m
				CROSS JOIN LATERAL (VALUES ('to'), ('cc'), ('bcc')) AS roles(role_name)
				CROSS JOIN LATERAL jsonb_array_elements_text(
					COALESCE(m.recipients->roles.role_name, '[]'::jsonb)
				) AS addr(value)
				WHERE addr.value IS NOT NULL AND addr.value <> ''
				ON CONFLICT DO NOTHING
			`
			yield* sql`
				INSERT INTO message_participants (email_message_id, email_address, role)
				SELECT m.id, lower(i.email), 'from'
				FROM email_messages m
				JOIN inboxes i ON i.provider_inbox_id = m.provider_inbox_id
				WHERE m.direction = 'outbound'
				ON CONFLICT DO NOTHING
			`
			yield* sql`
				UPDATE message_participants mp SET contact_id = c.id
				FROM contacts c
				WHERE lower(c.email) = mp.email_address AND mp.contact_id IS NULL
			`

			// timeline_activity rows for each seeded email — matches the
			// service's kind mapping so list_timeline returns email events
			// alongside interactions.
			yield* sql`
				INSERT INTO timeline_activity (
					kind, entity_type, entity_id, company_id, contact_id,
					channel, direction, occurred_at, payload
				)
				SELECT
					CASE WHEN direction = 'outbound' THEN 'email_sent'
					     ELSE 'email_received' END,
					'email_message', id, company_id, contact_id,
					'email', direction, status_updated_at,
					jsonb_build_object('classification', inbound_classification)
				FROM email_messages
			`
			yield* sql`
				UPDATE companies c SET
					last_email_at = GREATEST(
						last_email_at,
						(SELECT MAX(status_updated_at) FROM email_messages WHERE company_id = c.id)
					),
					last_contacted_at = GREATEST(
						last_contacted_at,
						(SELECT MAX(status_updated_at) FROM email_messages WHERE company_id = c.id)
					)
			`
			yield* sql`
				UPDATE contacts co SET
					last_email_at = GREATEST(
						last_email_at,
						(SELECT MAX(status_updated_at) FROM email_messages WHERE contact_id = co.id)
					)
			`

			yield* writeDevInboxFiles(emailThreadRows, emailMessageRows)

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
						summary: 'Found 12 restaurants, 3 already have booking systems.',
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
					context: JSON.stringify({ industry: 'retail', region: 'barcelona' }),
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
					context: JSON.stringify({ industry: 'transport', region: 'maresme' }),
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
			}>`INSERT INTO research_runs ${sql.insert(normalizeRows(researchRunRows))} RETURNING id, status`
			yield* Effect.logInfo(`  ${insertedRuns.length} research runs`)

			// Group run with children
			const groupRun = yield* sql<{
				id: string
			}>`INSERT INTO research_runs ${sql.insert([
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
			])} RETURNING id`
			yield* sql`INSERT INTO research_runs ${sql.insert(
				normalizeRows([
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
			const storageAccessKeyId = yield* Config.string('STORAGE_ACCESS_KEY_ID')
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
					normalizeRows(recordingRows),
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
	})

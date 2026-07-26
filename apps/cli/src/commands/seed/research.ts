/** biome-ignore-all lint/style/noNonNullAssertion: seed data */
import { Effect } from 'effect'

import { TEST_USER } from './fixtures'
import {
	BRIEF_LONG_DECISION_MAKERS,
	BRIEF_LONG_DELIVERY_NOTES_PILOT,
	BRIEF_LONG_EMPORDA_CERAMICS,
	BRIEF_LONG_GRANOLLERS_AUTOMOTIVE,
	BRIEF_LONG_HOSTAL_DEEP_DIVE,
	BRIEF_LONG_INDUSTRIAL_AUTOMATION,
	BRIEF_LONG_LOGISTICS_DIGITISATION,
	BRIEF_LONG_PARK_STONE_REVISIT,
	BRIEF_LONG_RESTAURANT_AUDIT,
	BRIEF_LONG_RETAIL_PROSPECTS_BCN,
	BRIEF_LONG_TANCAMENTS_HANDOVER,
	BRIEF_LONG_VALENCIA_CONSULTING,
	RICH_COMPETITORS,
	RICH_COMPETITORS_BAKERIES,
	RICH_COMPETITORS_VALENCIA,
	RICH_CONTACTS_BAKERY,
	RICH_CONTACTS_CONSULTORIA,
	RICH_CONTACTS_FERROS,
	RICH_CONTACTS_HOSTAL,
	RICH_CONTACTS_TANCAMENTS,
	RICH_PROSPECTS_ELECTRICAL,
	RICH_PROSPECTS_FANTASMA,
	RICH_PROSPECTS_GIRONA,
	RICH_PROSPECTS_LOGISTICS,
	TOOL_LOG_CACHE_HIT,
	TOOL_LOG_DEEP,
	TOOL_LOG_FAILED,
	TOOL_LOG_FIELD_VISIT,
	TOOL_LOG_PHONE_INTERVIEW,
	TOOL_LOG_WITH_RETRY,
} from './research-content'
import {
	normalizeRows,
	type SeedCtx,
	seedCompanyId,
	seedContactId,
	seedUuid,
	withSeedIds,
} from './shared'

// Findings keys are written exactly as the research schemas define them, which
// is also how every reader gets them back.

export type ResolvedTestUser = { readonly id: string } | null

export const seedResearchPolicy = ({ sql }: SeedCtx) =>
	Effect.gen(function* () {
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
				},
			])} ON CONFLICT (user_id) DO NOTHING`
			yield* Effect.logInfo(`  policy: user ${testUser.id}`)
		} else {
			yield* Effect.logInfo(
				'  (skipped — auth user not found, run seed auth first)',
			)
		}
		// What each company may spend at paid vendors in a month, shared by
		// everyone in it.
		const orgs = yield* sql<{ id: string }>`SELECT id FROM organization`
		for (const org of orgs) {
			yield* sql`
				INSERT INTO organization_research_policy (organization_id, paid_monthly_cap_cents)
				VALUES (${org.id}, 3000)
				ON CONFLICT (organization_id) DO NOTHING
			`
		}
		yield* Effect.logInfo(`  monthly cap: ${orgs.length} organizations`)

		return testUser ?? null
	})

type RunSpec = {
	// Suffix appended to seed:run:<slug> for idempotency_key. Use a
	// short stable identifier (schema or sequence) — the unique
	// constraint is (organization_id, idempotency_key).
	readonly key: string
	readonly companySlug: string
	readonly query: string
	readonly mode: 'deep' | 'quick'
	readonly schemaName: string | null
	readonly kind: 'leaf' | 'group' | 'followup' | 'cache_hit'
	readonly status:
		| 'queued'
		| 'running'
		| 'succeeded'
		| 'failed'
		| 'cancelled'
		| 'deleted'
		| 'no_reliable_data'
	/** Why a run gave up. Only meaningful on failed / no_reliable_data. */
	readonly reasonCode?:
		| 'entity_mismatch'
		| 'weak_no_official_site'
		| 'site_unreadable'
		| 'name_too_generic'
		| 'no_sources'
		| 'internal_error'
	/** How confident the run was that it found the right company at all. */
	readonly entityMatch?: 'strong' | 'weak' | 'absent'
	readonly findings: Record<string, unknown>
	readonly briefMd: string | null
	readonly budgetCents: number
	readonly paidBudgetCents?: number
	readonly costCents: number
	readonly tokensIn: number
	readonly tokensOut: number
	readonly startedAt?: Date
	readonly completedAt?: Date
	readonly attachSources?: ReadonlyArray<{
		sourceId: string
		costCents?: number
	}>
	readonly toolLog?: ReadonlyArray<unknown>
	readonly findingLinks?: ReadonlyArray<{
		table: 'companies' | 'contacts'
		companySlug: string
	}>
	readonly paidSpend?: ReadonlyArray<{
		provider: string
		tool: string
		amountCents: number
		quotaUnits?: number
		quotaUnit?: string
		sourceId?: string
		autoApproved: boolean
	}>
}

/**
 * Fields the UI reads as a value plus the source that backs it, rather than a
 * bare value. Listed here so the fixtures below can be written in the obvious
 * way — `industry: 'restaurants'` — and still reach the screen correctly.
 */
const SOURCED_ENRICHMENT_FIELDS = [
	'industry',
	'size_range',
	'pain_points',
	'current_tools',
	'location',
	'country',
] as const
const SOURCED_CONTACT_FIELDS = ['role', 'email', 'phone'] as const

type Citationish = {
	source_id?: unknown
	quote?: unknown
	confidence?: unknown
}

/**
 * Attach a finding's source to the individual fields that display it.
 *
 * The research schema stores these as `{ value, source_id, quote, confidence }`
 * and the detail view reads `.value`, so a bare string renders as an empty
 * row with no citation. Wrapping happens here rather than in every fixture so
 * the demo data stays readable and no new block can forget it.
 */
const withSourcedFields = (
	findings: Record<string, unknown>,
): Record<string, unknown> => {
	const cite = (block: Record<string, unknown>): Citationish => {
		const citations = block['citations']
		return Array.isArray(citations) && citations.length > 0
			? (citations[0] as Citationish)
			: {}
	}
	const wrap = (
		block: Record<string, unknown>,
		fields: ReadonlyArray<string>,
	): Record<string, unknown> => {
		const source = cite(block)
		const out: Record<string, unknown> = { ...block }
		for (const field of fields) {
			const value = out[field]
			// Already wrapped, or nothing to wrap.
			if (value === undefined || value === null) continue
			if (typeof value === 'object' && !Array.isArray(value)) continue
			out[field] = {
				value,
				source_id: source.source_id ?? null,
				...(source.quote === undefined ? {} : { quote: source.quote }),
				...(source.confidence === undefined
					? {}
					: { confidence: source.confidence }),
			}
		}
		return out
	}

	const next: Record<string, unknown> = { ...findings }
	const enrichment = next['enrichment']
	if (enrichment !== null && typeof enrichment === 'object') {
		next['enrichment'] = wrap(
			enrichment as Record<string, unknown>,
			SOURCED_ENRICHMENT_FIELDS,
		)
	}
	const contacts = next['contacts']
	if (Array.isArray(contacts)) {
		next['contacts'] = contacts.map(c =>
			c !== null && typeof c === 'object'
				? wrap(c as Record<string, unknown>, SOURCED_CONTACT_FIELDS)
				: c,
		)
	}
	return next
}

// Subjects the proposals below point at. Derived the same way the CRM seed
// derives them, so the two always agree without hardcoding a uuid here.
const CAL_PEP_ID = seedCompanyId('cal-pep-fonda')
const FERROS_ID = seedCompanyId('ferros-baix-llobregat')
const HOSTAL_ID = seedCompanyId('hostal-pirineu')
const PEP_CASALS_ID = seedContactId(CAL_PEP_ID, 'Pep Casals')

/** One channel on a proposed contact, in the stored shape the inbox reads. */
const channel = (
	kind: string,
	value: string,
	verification: string | null,
	confidence: number | null,
) => ({
	kind,
	value,
	...(verification === null ? {} : { verification }),
	...(confidence === null ? {} : { confidence }),
	isPrimary: kind === 'email',
})

const proposal = (options: {
	key: string
	subjectTable: 'companies' | 'contacts'
	operation: 'create' | 'update'
	subjectId?: string
	reason: string
	fields: Record<string, unknown>
	/** What this particular claim was read from. */
	citation: { sourceId: string; quote: string; confidence: number }
}) => ({
	id: seedUuid('proposal', options.key),
	status: 'pending',
	subject_table: options.subjectTable,
	operation: options.operation,
	...(options.subjectId === undefined ? {} : { subject_id: options.subjectId }),
	// Seeded subjects are untouched, so their version is 0. Claiming anything
	// else makes the apply fail as a conflict instead of going through.
	expected_version: options.operation === 'update' ? 0 : null,
	reason: options.reason,
	fields: options.fields,
	citations: [
		{
			source_id: options.citation.sourceId,
			quote: options.citation.quote,
			confidence: options.citation.confidence,
		},
	],
})

const TALLER_RUN_SPECS: ReadonlyArray<RunSpec> = [
	{
		key: 'enrichment',
		companySlug: 'cal-pep-fonda',
		query: 'enrich Cal Pep Fonda with industry size and current booking flow',
		mode: 'deep',
		schemaName: 'company_enrichment_v1',
		kind: 'leaf',
		status: 'succeeded',
		findings: {
			enrichment: {
				industry: 'restaurants',
				size_range: '6-10',
				pain_points:
					'Reserves per telèfon, perden walk-ups els caps de setmana.',
				current_tools: 'Llibreta + WhatsApp',
				products_fit: ['gestio-reserves', 'web-starter'],
				tags: ['gastro', 'garraf'],
				location: 'Vilanova i la Geltrú',
				country: 'ES',
				latitude: 41.2241,
				longitude: 1.7254,
				citations: [
					{
						source_id: 'src_firecrawl_001',
						quote: '60 covers, 2 services/day',
						confidence: 0.86,
					},
				],
			},
		},
		briefMd:
			'## Cal Pep Fonda — enrichment\nVilanova i la Geltrú restaurant, ~60 covers / 2 serveis. Telèfon-only reservations leak ~15% of walk-ups Saturdays. Strong fit for `gestio-reserves` + `web-starter`.',
		budgetCents: 50,
		costCents: 35,
		tokensIn: 12400,
		tokensOut: 3200,
		startedAt: new Date('2026-02-08T10:00:00Z'),
		completedAt: new Date('2026-02-08T10:02:30Z'),
		// Firecrawl scrape is a cheap-tier charge, so it lands in cost_cents, not
		// the paid ledger — no paidSpend row here.
		attachSources: [{ sourceId: 'src_firecrawl_001', costCents: 5 }],
	},
	{
		key: 'enrichment',
		companySlug: 'ferros-baix-llobregat',
		query: 'Ferros Baix Llobregat — directors, share capital, financial health',
		mode: 'deep',
		schemaName: 'company_enrichment_v1',
		kind: 'leaf',
		status: 'succeeded',
		findings: {
			enrichment: {
				industry: 'manufacturing',
				size_range: '26-50',
				pain_points:
					'Factures manuals amb Excel, errors freqüents al tancar mes.',
				current_tools: 'Excel + Contaplus',
				products_fit: ['automatitzacions'],
				tags: ['indústria', 'facturació'],
				address: 'Cornellà de Llobregat — Pol. Ind. Almeda',
				country: 'ES',
				citations: [
					{ source_id: 'src_registry_001', confidence: 0.95 },
					{ source_id: 'src_report_001', confidence: 0.9 },
				],
			},
			competitors: [
				{
					name: 'Industria Metall Llobregat',
					website: 'https://imetalllobregat.es',
					why: 'Direct competitor in steel fabrication for the same Baix Llobregat industrial belt.',
					citations: [{ source_id: 'src_registry_001' }],
				},
			],
		},
		briefMd:
			'## Ferros BL — full enrichment\n40 employees, 2 warehouses Cornellà. Revenue ~3M €/year, manual invoicing 2 days/month, transcription error rate ~5%. Closest competitor Industria Metall Llobregat is also unautomated. Strong automation fit.',
		budgetCents: 100,
		paidBudgetCents: 200,
		costCents: 28,
		tokensIn: 18900,
		tokensOut: 4400,
		startedAt: new Date('2026-02-12T09:30:00Z'),
		completedAt: new Date('2026-02-12T09:33:18Z'),
		attachSources: [
			{ sourceId: 'src_registry_001', costCents: 0 },
			{ sourceId: 'src_report_001', costCents: 150 },
		],
		paidSpend: [
			{
				provider: 'einforma',
				tool: 'company_report',
				amountCents: 150,
				quotaUnits: 1,
				quotaUnit: 'reports',
				sourceId: 'src_report_001',
				autoApproved: true,
			},
		],
	},
	{
		key: 'contacts',
		companySlug: 'bright-lane-boutique',
		query: 'Bright Lane Boutique — find owner contact for ecommerce demo',
		mode: 'deep',
		schemaName: 'contact_discovery_v1',
		kind: 'leaf',
		status: 'succeeded',
		findings: {
			contacts: [
				{
					name: 'Laura Mas',
					role: 'Founder',
					email: 'laura@brightlane.cat',
					linkedin: 'https://linkedin.com/in/lauramas',
					is_decision_maker: true,
					notes: 'Posts daily on @brightlanebcn; replies in <2 h.',
					citations: [{ source_id: 'src_exa_002', confidence: 0.82 }],
				},
				{
					name: 'Marc Tort',
					role: 'Operations',
					email: 'ops@brightlane.cat',
					is_decision_maker: false,
					citations: [{ source_id: 'src_exa_002', confidence: 0.74 }],
				},
			],
		},
		briefMd:
			'## Bright Lane — contacts\nFounder Laura Mas leads sales & content. Marc Tort handles ops. Laura is the right entry for the ecommerce demo; Instagram replies are fastest channel.',
		budgetCents: 40,
		costCents: 22,
		tokensIn: 8400,
		tokensOut: 1900,
		startedAt: new Date('2026-03-04T11:00:00Z'),
		completedAt: new Date('2026-03-04T11:01:40Z'),
		attachSources: [{ sourceId: 'src_exa_002', costCents: 4 }],
	},
	{
		key: 'competitors',
		companySlug: 'electricitat-del-valles',
		query: 'Electricitat del Vallès — local competitors for SEO and reviews',
		mode: 'deep',
		schemaName: 'competitor_scan_v1',
		kind: 'leaf',
		status: 'running',
		findings: {},
		briefMd: null,
		budgetCents: 50,
		costCents: 18,
		tokensIn: 6800,
		tokensOut: 0,
		startedAt: new Date('2026-04-12T09:00:00Z'),
	},
	{
		key: 'online-sales',
		companySlug: 'forn-de-pa-queralt',
		query: 'forn de pa Berga — venda online, packs i mercats locals',
		mode: 'quick',
		schemaName: 'freeform',
		kind: 'leaf',
		status: 'succeeded',
		findings: { proposed_updates: [] },
		briefMd:
			'## Forn de Pa Queralt\nObrador artesà, ven al carrer + Instagram. Mercat de Berga els dimecres. No té web; venda online viable amb un pack de pickup i 2 mercats coberts (Berguedà + Bages). Ticket mitjà ~12 €.',
		budgetCents: 30,
		costCents: 9,
		tokensIn: 4400,
		tokensOut: 1200,
		startedAt: new Date('2026-03-19T16:10:00Z'),
		completedAt: new Date('2026-03-19T16:10:45Z'),
	},
	{
		key: 'registry-failed',
		companySlug: 'coastal-freight',
		query: 'Coastal Freight — paid registry lookup for VAT and directors',
		mode: 'deep',
		schemaName: 'company_enrichment_v1',
		kind: 'leaf',
		status: 'failed',
		findings: { error: 'einforma quota exhausted for 2026-04 period' },
		briefMd: null,
		budgetCents: 60,
		costCents: 14,
		tokensIn: 5600,
		tokensOut: 600,
		startedAt: new Date('2026-04-09T08:00:00Z'),
		completedAt: new Date('2026-04-09T08:00:55Z'),
		attachSources: [{ sourceId: 'src_exa_001', costCents: 4 }],
	},
	{
		key: 'contacts',
		companySlug: 'hostal-pirineu',
		query: 'Hostal del Pirineu — direct booking decision maker contact',
		mode: 'deep',
		schemaName: 'contact_discovery_v1',
		kind: 'leaf',
		status: 'succeeded',
		findings: {
			contacts: [
				{
					name: 'Arnau Ribas',
					role: 'Owner',
					email: 'arnau@hostalpirineu.com',
					phone: '+34 974 551 234',
					is_decision_maker: true,
					notes:
						'Quoted on Booking commission frustration; wants direct channel < 5%.',
					citations: [{ source_id: 'src_firecrawl_003', confidence: 0.91 }],
				},
			],
		},
		briefMd:
			'## Hostal del Pirineu — contacts\nOwner Arnau Ribas is the sole decision maker. Reception emails route to him. Anchor the demo on the < 5% commission threshold.',
		budgetCents: 40,
		costCents: 21,
		tokensIn: 7200,
		tokensOut: 1800,
		startedAt: new Date('2026-03-22T10:00:00Z'),
		completedAt: new Date('2026-03-22T10:01:30Z'),
		attachSources: [{ sourceId: 'src_firecrawl_003', costCents: 4 }],
		toolLog: [
			{
				timestamp: '2026-03-22T10:00:01Z',
				type: 'call',
				tool: 'web.search',
				input: { query: 'Hostal del Pirineu Benasc owner contact' },
			},
			{
				timestamp: '2026-03-22T10:00:04Z',
				type: 'result',
				tool: 'web.search',
				output: { hits: 4 },
			},
			{
				timestamp: '2026-03-22T10:00:05Z',
				type: 'call',
				tool: 'web.scrape',
				input: { url: 'https://hostalpirineu.com' },
			},
			{
				timestamp: '2026-03-22T10:00:18Z',
				type: 'result',
				tool: 'web.scrape',
				output: {
					url: 'https://hostalpirineu.com',
					source_id: 'src_firecrawl_003',
				},
			},
		],
	},
	{
		key: 'queued',
		companySlug: 'distribuciones-martinez',
		query: 'Distribuciones Martínez — pedido digital y rutas',
		mode: 'deep',
		schemaName: 'freeform',
		kind: 'leaf',
		status: 'queued',
		findings: {},
		briefMd: null,
		budgetCents: 40,
		costCents: 0,
		tokensIn: 0,
		tokensOut: 0,
	},
	{
		key: 'competitors-cancelled',
		companySlug: 'park-stone-design',
		query: 'Park & Stone Design — competing agencies in Barcelona',
		mode: 'quick',
		schemaName: 'competitor_scan_v1',
		kind: 'leaf',
		status: 'cancelled',
		findings: {},
		briefMd: null,
		budgetCents: 30,
		costCents: 4,
		tokensIn: 1200,
		tokensOut: 0,
		startedAt: new Date('2026-03-08T11:00:00Z'),
		completedAt: new Date('2026-03-08T11:00:18Z'),
	},
	{
		key: 'prospects',
		companySlug: 'ceramiques-emporda',
		query: "ceramics workshops L'Empordà — prospects without ecommerce",
		mode: 'deep',
		schemaName: 'prospect_scan_v1',
		kind: 'leaf',
		status: 'succeeded',
		findings: {
			prospects: [
				{
					name: 'Vidres Palafrugell',
					website: 'https://vidrespalafrugell.cat',
					industry: 'manufacturing',
					country: 'ES',
					why_relevant:
						'Sells exclusively in physical store; Instagram catalogue suggests latent online demand.',
					pain_indicators: [
						'no ecommerce',
						'manual invoicing',
						'instagram-only catalogue',
					],
					citations: [{ source_id: 'src_firecrawl_002' }],
				},
				{
					name: 'Forja Empordà',
					industry: 'manufacturing',
					country: 'ES',
					why_relevant:
						'Wrought-iron workshop next to La Bisbal; potential ecommerce-local fit.',
					pain_indicators: ['static-website', 'no online catalogue'],
					citations: [{ source_id: 'src_firecrawl_002', confidence: 0.7 }],
				},
			],
			discovered_existing: [],
		},
		briefMd:
			'## Empordà ceramics + neighbours\n2 nearby manufactura workshops, each Instagram-only or with a static site. `ecommerce-local` + `web-starter` fit. Ceràmiques Empordà is the anchor; the others worth a same-trip visit.',
		budgetCents: 50,
		costCents: 26,
		tokensIn: 9100,
		tokensOut: 2400,
		startedAt: new Date('2026-03-26T14:00:00Z'),
		completedAt: new Date('2026-03-26T14:02:08Z'),
		attachSources: [{ sourceId: 'src_firecrawl_002', costCents: 5 }],
	},
	{
		key: 'archive-deleted',
		companySlug: 'tancaments-garraf',
		query: 'Tancaments Garraf — historical site changes',
		mode: 'quick',
		schemaName: 'freeform',
		kind: 'leaf',
		// API hides `deleted` from list calls — kept for soft-delete tests.
		status: 'deleted',
		findings: {},
		briefMd: null,
		budgetCents: 20,
		costCents: 0,
		tokensIn: 0,
		tokensOut: 0,
		attachSources: [{ sourceId: 'src_archive_001' }],
	},
	{
		key: 'cache-hit',
		companySlug: 'consultoria-beta',
		query: 'consultoria valencia — digital readiness signals',
		mode: 'quick',
		schemaName: 'freeform',
		kind: 'cache_hit',
		status: 'succeeded',
		findings: { proposed_updates: [] },
		briefMd:
			'## Cached freeform brief\nPrior research on València consultancies (TTL not yet expired). 4 firms in the same niche, mostly with brochure sites and gmail addresses.',
		budgetCents: 0,
		costCents: 0,
		tokensIn: 0,
		tokensOut: 0,
		startedAt: new Date('2026-04-15T09:00:00Z'),
		completedAt: new Date('2026-04-15T09:00:00Z'),
	},
	{
		key: 'enrichment-thin',
		companySlug: 'empresa-fantasma',
		query: "L'Ànec d'Or Manresa — find any web or phone",
		mode: 'deep',
		schemaName: 'company_enrichment_v1',
		kind: 'leaf',
		status: 'succeeded',
		findings: {
			enrichment: {
				industry: 'distribution',
				location: 'Manresa',
				country: 'ES',
				citations: [
					{
						source_id: 'src_archive_001',
						quote: 'Last archive snapshot: 2024',
					},
				],
			},
		},
		briefMd:
			'## Empresa Fantasma — thin signal\nNo current website. Wayback last snapshot 2024. Listed in Google Maps but no working number. Suggest a postal-mail prospecting touch.',
		budgetCents: 30,
		costCents: 11,
		tokensIn: 3800,
		tokensOut: 600,
		startedAt: new Date('2026-04-02T10:00:00Z'),
		completedAt: new Date('2026-04-02T10:00:38Z'),
		attachSources: [{ sourceId: 'src_archive_001', costCents: 0 }],
	},
	{
		key: 'prospects',
		companySlug: 'taller-mecanic-jove',
		query: 'Granollers automotive workshops — six-month re-engagement',
		mode: 'deep',
		schemaName: 'prospect_scan_v1',
		kind: 'leaf',
		status: 'succeeded',
		findings: {
			prospects: [
				{
					name: 'Taller Mecànic Jove',
					industry: 'services',
					country: 'ES',
					why_relevant:
						'Existing prospect — last contact 2025-09. Worth a follow-up DM via Instagram.',
					pain_indicators: ['instagram-only', 'no booking page'],
					citations: [],
				},
			],
			discovered_existing: [],
		},
		briefMd:
			"## Taller Mecànic Jove\nStill Instagram-only. New 2026 brand refresh visible in posts; suggests they're investing — better timing than last September.",
		budgetCents: 30,
		costCents: 13,
		tokensIn: 5200,
		tokensOut: 1100,
		startedAt: new Date('2026-04-22T15:00:00Z'),
		completedAt: new Date('2026-04-22T15:00:55Z'),
		// Cross-reference: the Granollers scan also flagged Bright Lane
		// as an adjacent retail prospect — exercises the `finding`
		// link_kind alongside the per-company `input` link.
		findingLinks: [{ table: 'companies', companySlug: 'bright-lane-boutique' }],
	},

	// A decision-maker email hunt: one enrich plus a fan of verifies, so the
	// paid tier sums many small ledger rows (5¢ + 6×1¢ = 11¢) rather than the
	// single-row shape the other paid runs use.
	{
		key: 'decision-maker-emails',
		companySlug: 'bright-lane-boutique',
		query: 'Bright Lane Boutique — verified decision-maker emails',
		mode: 'deep',
		schemaName: 'contact_discovery_v1',
		kind: 'leaf',
		status: 'succeeded',
		findings: {
			contacts: [
				{
					name: 'Laura Mas',
					role: 'Founder',
					email: 'laura@brightlane.cat',
					is_decision_maker: true,
					notes:
						'Hunter-verified deliverable; six catch-all guesses ruled out.',
					citations: [{ source_id: 'src_exa_002', confidence: 0.9 }],
				},
			],
		},
		briefMd:
			'## Bright Lane — verified emails\nHunter confirmed laura@brightlane.cat as deliverable. Six pattern guesses were verified to rule them out before landing on the founder address.',
		budgetCents: 60,
		paidBudgetCents: 200,
		costCents: 18,
		tokensIn: 6200,
		tokensOut: 1400,
		startedAt: new Date('2026-05-06T10:00:00Z'),
		completedAt: new Date('2026-05-06T10:02:12Z'),
		attachSources: [{ sourceId: 'src_exa_002', costCents: 4 }],
		paidSpend: [
			{
				provider: 'hunter',
				tool: 'hunter_enrich',
				amountCents: 5,
				quotaUnits: 1,
				quotaUnit: 'requests',
				autoApproved: true,
			},
			...Array.from({ length: 6 }, () => ({
				provider: 'hunter',
				tool: 'hunter_verify',
				amountCents: 1,
				quotaUnits: 1,
				quotaUnit: 'verifications',
				autoApproved: true,
			})),
		],
	},

	// ── Long-form / multi-run coverage ────────────────────────
	// More runs per company so the run-list view has volume; long
	// briefs + rich findings exercise the structured findings views
	// past their happy path.

	{
		key: 'audit-deep',
		companySlug: 'cal-pep-fonda',
		query: 'Cal Pep Fonda — full booking & operations audit',
		mode: 'deep',
		schemaName: 'company_enrichment_v1',
		kind: 'leaf',
		status: 'succeeded',
		findings: {
			enrichment: {
				industry: 'restaurants',
				size_range: '6-10',
				pain_points:
					'Saturday walk-up loss ~15%; no-show rate 12% on phone bookings.',
				current_tools: 'Llibreta paper + WhatsApp + 3 phone lines.',
				products_fit: ['gestio-reserves', 'web-starter'],
				tags: ['gastro', 'garraf', 'audit'],
				location: 'Vilanova i la Geltrú',
				country: 'ES',
				latitude: 41.2241,
				longitude: 1.7254,
				citations: [
					{
						source_id: 'src_firecrawl_001',
						quote: '60 covers, 2 services/day',
						confidence: 0.92,
					},
				],
			},
			competitors: [
				{
					name: 'Maritim Vilanova',
					website: 'https://maritimvilanova.cat',
					why: 'Same town, uses TheFork — pays 15% commission.',
					citations: [{ source_id: 'src_firecrawl_001', confidence: 0.7 }],
				},
				{
					name: 'Restaurant Sumat',
					website: 'https://sumat.cat',
					why: 'Adjacent gastrobar, owns its booking flow + prepayment.',
					citations: [{ source_id: 'src_firecrawl_001', confidence: 0.6 }],
				},
			],
			proposed_updates: [
				{
					subject_table: 'companies',
					subject_id: '<cal-pep-id>',
					expected_version: 1,
					fields: { sizeRange: '6-10', country: 'ES' },
					reason: 'Confirmed via on-site visit and Google Business Profile.',
					citations: [{ source_id: 'src_firecrawl_001' }],
				},
			],
		},
		briefMd: BRIEF_LONG_RESTAURANT_AUDIT,
		budgetCents: 200,
		costCents: 88,
		tokensIn: 24300,
		tokensOut: 6800,
		startedAt: new Date('2026-04-18T09:30:00Z'),
		completedAt: new Date('2026-04-18T09:36:14Z'),
		attachSources: [{ sourceId: 'src_firecrawl_001', costCents: 8 }],
	},
	{
		key: 'contacts-history',
		companySlug: 'cal-pep-fonda',
		query: 'Cal Pep Fonda — staff who answer the phone bookings',
		mode: 'quick',
		schemaName: 'contact_discovery_v1',
		kind: 'leaf',
		status: 'succeeded',
		findings: {
			contacts: [
				{
					name: 'Pep Casals',
					role: 'Owner',
					email: 'pep@calpepfonda.cat',
					phone: '+34 938 123 456',
					is_decision_maker: true,
					citations: [{ source_id: 'src_firecrawl_001' }],
				},
				{
					name: 'Núria Vidal',
					role: 'Maître',
					phone: '+34 938 123 457',
					is_decision_maker: false,
					notes: 'Handles 70% of inbound reservation calls.',
					citations: [],
				},
			],
		},
		briefMd:
			'## Cal Pep — front-of-house contacts\nPep is the buyer; Núria is the day-to-day operator who will live with the new system. Win her over first.',
		budgetCents: 30,
		costCents: 11,
		tokensIn: 3800,
		tokensOut: 950,
		startedAt: new Date('2026-01-22T11:00:00Z'),
		completedAt: new Date('2026-01-22T11:00:42Z'),
	},
	{
		key: 'industrial-landscape',
		companySlug: 'ferros-baix-llobregat',
		query: 'industrial automation landscape Catalonia 11-50 employees',
		mode: 'deep',
		schemaName: 'competitor_scan_v1',
		kind: 'leaf',
		status: 'succeeded',
		findings: {
			competitors: RICH_COMPETITORS,
			market_summary: {
				total_competitors_found: 14,
				market_maturity: 'fragmented',
				key_differentiators: [
					'real-time stock visibility',
					'ERP integration depth',
					'on-site implementation team',
				],
				citations: [{ source_id: 'src_registry_001' }],
			},
		},
		briefMd: BRIEF_LONG_INDUSTRIAL_AUTOMATION,
		budgetCents: 120,
		costCents: 64,
		tokensIn: 19400,
		tokensOut: 4900,
		startedAt: new Date('2026-03-02T10:00:00Z'),
		completedAt: new Date('2026-03-02T10:04:08Z'),
		attachSources: [{ sourceId: 'src_registry_001', costCents: 0 }],
	},
	{
		key: 'prospects-similar',
		companySlug: 'ferros-baix-llobregat',
		query: 'industrial peers similar to Ferros BL — Baix Llobregat',
		mode: 'deep',
		schemaName: 'prospect_scan_v1',
		kind: 'leaf',
		status: 'succeeded',
		findings: {
			prospects: [
				{
					name: 'Galvanitzats Penedès',
					website: 'https://galvanitzatspenedes.cat',
					industry: 'manufacturing',
					country: 'ES',
					why_relevant:
						'Posted on LinkedIn about "tancar mes amb errors" — direct match for our automation pitch.',
					pain_indicators: ['linkedin signal', 'no current vendor'],
					citations: [{ source_id: 'src_registry_001' }],
				},
				{
					name: 'Foneria Marina',
					industry: 'manufacturing',
					country: 'ES',
					why_relevant:
						'Family foundry north of Mataró. Heavy Contaplus + Excel. No visible IT vendor.',
					pain_indicators: ['contaplus-only', 'family-run'],
					citations: [{ source_id: 'src_registry_001' }],
				},
				{
					name: 'Acer Inoxidable Vallès',
					industry: 'manufacturing',
					country: 'ES',
					why_relevant:
						'Mid-size stainless-steel fabricator. Existing finance manager publicly looking for ERP help.',
					pain_indicators: ['hiring signal', 'public job post'],
					citations: [],
				},
			],
		},
		briefMd:
			'## Industrial peers — Baix Llobregat / Vallès\n3 prospects with explicit digitisation signals (LinkedIn posts, hiring). All accessible via warm intros from the Ferros BL gerent.',
		budgetCents: 60,
		costCents: 26,
		tokensIn: 8900,
		tokensOut: 2100,
		startedAt: new Date('2026-03-12T09:30:00Z'),
		completedAt: new Date('2026-03-12T09:31:55Z'),
	},
	{
		key: 'competitors',
		companySlug: 'bright-lane-boutique',
		query: 'Bright Lane competitors — Barcelona retail boutiques 1-5 staff',
		mode: 'deep',
		schemaName: 'competitor_scan_v1',
		kind: 'leaf',
		status: 'succeeded',
		findings: {
			competitors: [
				{
					name: 'Galeria Lola',
					website: 'https://galerialola.com',
					description:
						'Barri Gòtic boutique with Shopify storefront and Instagram Shop integration.',
					strengths: ['Shopify-backed', 'multi-currency', 'fast checkout'],
					weaknesses: ['no in-store pickup', 'no member rate'],
					overlap: 'High — same target customer, similar price point.',
					citations: [{ source_id: 'src_exa_002' }],
				},
				{
					name: 'Studio Petit',
					website: 'https://studiopetit.cat',
					description:
						'Gràcia boutique selling locally designed garments. WooCommerce, narrow catalogue.',
					strengths: ['local-designer story'],
					weaknesses: ['slow site', 'broken cart on mobile (verified)'],
					overlap: 'Medium',
					citations: [{ source_id: 'src_exa_002' }],
				},
			],
			market_summary: {
				total_competitors_found: 7,
				market_maturity: 'maturing',
				key_differentiators: ['Instagram-shop fluency', 'curated drops'],
				citations: [{ source_id: 'src_exa_002' }],
			},
		},
		briefMd:
			'## Bright Lane — Barcelona competitive map\n7 boutiques in the same niche. Galeria Lola is the leader; Studio Petit has technical debt. Bright Lane can win on speed-to-market for Instagram drops.',
		budgetCents: 50,
		costCents: 24,
		tokensIn: 8800,
		tokensOut: 2200,
		startedAt: new Date('2026-03-14T15:00:00Z'),
		completedAt: new Date('2026-03-14T15:02:10Z'),
		attachSources: [{ sourceId: 'src_exa_002', costCents: 4 }],
	},
	{
		key: 'enrichment-running',
		companySlug: 'bright-lane-boutique',
		query: 'Bright Lane Boutique — enrich with revenue + footprint signals',
		mode: 'deep',
		schemaName: 'company_enrichment_v1',
		kind: 'leaf',
		status: 'running',
		findings: {},
		briefMd: null,
		budgetCents: 60,
		costCents: 8,
		tokensIn: 2900,
		tokensOut: 0,
		startedAt: new Date('2026-04-12T09:00:00Z'),
	},
	{
		key: 'local-seo-deep',
		companySlug: 'electricitat-del-valles',
		query: 'Electricitat del Vallès — local SEO baseline + recommendations',
		mode: 'deep',
		schemaName: 'freeform',
		kind: 'leaf',
		status: 'succeeded',
		findings: {
			proposed_updates: [
				{
					subject_table: 'companies',
					subject_id: '<electricitat-id>',
					expected_version: 1,
					fields: { website: 'https://electricitatvalles.cat' },
					reason: 'Confirmed live, but technical SEO score 32/100.',
					citations: [],
				},
			],
		},
		briefMd:
			'## Electricitat del Vallès — local SEO baseline\nGoogle Business Profile incomplete. Schema.org missing on the site. Reviews hidden behind a JS-only widget. Recommend Web Starter refresh + GBP optimisation.',
		budgetCents: 40,
		costCents: 12,
		tokensIn: 4400,
		tokensOut: 900,
		startedAt: new Date('2026-02-28T14:00:00Z'),
		completedAt: new Date('2026-02-28T14:01:08Z'),
	},
	{
		key: 'bakery-cluster',
		companySlug: 'forn-de-pa-queralt',
		query: 'artisan bakeries Berguedà + Bages — peer cluster',
		mode: 'deep',
		schemaName: 'prospect_scan_v1',
		kind: 'leaf',
		status: 'succeeded',
		findings: {
			prospects: [
				{
					name: 'Forn La Coloma',
					industry: 'restaurants',
					country: 'ES',
					why_relevant:
						'Berguedà obrador, similar size; runs Saturday market in Berga next to Forn Queralt.',
					pain_indicators: ['no-web', 'cash-only'],
					citations: [],
				},
				{
					name: 'Pa de Cardona',
					industry: 'restaurants',
					country: 'ES',
					why_relevant:
						'Bages obrador with Instagram preorder via DM — overwhelmed weekly.',
					pain_indicators: ['DM-only orders'],
					citations: [],
				},
			],
		},
		briefMd:
			'## Berguedà + Bages bakery cluster\n2 nearby obradors with the exact same DM-driven preorder pain. A shared booking + pickup flow could be sold as a co-op pilot.',
		budgetCents: 40,
		costCents: 14,
		tokensIn: 5400,
		tokensOut: 1100,
		startedAt: new Date('2026-04-02T10:30:00Z'),
		completedAt: new Date('2026-04-02T10:31:40Z'),
	},
	{
		key: 'enrichment-retry',
		companySlug: 'coastal-freight',
		query: 'Coastal Freight — registry retry after einforma quota refill',
		mode: 'deep',
		schemaName: 'company_enrichment_v1',
		kind: 'leaf',
		status: 'succeeded',
		findings: {
			enrichment: {
				industry: 'transport',
				size_range: '11-25',
				pain_points: 'Paper-based delivery notes; lost paperwork rate 3%.',
				current_tools: 'Paper + Sage 200 + WhatsApp.',
				products_fit: ['automatitzacions'],
				tags: ['logistics', 'maresme'],
				country: 'ES',
				location: 'Mataró',
				latitude: 41.5388,
				longitude: 2.4449,
				address: "Polígon Pla d'en Boet, Mataró",
				citations: [{ source_id: 'src_exa_001' }],
			},
		},
		briefMd: BRIEF_LONG_LOGISTICS_DIGITISATION,
		budgetCents: 100,
		paidBudgetCents: 200,
		costCents: 38,
		tokensIn: 12100,
		tokensOut: 3200,
		startedAt: new Date('2026-05-02T08:00:00Z'),
		completedAt: new Date('2026-05-02T08:03:18Z'),
		attachSources: [
			{ sourceId: 'src_exa_001', costCents: 4 },
			{ sourceId: 'src_report_001', costCents: 150 },
		],
		paidSpend: [
			{
				provider: 'einforma',
				tool: 'company_report',
				amountCents: 150,
				quotaUnits: 1,
				quotaUnit: 'reports',
				sourceId: 'src_report_001',
				autoApproved: false,
			},
		],
	},
	{
		key: 'prospects-queued',
		companySlug: 'coastal-freight',
		query: 'logistics SMEs in Maresme + Vallès Oriental — peer scan',
		mode: 'quick',
		schemaName: 'prospect_scan_v1',
		kind: 'leaf',
		status: 'queued',
		findings: {},
		briefMd: null,
		budgetCents: 30,
		costCents: 0,
		tokensIn: 0,
		tokensOut: 0,
	},
	{
		key: 'rate-strategy',
		companySlug: 'hostal-pirineu',
		query: 'Hostal del Pirineu — rate strategy & break-even modelling',
		mode: 'deep',
		schemaName: 'company_enrichment_v1',
		kind: 'leaf',
		status: 'succeeded',
		findings: {
			enrichment: {
				industry: 'hospitality',
				size_range: '6-10',
				pain_points:
					'Booking.com 18% commission; rate-parity clause limits direct discounting.',
				current_tools: 'Booking + paper register.',
				products_fit: ['gestio-reserves', 'web-starter'],
				tags: ['turisme', 'ribagorça', 'rate-strategy'],
				location: 'Benasc',
				country: 'ES',
				citations: [{ source_id: 'src_firecrawl_003', confidence: 0.95 }],
			},
			contacts: RICH_CONTACTS_HOSTAL,
			proposed_updates: [
				{
					subject_table: 'companies',
					subject_id: '<hostal-id>',
					expected_version: 1,
					fields: {
						painPoints: 'Booking 18% commission; wants direct channel < 5%.',
						currentTools: 'Booking + manual register.',
					},
					reason: 'Quoted by owner Arnau in interview.',
					citations: [{ source_id: 'src_firecrawl_003' }],
				},
			],
		},
		briefMd: BRIEF_LONG_HOSTAL_DEEP_DIVE,
		budgetCents: 120,
		costCents: 58,
		tokensIn: 17800,
		tokensOut: 4400,
		startedAt: new Date('2026-04-08T09:00:00Z'),
		completedAt: new Date('2026-04-08T09:04:42Z'),
		attachSources: [{ sourceId: 'src_firecrawl_003', costCents: 4 }],
	},
	{
		key: 'similar-accommodations',
		companySlug: 'hostal-pirineu',
		query: 'similar boutique accommodations — Pirineu + Empordà',
		mode: 'deep',
		schemaName: 'prospect_scan_v1',
		kind: 'leaf',
		status: 'succeeded',
		findings: {
			prospects: RICH_PROSPECTS_GIRONA,
		},
		briefMd:
			'## Pirineu + Empordà boutique accommodation cluster\n4 prospects with the same Booking-commission pain. Hostal del Pirineu can be the case study for the rest.',
		budgetCents: 60,
		costCents: 22,
		tokensIn: 7600,
		tokensOut: 1900,
		startedAt: new Date('2026-04-20T11:00:00Z'),
		completedAt: new Date('2026-04-20T11:01:48Z'),
		toolLog: TOOL_LOG_DEEP,
	},
	{
		key: 'competitors-pirineu',
		companySlug: 'hostal-pirineu',
		query: 'direct booking platforms used by Pirineu hostals',
		mode: 'quick',
		schemaName: 'competitor_scan_v1',
		kind: 'leaf',
		status: 'succeeded',
		findings: {
			competitors: [
				{
					name: 'Cloudbeds',
					website: 'https://cloudbeds.com',
					description:
						'PMS + booking engine bundle; popular with mid-size hostals.',
					strengths: ['mature PMS', 'channel manager'],
					weaknesses: ['monthly cost', 'overkill for 12 rooms'],
					overlap: 'High',
					citations: [],
				},
				{
					name: 'SmartHotel',
					website: 'https://smarthotel.com',
					description:
						'Spain-focused PMS + booking engine, Spanish-speaking support.',
					strengths: ['local support'],
					weaknesses: ['dated UI', 'no Stripe integration'],
					overlap: 'Medium',
					citations: [],
				},
			],
			market_summary: {
				total_competitors_found: 4,
				market_maturity: 'mature',
				citations: [],
			},
		},
		briefMd:
			'## Booking-engine alternatives\nCloudbeds and SmartHotel dominate. Both overkill for 12 rooms. Bespoke pitch beats them on price and Stripe-first checkout.',
		budgetCents: 30,
		costCents: 12,
		tokensIn: 4200,
		tokensOut: 1100,
		startedAt: new Date('2026-04-25T10:00:00Z'),
		completedAt: new Date('2026-04-25T10:00:55Z'),
	},
	{
		key: 'enrichment-cancelled',
		companySlug: 'distribuciones-martinez',
		query: 'Distribuciones Martínez — registry deep dive',
		mode: 'deep',
		schemaName: 'company_enrichment_v1',
		kind: 'leaf',
		status: 'cancelled',
		findings: {},
		briefMd: null,
		budgetCents: 60,
		costCents: 6,
		tokensIn: 1900,
		tokensOut: 0,
		startedAt: new Date('2026-04-04T11:00:00Z'),
		completedAt: new Date('2026-04-04T11:00:14Z'),
	},
	{
		key: 'competitors-alzira',
		companySlug: 'distribuciones-martinez',
		query: 'distribuidoras alimentarias en Ribera Alta — Alzira',
		mode: 'quick',
		schemaName: 'competitor_scan_v1',
		kind: 'leaf',
		status: 'succeeded',
		findings: {
			competitors: [
				{
					name: 'Frutas Hermanos Pérez',
					website: 'https://fruperez.es',
					description:
						'Major Ribera Alta distributor; 50+ employees; runs SAP.',
					strengths: ['scale', 'mature ERP'],
					weaknesses: ['rigid contracts'],
					overlap: 'High',
					citations: [],
				},
			],
			market_summary: {
				total_competitors_found: 3,
				market_maturity: 'concentrated',
				citations: [],
			},
		},
		briefMd:
			'## Distribuidoras Ribera Alta\n3 incumbents, top one runs SAP. Distribuciones Martínez can compete on flexibility for small retail clients.',
		budgetCents: 30,
		costCents: 10,
		tokensIn: 3700,
		tokensOut: 900,
		startedAt: new Date('2026-04-12T10:00:00Z'),
		completedAt: new Date('2026-04-12T10:00:46Z'),
	},
	{
		key: 'post-mortem',
		companySlug: 'park-stone-design',
		query: 'Park & Stone Design — why we lost and what to learn',
		mode: 'quick',
		schemaName: 'freeform',
		kind: 'leaf',
		status: 'succeeded',
		findings: { proposed_updates: [] },
		briefMd:
			'## Park & Stone — post-mortem\nProspect already had a vendor. Polite decline. Lesson: vendor-discovery question goes earlier in the qualification flow.',
		budgetCents: 20,
		costCents: 4,
		tokensIn: 1400,
		tokensOut: 320,
		startedAt: new Date('2026-02-22T16:00:00Z'),
		completedAt: new Date('2026-02-22T16:00:18Z'),
	},
	{
		key: 'cluster-empordà',
		companySlug: 'ceramiques-emporda',
		query: 'Empordà artisan cluster — opportunity map',
		mode: 'deep',
		schemaName: 'company_enrichment_v1',
		kind: 'leaf',
		status: 'succeeded',
		findings: {
			enrichment: {
				industry: 'manufacturing',
				size_range: '6-10',
				pain_points:
					'Sells only at the workshop and a stall during the Fira de Ceràmica.',
				current_tools: 'Static Wordpress + Instagram.',
				products_fit: ['ecommerce-local', 'web-starter'],
				tags: ['artesania', 'empordà', 'cluster'],
				location: "La Bisbal d'Empordà",
				country: 'ES',
				citations: [{ source_id: 'src_firecrawl_002' }],
			},
		},
		briefMd: BRIEF_LONG_EMPORDA_CERAMICS,
		budgetCents: 80,
		costCents: 32,
		tokensIn: 11200,
		tokensOut: 2700,
		startedAt: new Date('2026-04-10T14:00:00Z'),
		completedAt: new Date('2026-04-10T14:02:46Z'),
		attachSources: [{ sourceId: 'src_firecrawl_002', costCents: 5 }],
	},
	{
		key: 'workshop-contacts',
		companySlug: 'ceramiques-emporda',
		query: 'Ceràmiques Empordà — workshop owner + apprentices',
		mode: 'quick',
		schemaName: 'contact_discovery_v1',
		kind: 'leaf',
		status: 'succeeded',
		findings: {
			contacts: [
				{
					name: 'Marta Pla',
					role: 'Owner / Master ceramist',
					email: 'marta@ceramiquesemporda.cat',
					is_decision_maker: true,
					citations: [{ source_id: 'src_firecrawl_002' }],
				},
				{
					name: 'Joan Costa',
					role: 'Apprentice',
					is_decision_maker: false,
					notes: 'Manages the Instagram account, runs photo shoots.',
					citations: [],
				},
			],
		},
		briefMd:
			'## Workshop contacts\nMarta is the buyer, Joan is the influencer. Sell the ecommerce package as "Joan can keep posting; Marta can keep throwing pots".',
		budgetCents: 25,
		costCents: 8,
		tokensIn: 2900,
		tokensOut: 700,
		startedAt: new Date('2026-04-15T15:00:00Z'),
		completedAt: new Date('2026-04-15T15:00:32Z'),
	},
	{
		key: 'closeout',
		companySlug: 'tancaments-garraf',
		query: 'Tancaments Garraf — close-out report',
		mode: 'quick',
		schemaName: 'freeform',
		kind: 'leaf',
		status: 'succeeded',
		findings: { proposed_updates: [] },
		briefMd:
			"## Tancaments Garraf — close-out\nContract signed; engagement archived. Ramon promised a referral to a sister company in Sant Sadurní d'Anoia.",
		budgetCents: 15,
		costCents: 3,
		tokensIn: 900,
		tokensOut: 220,
		startedAt: new Date('2026-04-15T11:00:00Z'),
		completedAt: new Date('2026-04-15T11:00:09Z'),
	},
	{
		key: 'consultoria-prospects',
		companySlug: 'consultoria-beta',
		query: 'consultoria valencia — adjacent prospects',
		mode: 'deep',
		schemaName: 'prospect_scan_v1',
		kind: 'leaf',
		status: 'succeeded',
		findings: {
			prospects: [
				{
					name: 'Consultoria Vega',
					industry: 'other',
					country: 'ES',
					why_relevant:
						'Adjacent niche to Beta; same target customer (boutique B2B firms).',
					pain_indicators: ['static brochure', 'gmail addresses'],
					citations: [],
				},
				{
					name: 'Asesores Riba',
					industry: 'other',
					country: 'ES',
					why_relevant:
						'Tax + ops consultancy in València; same buyer profile.',
					pain_indicators: ['no website analytics'],
					citations: [],
				},
			],
		},
		briefMd:
			'## Valencia consultancy peers\nTwo adjacent firms; same buyer, similar pain. Cross-sell potential after Beta lands.',
		budgetCents: 30,
		costCents: 11,
		tokensIn: 4100,
		tokensOut: 980,
		startedAt: new Date('2026-04-20T09:00:00Z'),
		completedAt: new Date('2026-04-20T09:00:42Z'),
		toolLog: TOOL_LOG_CACHE_HIT,
	},
	{
		key: 'fantasma-failed',
		companySlug: 'empresa-fantasma',
		query: "L'Ànec d'Or — verify business is still operating",
		mode: 'quick',
		schemaName: 'freeform',
		kind: 'leaf',
		status: 'failed',
		findings: { error: 'all sources stale; cannot confirm operating status' },
		briefMd: null,
		budgetCents: 20,
		costCents: 6,
		tokensIn: 2100,
		tokensOut: 280,
		startedAt: new Date('2026-04-25T10:00:00Z'),
		completedAt: new Date('2026-04-25T10:00:28Z'),
		toolLog: TOOL_LOG_FAILED,
	},
	{
		key: 'jove-contacts',
		companySlug: 'taller-mecanic-jove',
		query: 'Taller Mecànic Jove — Marc + crew contact discovery',
		mode: 'quick',
		schemaName: 'contact_discovery_v1',
		kind: 'leaf',
		status: 'succeeded',
		findings: {
			contacts: [
				{
					name: 'Marc Jove',
					role: 'Owner',
					linkedin: 'https://linkedin.com/in/marcjove',
					is_decision_maker: true,
					notes:
						'Active on Instagram; replies to DMs in <4 h. No published email.',
					citations: [],
				},
			],
		},
		briefMd:
			'## Marc Jove — single contact\nNo published email; Instagram DM is the only working channel. Schedule via DM.',
		budgetCents: 20,
		costCents: 5,
		tokensIn: 1700,
		tokensOut: 380,
		startedAt: new Date('2026-04-28T11:00:00Z'),
		completedAt: new Date('2026-04-28T11:00:18Z'),
		toolLog: TOOL_LOG_WITH_RETRY,
	},

	// ── Long-tail expansion: 4–5 runs/company, ≥3 schemas each ────
	// Most below are long-form succeeded runs reusing the BRIEF_LONG_*
	// + RICH_* fixtures; duplication across companies is intentional
	// so the run-list view feels populated without bespoke prose.

	{
		key: 'competitors-bcn',
		companySlug: 'cal-pep-fonda',
		query: 'Vilanova + Garraf seafood restaurants — competitive map',
		mode: 'deep',
		schemaName: 'competitor_scan_v1',
		kind: 'leaf',
		status: 'succeeded',
		findings: {
			competitors: [
				{
					name: 'Maritim Vilanova',
					website: 'https://maritimvilanova.cat',
					description:
						'Direct rival on the same paseo; books via TheFork at 15% commission.',
					strengths: ['TheFork volume', 'beachfront terrace'],
					weaknesses: ['commission cost', 'no member rate'],
					overlap: 'High',
					citations: [{ source_id: 'src_firecrawl_001', confidence: 0.74 }],
				},
				{
					name: 'Restaurant Sumat',
					website: 'https://sumat.cat',
					description:
						'Adjacent gastrobar; runs its own booking + 10€ deposit.',
					strengths: ['low no-show rate', 'direct channel'],
					weaknesses: ['narrow menu', 'limited covers'],
					overlap: 'High',
					citations: [{ source_id: 'src_firecrawl_001', confidence: 0.66 }],
				},
				{
					name: 'Bodega 1900',
					website: 'https://bodega1900.cat',
					description:
						'Tapas bodega in Sant Pere de Ribes; SMS reminders, no deposit.',
					strengths: ['SMS reminders', 'review velocity'],
					weaknesses: ['cramped layout'],
					overlap: 'Medium',
					citations: [],
				},
				{
					name: 'Casa Magí',
					description:
						"Vilanova locals' classic; phone-only, perceived as the 'old guard'.",
					strengths: ['regulars'],
					weaknesses: ['no online presence'],
					overlap: 'Medium',
					citations: [],
				},
				{
					name: 'Can Pinxo',
					website: 'https://canpinxo.cat',
					description:
						'Sitges-side seafood place; Shopify-style site, takeaway via Glovo.',
					strengths: ['takeaway channel'],
					weaknesses: ['no in-house booking'],
					overlap: 'Medium',
					citations: [],
				},
			],
			market_summary: {
				total_competitors_found: 9,
				market_maturity: 'fragmented',
				key_differentiators: [
					'direct booking flow',
					'SMS reminders',
					'deposit-based no-show prevention',
				],
				citations: [{ source_id: 'src_firecrawl_001' }],
			},
		},
		briefMd:
			'## Cal Pep — competitive map\n9 nearby restaurants. The mid-tier ones use TheFork at 15%; only Sumat owns its booking. Cal Pep can leapfrog by going direct from day one.',
		budgetCents: 60,
		costCents: 28,
		tokensIn: 11400,
		tokensOut: 2900,
		startedAt: new Date('2026-04-19T10:00:00Z'),
		completedAt: new Date('2026-04-19T10:02:38Z'),
		attachSources: [{ sourceId: 'src_firecrawl_001', costCents: 4 }],
	},
	{
		key: 'decision-makers',
		companySlug: 'cal-pep-fonda',
		query: 'Cal Pep Fonda — full decision-maker map for the close',
		mode: 'deep',
		schemaName: 'freeform',
		kind: 'leaf',
		status: 'succeeded',
		findings: { proposed_updates: [] },
		briefMd: BRIEF_LONG_DECISION_MAKERS,
		budgetCents: 50,
		costCents: 22,
		tokensIn: 8400,
		tokensOut: 2100,
		startedAt: new Date('2026-04-29T11:00:00Z'),
		completedAt: new Date('2026-04-29T11:30:42Z'),
		toolLog: TOOL_LOG_PHONE_INTERVIEW,
	},
	{
		key: 'contacts-decision-makers',
		companySlug: 'ferros-baix-llobregat',
		query: 'Ferros BL — full decision-maker contact map',
		mode: 'deep',
		schemaName: 'contact_discovery_v1',
		kind: 'leaf',
		status: 'succeeded',
		findings: {
			contacts: RICH_CONTACTS_FERROS,
			proposed_updates: [
				{
					subject_table: 'companies',
					subject_id: '<ferros-id>',
					expected_version: 1,
					fields: { painPoints: 'Manual invoicing closing the month.' },
					reason: 'Confirmed by both CEO and CFO in interview.',
					citations: [{ source_id: 'src_registry_001' }],
				},
			],
		},
		briefMd:
			'## Ferros BL — decision-maker map\n4 contacts mapped: David (CEO, buyer), Marta (CFO, real budget owner), Jordi (operations, day-to-day user), Anna (consultant IT, validates integration). Win Marta with a clean ROI table; warm up Jordi before the demo.',
		budgetCents: 60,
		costCents: 26,
		tokensIn: 9200,
		tokensOut: 2400,
		startedAt: new Date('2026-03-18T09:00:00Z'),
		completedAt: new Date('2026-03-18T09:02:18Z'),
		attachSources: [{ sourceId: 'src_registry_001', costCents: 0 }],
	},
	{
		key: 'rollout-plan',
		companySlug: 'ferros-baix-llobregat',
		query: 'Ferros BL — phased rollout plan & risk log',
		mode: 'deep',
		schemaName: 'freeform',
		kind: 'leaf',
		status: 'succeeded',
		findings: { proposed_updates: [] },
		briefMd: BRIEF_LONG_INDUSTRIAL_AUTOMATION,
		budgetCents: 50,
		costCents: 19,
		tokensIn: 6900,
		tokensOut: 1700,
		startedAt: new Date('2026-04-04T10:00:00Z'),
		completedAt: new Date('2026-04-04T10:01:48Z'),
	},
	{
		key: 'prospects-bcn-retail',
		companySlug: 'bright-lane-boutique',
		query: 'Barcelona boutique retail — peer prospects for cross-sell',
		mode: 'deep',
		schemaName: 'prospect_scan_v1',
		kind: 'leaf',
		status: 'succeeded',
		findings: {
			prospects: [
				{
					name: 'Estudi Marró',
					industry: 'comerç',
					country: 'ES',
					why_relevant: 'Gràcia concept store with own brand; sells via DMs.',
					pain_indicators: ['DM-only', 'no payment'],
					citations: [{ source_id: 'src_exa_002' }],
				},
				{
					name: 'Tela Cruda',
					website: 'https://telacruda.cat',
					industry: 'comerç',
					country: 'ES',
					why_relevant:
						'Born sustainable-textile boutique; broken cart, no payment integration.',
					pain_indicators: ['broken-cart', 'no-payment'],
					citations: [{ source_id: 'src_exa_002' }],
				},
				{
					name: 'Casa Petita',
					industry: 'comerç',
					country: 'ES',
					why_relevant: 'Eixample kids brand. Pop-ups but no online channel.',
					pain_indicators: ['no-online', 'pop-up driven'],
					citations: [],
				},
				{
					name: 'Prendes Vell',
					industry: 'comerç',
					country: 'ES',
					why_relevant: 'Gòtic vintage shop selling via Wallapop links.',
					pain_indicators: ['marketplace-leaning'],
					citations: [],
				},
				{
					name: 'El Modisto',
					industry: 'comerç',
					country: 'ES',
					why_relevant: 'Sant Antoni bespoke menswear; deposits via Bizum.',
					pain_indicators: ['Bizum-only payments'],
					citations: [],
				},
				{
					name: 'Florín',
					industry: 'comerç',
					country: 'ES',
					why_relevant: 'Poble Sec florist + lifestyle; ships via WhatsApp.',
					pain_indicators: ['whatsapp-driven'],
					citations: [],
				},
			],
		},
		briefMd: BRIEF_LONG_RETAIL_PROSPECTS_BCN,
		budgetCents: 60,
		costCents: 24,
		tokensIn: 8800,
		tokensOut: 2200,
		startedAt: new Date('2026-04-08T15:00:00Z'),
		completedAt: new Date('2026-04-08T15:02:08Z'),
		attachSources: [{ sourceId: 'src_exa_002', costCents: 4 }],
	},
	{
		key: 'launch-checklist',
		companySlug: 'bright-lane-boutique',
		query: 'Bright Lane — launch-week checklist & risk log',
		mode: 'quick',
		schemaName: 'freeform',
		kind: 'leaf',
		status: 'succeeded',
		findings: { proposed_updates: [] },
		briefMd:
			'## Bright Lane — launch-week checklist\nLaunch the storefront on a Tuesday (low Instagram volume).\n\n### Day -7\n- DNS cutover staging.\n- Stripe live keys swapped.\n- Instagram Shop reconnect.\n\n### Day -1\n- Stock-count parity check.\n- 3-line FAQ refresh on shipping.\n\n### Day 0 (Tuesday)\n- Soft launch at 10:00.\n- First story post 12:00, after lunch traffic.\n- Founder live Q&A 19:00.\n\n### Day +7\n- Review checkout drop-off.\n- Tighten product copy where bounce > 60%.',
		budgetCents: 25,
		costCents: 7,
		tokensIn: 2900,
		tokensOut: 700,
		startedAt: new Date('2026-04-22T09:00:00Z'),
		completedAt: new Date('2026-04-22T09:00:32Z'),
	},
	{
		key: 'enrichment-deep',
		companySlug: 'electricitat-del-valles',
		query: 'Electricitat del Vallès — full company enrichment',
		mode: 'deep',
		schemaName: 'company_enrichment_v1',
		kind: 'leaf',
		status: 'succeeded',
		findings: {
			enrichment: {
				industry: 'manufacturing',
				size_range: '11-25',
				pain_points:
					'Lead capture from Google ads goes to a generic Wordpress form; no qualification, no SLA.',
				current_tools: 'Wordpress + Holded + WhatsApp.',
				products_fit: ['web-starter', 'automatitzacions'],
				tags: ['electricitat', 'vallès', 'lead-gen'],
				location: 'Granollers',
				country: 'ES',
				latitude: 41.6075,
				longitude: 2.2879,
				address: 'Polígon Congost, Granollers',
				citations: [{ source_id: 'src_registry_001', confidence: 0.86 }],
			},
			competitors: [
				{
					name: 'Instal·lacions Bages',
					website: 'https://instalbages.cat',
					why: 'Bages-area peer, ahead on paid ads.',
					citations: [{ source_id: 'src_registry_001', confidence: 0.7 }],
				},
				{
					name: 'Electricitat Osona',
					why: 'Same size, weak digital posture.',
					citations: [],
				},
			],
			proposed_updates: [
				{
					subject_table: 'companies',
					subject_id: '<electricitat-id>',
					expected_version: 1,
					fields: { sizeRange: '11-25', country: 'ES' },
					reason: 'Confirmed via libreBORME + on-site signage check.',
					citations: [{ source_id: 'src_registry_001' }],
				},
			],
		},
		briefMd:
			'## Electricitat del Vallès — enrichment\nGranollers-based, 14 staff, mostly residential urgencies + small commercial. They pay for Google Ads but lose 60%+ of clicks at the form. Best fit: a faster intake with same-day callback SLA.',
		budgetCents: 80,
		costCents: 38,
		tokensIn: 13800,
		tokensOut: 3400,
		startedAt: new Date('2026-03-10T09:00:00Z'),
		completedAt: new Date('2026-03-10T09:03:48Z'),
		attachSources: [{ sourceId: 'src_registry_001', costCents: 0 }],
	},
	{
		key: 'contacts-vallès',
		companySlug: 'electricitat-del-valles',
		query: 'Electricitat del Vallès — owner + dispatch contacts',
		mode: 'quick',
		schemaName: 'contact_discovery_v1',
		kind: 'leaf',
		status: 'succeeded',
		findings: {
			contacts: [
				{
					name: 'Xavi Tort',
					role: 'Owner / electrician',
					email: 'xavi@electricitatvalles.cat',
					phone: '+34 938 660 100',
					is_decision_maker: true,
					notes:
						'On-site most days; reachable by phone evenings. Hates digital tools but trusts his daughter.',
					citations: [],
				},
				{
					name: 'Laia Tort',
					role: 'Dispatch / scheduling',
					email: 'laia@electricitatvalles.cat',
					phone: '+34 938 660 101',
					is_decision_maker: false,
					notes:
						"Xavi's daughter; manages the calendar and inbound calls. Champion of any new system.",
					citations: [],
				},
				{
					name: 'Pere Roig',
					role: 'Senior electrician',
					phone: '+34 938 660 102',
					is_decision_maker: false,
					notes:
						'Long-tenure employee; reluctant to use a phone-based system on-site.',
					citations: [],
				},
			],
		},
		briefMd:
			'## Electricitat del Vallès — contacts\nXavi is the buyer, Laia is the champion. Sell to Laia first; she will sell Xavi.',
		budgetCents: 25,
		costCents: 8,
		tokensIn: 2900,
		tokensOut: 720,
		startedAt: new Date('2026-03-15T11:00:00Z'),
		completedAt: new Date('2026-03-15T11:00:36Z'),
	},
	{
		key: 'prospects-electrical',
		companySlug: 'electricitat-del-valles',
		query: 'Electrical SMEs Catalonia — peer prospects',
		mode: 'deep',
		schemaName: 'prospect_scan_v1',
		kind: 'leaf',
		status: 'succeeded',
		findings: {
			prospects: RICH_PROSPECTS_ELECTRICAL,
		},
		briefMd:
			'## Catalonia electrical SMEs — prospect scan\n3 peers with the same digital-posture pain. Bages and Osona are the warmest; Penedès is a stretch.',
		budgetCents: 40,
		costCents: 14,
		tokensIn: 5400,
		tokensOut: 1300,
		startedAt: new Date('2026-04-06T10:00:00Z'),
		completedAt: new Date('2026-04-06T10:01:24Z'),
	},
	{
		key: 'enrichment-bakery',
		companySlug: 'forn-de-pa-queralt',
		query: 'Forn de Pa Queralt — full enrichment + market presence',
		mode: 'deep',
		schemaName: 'company_enrichment_v1',
		kind: 'leaf',
		status: 'succeeded',
		findings: {
			enrichment: {
				industry: 'restaurants',
				size_range: '1-5',
				pain_points:
					'Stock-out by 11:00 on Saturdays; preorders managed via WhatsApp.',
				current_tools: 'WhatsApp + paper preorder list.',
				products_fit: ['ecommerce-local', 'web-starter'],
				tags: ['fornería', 'berguedà', 'mercats'],
				location: 'Berga',
				country: 'ES',
				address: 'C. Major 12, Berga',
				latitude: 42.1051,
				longitude: 1.8456,
				citations: [],
			},
			competitors: [
				{
					name: 'Forn La Coloma',
					why: 'Berguedà obrador, 3-market presence.',
					citations: [],
				},
				{
					name: 'Pa de Cardona',
					why: 'Bages obrador with Instagram-only orders.',
					citations: [],
				},
			],
		},
		briefMd:
			"## Forn de Pa Queralt — enrichment\nBerga obrador, 4 staff, two market stalls (Berga Wed, Bages alt-Sat). Saturday stock-out at 11:00 is the universal pain. Preorders via WhatsApp managed by Anna; she'll be the system's user.",
		budgetCents: 50,
		costCents: 18,
		tokensIn: 6800,
		tokensOut: 1700,
		startedAt: new Date('2026-03-08T09:30:00Z'),
		completedAt: new Date('2026-03-08T09:32:08Z'),
	},
	{
		key: 'contacts-bakery',
		companySlug: 'forn-de-pa-queralt',
		query: 'Forn Queralt — family + market contacts',
		mode: 'quick',
		schemaName: 'contact_discovery_v1',
		kind: 'leaf',
		status: 'succeeded',
		findings: {
			contacts: RICH_CONTACTS_BAKERY,
		},
		briefMd:
			'## Forn Queralt — contacts\nJoan signs; Anna runs day-to-day; Pere is a market-side ally.',
		budgetCents: 25,
		costCents: 7,
		tokensIn: 2400,
		tokensOut: 580,
		startedAt: new Date('2026-03-25T10:00:00Z'),
		completedAt: new Date('2026-03-25T10:00:28Z'),
	},
	{
		key: 'competitors-bakeries',
		companySlug: 'forn-de-pa-queralt',
		query: 'artisan bakeries Berguedà + Bages — competitor scan',
		mode: 'deep',
		schemaName: 'competitor_scan_v1',
		kind: 'leaf',
		status: 'succeeded',
		findings: {
			competitors: RICH_COMPETITORS_BAKERIES,
			market_summary: {
				total_competitors_found: 6,
				market_maturity: 'fragmented',
				key_differentiators: [
					'multi-market presence',
					'pickup preorder',
					'subscription bread',
				],
				citations: [],
			},
		},
		briefMd:
			'## Berguedà bakery competitors\n3 anchor competitors mapped. None has a working preorder + pickup flow; whoever ships first wins the cluster.',
		budgetCents: 50,
		costCents: 21,
		tokensIn: 7800,
		tokensOut: 1900,
		startedAt: new Date('2026-04-12T14:00:00Z'),
		completedAt: new Date('2026-04-12T14:01:48Z'),
	},
	{
		key: 'contacts-coastal',
		companySlug: 'coastal-freight',
		query: 'Coastal Freight — operations + ops-lead contacts',
		mode: 'quick',
		schemaName: 'contact_discovery_v1',
		kind: 'leaf',
		status: 'succeeded',
		findings: {
			contacts: [
				{
					name: 'James Carter',
					role: 'Founder / CEO',
					email: 'james@coastalfreight.es',
					phone: '+34 932 110 200',
					linkedin: 'https://linkedin.com/in/jamescarter',
					is_decision_maker: true,
					notes:
						'British expat, 18 years in Maresme. Pragmatic; will buy if the pilot proves out.',
					citations: [{ source_id: 'src_exa_001', confidence: 0.85 }],
				},
				{
					name: 'Núria Carbó',
					role: 'Operations manager',
					email: 'nuria@coastalfreight.es',
					phone: '+34 932 110 201',
					is_decision_maker: false,
					notes:
						'Owns the rekey pain. Will be the strongest internal champion.',
					citations: [{ source_id: 'src_exa_001', confidence: 0.78 }],
				},
				{
					name: 'Pep Torres',
					role: 'Senior driver / informal lead',
					phone: '+34 932 110 202',
					is_decision_maker: false,
					notes:
						'25 years on paper. Get him in the pilot; his peer pressure swings the rest of the fleet.',
					citations: [],
				},
			],
		},
		briefMd:
			'## Coastal Freight — contacts\nJames signs; Núria champions; Pep is the informal driver-side lead. The pilot must include Pep or the rollout stalls.',
		budgetCents: 30,
		costCents: 11,
		tokensIn: 4200,
		tokensOut: 1000,
		startedAt: new Date('2026-04-18T10:00:00Z'),
		completedAt: new Date('2026-04-18T10:00:48Z'),
		attachSources: [{ sourceId: 'src_exa_001', costCents: 4 }],
	},
	{
		key: 'logistics-competitors',
		companySlug: 'coastal-freight',
		query: 'logistics SaaS landscape Spain — Sage 200 integrations',
		mode: 'deep',
		schemaName: 'competitor_scan_v1',
		kind: 'leaf',
		status: 'succeeded',
		findings: {
			competitors: [
				{
					name: 'Drivin',
					website: 'https://drivin.com',
					description:
						'Spain-first fleet management platform; popular with mid-size carriers.',
					strengths: ['routing engine', 'Spanish support'],
					weaknesses: ['heavy onboarding', 'not Sage-aware out of the box'],
					overlap: 'High',
					citations: [],
				},
				{
					name: 'Routeique',
					website: 'https://routeique.com',
					description:
						'EN-focused fleet + delivery suite; integrates with Sage Intacct.',
					strengths: ['Sage integration', 'PoD module'],
					weaknesses: ['no Spanish support', 'enterprise-heavy'],
					overlap: 'Medium',
					citations: [],
				},
				{
					name: 'Onfleet',
					website: 'https://onfleet.com',
					description:
						'Last-mile delivery platform; popular with retail logistics.',
					strengths: ['driver app UX'],
					weaknesses: ['weak ERP integration'],
					overlap: 'Medium',
					citations: [],
				},
			],
			market_summary: {
				total_competitors_found: 8,
				market_maturity: 'maturing',
				key_differentiators: [
					'Sage integration',
					'offline capture',
					'PoD self-serve',
				],
				citations: [],
			},
		},
		briefMd:
			'## Logistics SaaS — Sage-aware vendors\n3 dominant vendors, none nails Sage 200 + offline + Spanish support together. Coastal can win on the integration triangle.',
		budgetCents: 50,
		costCents: 19,
		tokensIn: 7100,
		tokensOut: 1700,
		startedAt: new Date('2026-04-26T09:00:00Z'),
		completedAt: new Date('2026-04-26T09:01:38Z'),
	},
	{
		key: 'driver-app-pilot',
		companySlug: 'coastal-freight',
		query: 'Coastal Freight — driver-app 3-week pilot proposal',
		mode: 'deep',
		schemaName: 'freeform',
		kind: 'leaf',
		status: 'succeeded',
		findings: { proposed_updates: [] },
		briefMd: BRIEF_LONG_DELIVERY_NOTES_PILOT,
		budgetCents: 60,
		costCents: 24,
		tokensIn: 8800,
		tokensOut: 2100,
		startedAt: new Date('2026-05-04T08:00:00Z'),
		completedAt: new Date('2026-05-04T08:02:18Z'),
	},
	{
		key: 'channel-strategy',
		companySlug: 'hostal-pirineu',
		query: 'Hostal del Pirineu — channel mix strategy 2026',
		mode: 'deep',
		schemaName: 'freeform',
		kind: 'leaf',
		status: 'succeeded',
		findings: { proposed_updates: [] },
		briefMd: BRIEF_LONG_HOSTAL_DEEP_DIVE,
		budgetCents: 50,
		costCents: 20,
		tokensIn: 7400,
		tokensOut: 1700,
		startedAt: new Date('2026-04-30T11:00:00Z'),
		completedAt: new Date('2026-04-30T11:01:48Z'),
	},
	{
		key: 'logistics-prospects-cluster',
		companySlug: 'distribuciones-martinez',
		query: 'logistics + distribución SMEs Ribera Alta + Maresme — peers',
		mode: 'deep',
		schemaName: 'prospect_scan_v1',
		kind: 'leaf',
		status: 'succeeded',
		findings: {
			prospects: RICH_PROSPECTS_LOGISTICS,
		},
		briefMd:
			'## Distribuidoras + transports peer cluster\n4 prospects with the same digitisation arc as Distribuciones Martínez. Two are warm (LinkedIn signals); two are cold but high-fit.',
		budgetCents: 50,
		costCents: 18,
		tokensIn: 6800,
		tokensOut: 1500,
		startedAt: new Date('2026-04-18T10:00:00Z'),
		completedAt: new Date('2026-04-18T10:01:32Z'),
	},
	{
		key: 'martinez-contacts',
		companySlug: 'distribuciones-martinez',
		query: 'Distribuciones Martínez — buyer + champion contacts',
		mode: 'quick',
		schemaName: 'contact_discovery_v1',
		kind: 'leaf',
		status: 'succeeded',
		findings: {
			contacts: [
				{
					name: 'Carlos Martínez',
					role: 'Owner',
					email: 'carlos@distribucionesmartinez.es',
					phone: '+34 962 410 010',
					is_decision_maker: true,
					notes:
						'Second-generation owner. Open to digital but cost-sensitive; wants a fixed-price scope.',
					citations: [],
				},
				{
					name: 'Lucía Martínez',
					role: 'Operations / sister',
					email: 'lucia@distribucionesmartinez.es',
					phone: '+34 962 410 011',
					is_decision_maker: false,
					notes:
						'Runs day-to-day. Strong champion but defers to Carlos on spend.',
					citations: [],
				},
			],
		},
		briefMd:
			'## Martínez — contacts\nCarlos signs; Lucía champions. Cost-sensitivity is the dominant constraint; lead with a fixed-price pilot offer.',
		budgetCents: 25,
		costCents: 8,
		tokensIn: 2800,
		tokensOut: 700,
		startedAt: new Date('2026-04-22T14:00:00Z'),
		completedAt: new Date('2026-04-22T14:00:32Z'),
	},
	{
		key: 'design-agency-enrichment',
		companySlug: 'park-stone-design',
		query: 'Park & Stone Design — full company enrichment Q2 2026',
		mode: 'deep',
		schemaName: 'company_enrichment_v1',
		kind: 'leaf',
		status: 'succeeded',
		findings: {
			enrichment: {
				industry: 'services',
				size_range: '6-10',
				pain_points:
					'Incumbent vendor restructuring; landing page stale 5 months.',
				current_tools: 'Webflow + Notion + Linear.',
				products_fit: ['web-starter'],
				tags: ['agency', 'design', 'barcelona'],
				location: 'Barcelona',
				country: 'ES',
				address: 'Eixample, Barcelona',
				latitude: 41.391,
				longitude: 2.166,
				citations: [],
			},
			contacts: [
				{
					name: 'Joana Park',
					role: 'Founder',
					email: 'joana@parkstone.design',
					citations: [],
				},
				{
					name: 'Aleix Stone',
					role: 'Co-founder / creative director',
					email: 'aleix@parkstone.design',
					citations: [],
				},
			],
		},
		briefMd: BRIEF_LONG_PARK_STONE_REVISIT,
		budgetCents: 60,
		costCents: 22,
		tokensIn: 8200,
		tokensOut: 1900,
		startedAt: new Date('2026-04-26T10:00:00Z'),
		completedAt: new Date('2026-04-26T10:02:14Z'),
	},
	{
		key: 'contacts-park-stone',
		companySlug: 'park-stone-design',
		query: 'Park & Stone — new design lead post-restructuring',
		mode: 'quick',
		schemaName: 'contact_discovery_v1',
		kind: 'leaf',
		status: 'succeeded',
		findings: {
			contacts: [
				{
					name: 'Joana Park',
					role: 'Founder',
					email: 'joana@parkstone.design',
					linkedin: 'https://linkedin.com/in/joanapark',
					is_decision_maker: true,
					notes:
						'Vendor-loyal; declined us in 2025-Q4. Re-engagement window opening.',
					citations: [],
				},
				{
					name: 'Aleix Stone',
					role: 'Co-founder',
					email: 'aleix@parkstone.design',
					is_decision_maker: false,
					notes: 'Creative director; influences but does not sign.',
					citations: [],
				},
				{
					name: 'Mireia Coll',
					role: 'New design lead (2026 hire)',
					linkedin: 'https://linkedin.com/in/mireiacoll',
					is_decision_maker: false,
					notes:
						'Joined 2026-Q1. Likely ally; warm-introduce via LinkedIn for the audit pitch.',
					citations: [],
				},
			],
		},
		briefMd:
			"## Park & Stone — contacts\nMireia is the new entry point. Don't approach Joana directly until the audit lands.",
		budgetCents: 25,
		costCents: 8,
		tokensIn: 3000,
		tokensOut: 720,
		startedAt: new Date('2026-04-28T15:00:00Z'),
		completedAt: new Date('2026-04-28T15:00:38Z'),
	},
	{
		key: 'competitors-emporda',
		companySlug: 'ceramiques-emporda',
		query: "L'Empordà artisan crafts — competitor scan",
		mode: 'deep',
		schemaName: 'competitor_scan_v1',
		kind: 'leaf',
		status: 'succeeded',
		findings: {
			competitors: [
				{
					name: 'Vidres Palafrugell',
					website: 'https://vidrespalafrugell.cat',
					description: 'Glass workshop; Instagram catalogue but no web shop.',
					strengths: ['Instagram engagement'],
					weaknesses: ['no shop', 'no preorder'],
					overlap: 'High',
					citations: [{ source_id: 'src_firecrawl_002' }],
				},
				{
					name: 'Forja Empordà',
					website: 'https://forjaemporda.cat',
					description:
						'Wrought-iron workshop, La Bisbal area; static Wordpress.',
					strengths: ['regional brand'],
					weaknesses: ['outdated site', 'no analytics'],
					overlap: 'High',
					citations: [{ source_id: 'src_firecrawl_002' }],
				},
				{
					name: 'Tèxtil Pals',
					description: 'Textile workshop; no website at all, sells at fairs.',
					strengths: ['craft authenticity'],
					weaknesses: ['no online'],
					overlap: 'Medium',
					citations: [],
				},
				{
					name: 'Ferro Forjat Begur',
					website: 'https://ferroforjatbegur.cat',
					description: 'Ironwork in Begur; static brochure, gallery only.',
					strengths: ['boutique location'],
					weaknesses: ['no commerce'],
					overlap: 'Medium',
					citations: [],
				},
			],
			market_summary: {
				total_competitors_found: 7,
				market_maturity: 'early',
				key_differentiators: [
					'preorder for pickup',
					'multi-language',
					'wholesale catalogue',
				],
				citations: [],
			},
		},
		briefMd:
			"## L'Empordà crafts — competitor map\n7 workshops in the cluster; none ships ecommerce. Ceràmiques can be the first.",
		budgetCents: 50,
		costCents: 19,
		tokensIn: 6900,
		tokensOut: 1600,
		startedAt: new Date('2026-04-12T11:00:00Z'),
		completedAt: new Date('2026-04-12T11:01:38Z'),
		attachSources: [{ sourceId: 'src_firecrawl_002', costCents: 5 }],
	},
	{
		key: 'cluster-tour',
		companySlug: 'ceramiques-emporda',
		query: "L'Empordà cluster — physical tour & sales-trip plan",
		mode: 'quick',
		schemaName: 'freeform',
		kind: 'leaf',
		status: 'succeeded',
		findings: { proposed_updates: [] },
		briefMd: BRIEF_LONG_EMPORDA_CERAMICS,
		budgetCents: 30,
		costCents: 9,
		tokensIn: 3400,
		tokensOut: 800,
		startedAt: new Date('2026-04-25T10:00:00Z'),
		completedAt: new Date('2026-04-25T10:00:48Z'),
	},
	{
		key: 'enrichment-tancaments',
		companySlug: 'tancaments-garraf',
		query: 'Tancaments Garraf — final enrichment for handover',
		mode: 'deep',
		schemaName: 'company_enrichment_v1',
		kind: 'leaf',
		status: 'succeeded',
		findings: {
			enrichment: {
				industry: 'manufacturing',
				size_range: '6-10',
				pain_points:
					'On-site quoting; no follow-up CRM; review responses sporadic.',
				current_tools: 'WhatsApp Business + Google Business Profile + paper.',
				products_fit: ['web-starter'],
				tags: ['tancaments', 'garraf', 'closeout'],
				location: 'Vilanova i la Geltrú',
				country: 'ES',
				address: 'Polígon Roquetes, Vilanova',
				latitude: 41.2231,
				longitude: 1.7244,
				citations: [{ source_id: 'src_archive_001' }],
			},
			contacts: [
				{
					name: 'Ramon Vidal',
					role: 'Owner',
					phone: '+34 938 110 333',
					citations: [],
				},
				{
					name: 'Maria Vidal',
					role: 'Finance',
					email: 'maria@tancamentsgarraf.cat',
					citations: [],
				},
			],
		},
		briefMd: BRIEF_LONG_TANCAMENTS_HANDOVER,
		budgetCents: 50,
		costCents: 16,
		tokensIn: 6200,
		tokensOut: 1400,
		startedAt: new Date('2026-04-08T11:00:00Z'),
		completedAt: new Date('2026-04-08T11:01:38Z'),
		attachSources: [{ sourceId: 'src_archive_001', costCents: 0 }],
	},
	{
		key: 'tancaments-contacts',
		companySlug: 'tancaments-garraf',
		query: 'Tancaments Garraf — all contacts incl. sister-company lead',
		mode: 'quick',
		schemaName: 'contact_discovery_v1',
		kind: 'leaf',
		status: 'succeeded',
		findings: {
			contacts: RICH_CONTACTS_TANCAMENTS,
		},
		briefMd:
			'## Tancaments Garraf — handover contacts\nRamon is the closed engagement. Maria is the future buyer when the Sant Sadurní sister company spins up.',
		budgetCents: 20,
		costCents: 6,
		tokensIn: 2400,
		tokensOut: 600,
		startedAt: new Date('2026-04-12T10:00:00Z'),
		completedAt: new Date('2026-04-12T10:00:24Z'),
	},
	{
		key: 'consultoria-enrichment',
		companySlug: 'consultoria-beta',
		query: 'Consultoria Beta — full company enrichment',
		mode: 'deep',
		schemaName: 'company_enrichment_v1',
		kind: 'leaf',
		status: 'succeeded',
		findings: {
			enrichment: {
				industry: 'services',
				size_range: '6-10',
				pain_points:
					'Lead intake via gmail; proposal-time average 7 h; knowledge dispersed across laptops.',
				current_tools: 'Gmail + Drive + Notion (light).',
				products_fit: ['web-starter', 'automatitzacions'],
				tags: ['consultoria', 'valencia', 'b2b'],
				location: 'València',
				country: 'ES',
				address: 'Eixample, València',
				latitude: 39.4699,
				longitude: -0.3763,
				citations: [{ source_id: 'src_exa_001' }],
			},
			contacts: [
				{
					name: 'Beatriu Ortega',
					role: 'Founder',
					email: 'b.ortega@consultoriabeta.es',
					citations: [],
				},
			],
			proposed_updates: [
				{
					subject_table: 'companies',
					subject_id: '<consultoria-id>',
					expected_version: 1,
					fields: { country: 'ES', sizeRange: '6-10' },
					reason: 'Confirmed via AEAT registry sample.',
					citations: [{ source_id: 'src_exa_001' }],
				},
			],
		},
		briefMd: BRIEF_LONG_VALENCIA_CONSULTING,
		budgetCents: 80,
		costCents: 32,
		tokensIn: 12200,
		tokensOut: 3000,
		startedAt: new Date('2026-03-28T09:00:00Z'),
		completedAt: new Date('2026-03-28T09:03:08Z'),
		attachSources: [{ sourceId: 'src_exa_001', costCents: 4 }],
	},
	{
		key: 'consultoria-contacts',
		companySlug: 'consultoria-beta',
		query: 'Consultoria Beta — partner + ops contacts',
		mode: 'quick',
		schemaName: 'contact_discovery_v1',
		kind: 'leaf',
		status: 'succeeded',
		findings: {
			contacts: RICH_CONTACTS_CONSULTORIA,
		},
		briefMd:
			'## Beta — contacts\nBeatriu signs; Pau is the power user; Eva runs procurement. Open with a pain-first call to Beatriu.',
		budgetCents: 25,
		costCents: 7,
		tokensIn: 2700,
		tokensOut: 640,
		startedAt: new Date('2026-04-14T11:00:00Z'),
		completedAt: new Date('2026-04-14T11:00:30Z'),
	},
	{
		key: 'consultoria-competitors',
		companySlug: 'consultoria-beta',
		query: 'València boutique consulting — competitor scan',
		mode: 'deep',
		schemaName: 'competitor_scan_v1',
		kind: 'leaf',
		status: 'succeeded',
		findings: {
			competitors: RICH_COMPETITORS_VALENCIA,
			market_summary: {
				total_competitors_found: 12,
				market_maturity: 'fragmented',
				key_differentiators: [
					'proposal turnaround time',
					'methodology IP',
					'digital intake',
				],
				citations: [],
			},
		},
		briefMd:
			'## València consultancies — competitive scan\n12 firms in the niche; none with a fast proposal turnaround. Beta can win on intake + turnaround.',
		budgetCents: 50,
		costCents: 17,
		tokensIn: 6400,
		tokensOut: 1500,
		startedAt: new Date('2026-04-22T10:00:00Z'),
		completedAt: new Date('2026-04-22T10:01:14Z'),
	},
	{
		key: 'fantasma-competitors',
		companySlug: 'empresa-fantasma',
		query: "L'Ànec d'Or — distribuidoras Manresa peer scan",
		mode: 'quick',
		schemaName: 'competitor_scan_v1',
		kind: 'leaf',
		status: 'succeeded',
		findings: {
			competitors: [
				{
					name: 'Distribució Bages',
					description: 'Active distributor in Bages; 12 staff visible.',
					strengths: ['active website', 'public phone'],
					weaknesses: ['legacy stack'],
					overlap: 'Medium',
					citations: [],
				},
				{
					name: 'Magatzem Manresa',
					description: 'Family wholesaler; static site, no online order.',
					strengths: ['locality'],
					weaknesses: ['no digital'],
					overlap: 'High',
					citations: [],
				},
			],
			market_summary: {
				total_competitors_found: 5,
				market_maturity: 'mature',
				citations: [],
			},
		},
		briefMd:
			"## L'Ànec d'Or — adjacent distribuidoras\n5 active peers. If Fantasma is operating they're isolated; if not, Magatzem Manresa is the closest analogue worth a separate touch.",
		budgetCents: 25,
		costCents: 8,
		tokensIn: 2800,
		tokensOut: 640,
		startedAt: new Date('2026-04-29T11:00:00Z'),
		completedAt: new Date('2026-04-29T11:00:36Z'),
	},
	{
		key: 'fantasma-prospects',
		companySlug: 'empresa-fantasma',
		query: 'Manresa industrial belt — small-distributor prospects',
		mode: 'quick',
		schemaName: 'prospect_scan_v1',
		kind: 'leaf',
		status: 'succeeded',
		findings: {
			prospects: RICH_PROSPECTS_FANTASMA,
		},
		briefMd:
			'## Manresa belt — peer prospects\n2 candidates with the same low-signal profile as Fantasma. Worth a postal-mail batch if the cluster ever becomes a target.',
		budgetCents: 20,
		costCents: 5,
		tokensIn: 1900,
		tokensOut: 420,
		startedAt: new Date('2026-05-02T10:00:00Z'),
		completedAt: new Date('2026-05-02T10:00:24Z'),
	},
	{
		key: 'jove-enrichment',
		companySlug: 'taller-mecanic-jove',
		query: 'Taller Mecànic Jove — full Granollers automotive enrichment',
		mode: 'deep',
		schemaName: 'company_enrichment_v1',
		kind: 'leaf',
		status: 'succeeded',
		findings: {
			enrichment: {
				industry: 'services',
				size_range: '6-10',
				pain_points:
					'Instagram-driven inbound; no booking flow; brand refresh launching June 2026.',
				current_tools: 'Instagram + WhatsApp + paper agenda.',
				products_fit: ['gestio-reserves', 'web-starter'],
				tags: ['taller', 'granollers', 'auto'],
				location: 'Granollers',
				country: 'ES',
				latitude: 41.6075,
				longitude: 2.2879,
				address: 'Granollers, Vallès Oriental',
				citations: [],
			},
			competitors: [
				{
					name: 'Pneumàtics Selva',
					website: 'https://pneumaticsselva.cat',
					why: 'Granollers leader; runs Wix-based booking flow.',
					citations: [],
				},
				{
					name: 'Tallers Pep',
					why: 'Cardedeu; WhatsApp-led booking.',
					citations: [],
				},
			],
			proposed_updates: [
				{
					subject_table: 'companies',
					subject_id: '<jove-id>',
					expected_version: 1,
					fields: { sizeRange: '6-10' },
					reason: 'Field visit + Instagram team-page count.',
					citations: [],
				},
			],
		},
		briefMd: BRIEF_LONG_GRANOLLERS_AUTOMOTIVE,
		budgetCents: 80,
		costCents: 30,
		tokensIn: 11800,
		tokensOut: 2900,
		startedAt: new Date('2026-05-01T08:00:00Z'),
		completedAt: new Date('2026-05-01T13:01:42Z'),
		toolLog: TOOL_LOG_FIELD_VISIT,
	},
	{
		key: 'jove-competitors',
		companySlug: 'taller-mecanic-jove',
		query: 'Granollers auto workshops — competitive scan',
		mode: 'deep',
		schemaName: 'competitor_scan_v1',
		kind: 'leaf',
		status: 'succeeded',
		findings: {
			competitors: [
				{
					name: 'Pneumàtics Selva',
					website: 'https://pneumaticsselva.cat',
					description:
						'Granollers leader; Wix-based booking flow; ~5.8k Instagram followers.',
					strengths: ['booking flow', 'follower count'],
					weaknesses: ['generic UX', 'no symptom-photo upload'],
					overlap: 'High',
					citations: [],
				},
				{
					name: 'Mecànica Vallès',
					description: 'Smaller Granollers shop; phone-only.',
					strengths: ['neighborhood loyalty'],
					weaknesses: ['no digital'],
					overlap: 'Medium',
					citations: [],
				},
				{
					name: 'Tallers Pep',
					description: 'Cardedeu-based; WhatsApp booking, strong Instagram.',
					strengths: ['social brand'],
					weaknesses: ['manual scheduling'],
					overlap: 'High',
					citations: [],
				},
				{
					name: 'Auto Nou',
					description: 'La Garriga; phone-only; older buyer profile.',
					strengths: ['regulars'],
					weaknesses: ['no digital'],
					overlap: 'Medium',
					citations: [],
				},
			],
			market_summary: {
				total_competitors_found: 6,
				market_maturity: 'maturing',
				key_differentiators: [
					'photo-of-symptom intake',
					'design-forward brand',
					'follow-up automation',
				],
				citations: [],
			},
		},
		briefMd:
			'## Granollers auto cluster — competitor map\n6 shops mapped. Pneumàtics Selva is the digital leader; Taller Jove can leapfrog on UX (symptom photos + design-forward brand).',
		budgetCents: 50,
		costCents: 18,
		tokensIn: 6800,
		tokensOut: 1600,
		startedAt: new Date('2026-05-03T10:00:00Z'),
		completedAt: new Date('2026-05-03T10:01:32Z'),
	},
	{
		key: 'jove-rebrand-checklist',
		companySlug: 'taller-mecanic-jove',
		query: 'Taller Mecànic Jove — pre-rebrand checklist (June 2026)',
		mode: 'quick',
		schemaName: 'freeform',
		kind: 'leaf',
		status: 'succeeded',
		findings: { proposed_updates: [] },
		briefMd:
			"## Pre-rebrand checklist\n\n### 4 weeks out (mid-May)\n- Reserve the new instagram handle.\n- Lock the photo-shoot date (1 day).\n- Update Google Business Profile category to match the rebrand verticals.\n\n### 2 weeks out\n- Stage new site on a private URL.\n- Pre-approve booking-flow copy with Marc.\n- Brief Marc on the symptom-photo intake; he'll demo it on Instagram.\n\n### Launch week\n- Day 0: feed switch + IG story sequence.\n- Day +1: post the booking-flow demo as a Reel.\n- Day +3: Q&A in stories.\n- Day +7: review booking conversion vs. baseline.\n\n### Risk log\n- The new logo readability on dark backgrounds — verify before printing the workshop sign.\n- Domain redirects: keep the old IG bio link live for 6 weeks at minimum.",
		budgetCents: 25,
		costCents: 6,
		tokensIn: 2200,
		tokensOut: 520,
		startedAt: new Date('2026-05-05T15:00:00Z'),
		completedAt: new Date('2026-05-05T15:00:28Z'),
	},

	// ── LOCAL-DEV: states the long-tail above never reaches ───────
	// One run per otherwise-unreachable findings/lifecycle shape, so
	// the matching UI section (pending paid actions, "Already in CRM",
	// partial brief on a failed run, a cache hit with real cloned
	// findings) renders against real data in local dev.

	// A paid action the agent paused on before spending — drives the
	// `pending_paid_actions` section (UI key: pendingPaidActions).
	{
		key: 'paid-gate',
		companySlug: 'coastal-freight',
		query: 'Coastal Freight — directors + share capital (awaiting paid lookup)',
		mode: 'deep',
		schemaName: 'company_enrichment_v1',
		kind: 'leaf',
		status: 'succeeded',
		findings: {
			enrichment: {
				industry: 'transport',
				size_range: '11-25',
				pain_points:
					'Free sources confirm the fleet but not the directors or share capital.',
				current_tools: 'Paper + Sage 200 + WhatsApp.',
				products_fit: ['automatitzacions'],
				tags: ['logistics', 'maresme'],
				country: 'ES',
				location: 'Mataró',
				citations: [{ source_id: 'src_exa_001', confidence: 0.8 }],
			},
			pending_paid_actions: [
				{
					tool: 'einforma.company_report',
					args: { tax_id: 'B65xxxxxx', depth: 'full' },
					estimated_cents: 150,
					reason:
						'Directors and share capital are only available behind the paid registry report; over the auto-approve cap, so it waits for a click.',
				},
				{
					tool: 'firecrawl.scrape',
					args: { url: 'https://coastalfreight.es/legal', render: true },
					estimated_cents: 5,
					reason:
						'Legal page is JS-rendered; a rendered scrape would confirm the VAT id before paying for the full report.',
				},
			],
		},
		briefMd:
			'## Coastal Freight — blocked on a paid lookup\nFree sources cover the fleet and routes, but directors + share capital sit behind the einforma report. The run paused at the paid gate: approve the report (≈€1.50) to finish enrichment.',
		budgetCents: 100,
		paidBudgetCents: 200,
		costCents: 16,
		tokensIn: 6100,
		tokensOut: 1400,
		startedAt: new Date('2026-05-20T08:00:00Z'),
		completedAt: new Date('2026-05-20T08:01:24Z'),
		attachSources: [{ sourceId: 'src_exa_001', costCents: 4 }],
	},

	// A peer scan that recognised companies already in the CRM — drives
	// the "Already in CRM" section (UI key: discoveredExisting).
	{
		key: 'prospects-known',
		companySlug: 'ferros-baix-llobregat',
		query: 'Baix Llobregat metal fabricators — peer scan (dedup against CRM)',
		mode: 'deep',
		schemaName: 'prospect_scan_v1',
		kind: 'leaf',
		status: 'succeeded',
		findings: {
			prospects: [
				{
					name: 'Mecanitzats Sant Boi',
					website: 'https://mecanitzatssantboi.cat',
					industry: 'manufacturing',
					country: 'ES',
					why_relevant:
						'CNC shop in Sant Boi with manual invoicing; not yet contacted.',
					pain_indicators: ['excel-invoicing', 'no-vendor'],
					citations: [{ source_id: 'src_registry_001' }],
				},
			],
			discovered_existing: [
				{
					subject_table: 'companies',
					subject_id: '<ferros-id>',
					name: 'Ferros Baix Llobregat',
				},
				{
					subject_table: 'companies',
					subject_id: '<electricitat-id>',
					name: 'Electricitat del Vallès',
				},
			],
		},
		briefMd:
			'## Baix Llobregat peers — deduped\nOne genuinely new prospect (Mecanitzats Sant Boi). The scan also re-surfaced two companies already in the CRM, listed under "Already in CRM" so they are not re-added.',
		budgetCents: 50,
		costCents: 21,
		tokensIn: 8200,
		tokensOut: 1900,
		startedAt: new Date('2026-05-18T09:30:00Z'),
		completedAt: new Date('2026-05-18T09:31:48Z'),
		attachSources: [{ sourceId: 'src_registry_001', costCents: 0 }],
	},

	// Failed mid-run, but the partial brief from the work done before
	// the error survives — the realistic "spent tokens, then errored".
	{
		key: 'enrichment-failed-partial',
		companySlug: 'distribuciones-martinez',
		query: 'Distribuciones Martínez — registry enrichment (interrupted)',
		mode: 'deep',
		schemaName: 'company_enrichment_v1',
		kind: 'leaf',
		status: 'failed',
		findings: {
			error: 'einforma report timed out after the web pass completed',
		},
		briefMd:
			'## Distribuciones Martínez — partial (run failed)\nThe free web pass finished before the error: family-run distributor in Alzira, ~15 staff, phone + paper order intake. The paid registry step then timed out, so directors and VAT are still unconfirmed. Safe to retry once the provider recovers.',
		budgetCents: 60,
		paidBudgetCents: 200,
		costCents: 17,
		tokensIn: 6400,
		tokensOut: 820,
		startedAt: new Date('2026-05-22T10:00:00Z'),
		completedAt: new Date('2026-05-22T10:01:36Z'),
	},

	// A cache hit that cloned real prior findings (not an empty
	// freeform) — visually distinct from the cached-freeform run above.
	{
		key: 'competitors-cache-hit',
		companySlug: 'consultoria-beta',
		query: 'València boutique consulting — competitor scan (cached)',
		mode: 'quick',
		schemaName: 'competitor_scan_v1',
		kind: 'cache_hit',
		status: 'succeeded',
		findings: {
			competitors: RICH_COMPETITORS_VALENCIA,
			market_summary: {
				total_competitors_found: 12,
				market_maturity: 'fragmented',
				key_differentiators: [
					'proposal turnaround time',
					'methodology IP',
					'digital intake',
				],
				citations: [],
			},
		},
		briefMd:
			'## València consultancies — competitive scan (cached)\nServed from a prior run within the TTL — same 12-firm landscape, zero spend. Clones the earlier competitor findings verbatim so the cached result is a full scan, not an empty brief.',
		budgetCents: 0,
		costCents: 0,
		tokensIn: 0,
		tokensOut: 0,
		startedAt: new Date('2026-05-15T09:00:00Z'),
		completedAt: new Date('2026-05-15T09:00:00Z'),
		toolLog: TOOL_LOG_CACHE_HIT,
	},

	// ── Runs that gave up, each with its own reason ──────────────
	// The detail view turns reason_code into a sentence explaining what went
	// wrong; without these rows that whole explanation path has no data.
	{
		key: 'no-data-mismatch',
		companySlug: 'empresa-fantasma',
		query: 'enrich Empresa Fantasma from its public web presence',
		mode: 'deep',
		schemaName: 'company_enrichment_v1',
		kind: 'leaf',
		status: 'no_reliable_data',
		reasonCode: 'entity_mismatch',
		entityMatch: 'absent',
		findings: {},
		briefMd: null,
		budgetCents: 50,
		costCents: 12,
		tokensIn: 3100,
		tokensOut: 400,
		startedAt: new Date('2026-05-20T10:00:00Z'),
		completedAt: new Date('2026-05-20T10:01:10Z'),
	},
	{
		key: 'no-data-generic-name',
		companySlug: 'consultoria-beta',
		query: 'enrich Consultoria Beta',
		mode: 'deep',
		schemaName: 'company_enrichment_v1',
		kind: 'leaf',
		status: 'no_reliable_data',
		reasonCode: 'name_too_generic',
		entityMatch: 'weak',
		findings: {},
		briefMd: null,
		budgetCents: 50,
		costCents: 8,
		tokensIn: 2200,
		tokensOut: 300,
		startedAt: new Date('2026-05-20T10:05:00Z'),
		completedAt: new Date('2026-05-20T10:05:40Z'),
	},
	{
		key: 'no-data-no-site',
		companySlug: 'forn-de-pa-queralt',
		query: 'enrich Forn de Pa Queralt',
		mode: 'deep',
		schemaName: 'company_enrichment_v1',
		kind: 'leaf',
		status: 'no_reliable_data',
		reasonCode: 'weak_no_official_site',
		entityMatch: 'weak',
		findings: {},
		briefMd: null,
		budgetCents: 50,
		costCents: 6,
		tokensIn: 1800,
		tokensOut: 260,
		startedAt: new Date('2026-05-20T10:10:00Z'),
		completedAt: new Date('2026-05-20T10:10:30Z'),
	},
	{
		key: 'failed-unreadable',
		companySlug: 'ceramiques-emporda',
		query: 'enrich Ceràmiques Empordà',
		mode: 'deep',
		schemaName: 'company_enrichment_v1',
		kind: 'leaf',
		status: 'failed',
		reasonCode: 'site_unreadable',
		entityMatch: 'strong',
		findings: {},
		briefMd: null,
		budgetCents: 50,
		costCents: 14,
		tokensIn: 2600,
		tokensOut: 320,
		startedAt: new Date('2026-05-20T10:15:00Z'),
		completedAt: new Date('2026-05-20T10:16:05Z'),
	},
	{
		key: 'failed-no-sources',
		companySlug: 'park-stone-design',
		query: 'enrich Park Stone Design',
		mode: 'deep',
		schemaName: 'company_enrichment_v1',
		kind: 'leaf',
		status: 'failed',
		reasonCode: 'no_sources',
		entityMatch: 'absent',
		findings: {},
		briefMd: null,
		budgetCents: 50,
		costCents: 4,
		tokensIn: 900,
		tokensOut: 120,
		startedAt: new Date('2026-05-20T10:20:00Z'),
		completedAt: new Date('2026-05-20T10:20:20Z'),
	},
	{
		key: 'failed-internal',
		companySlug: 'electricitat-del-valles',
		query: 'enrich Electricitat del Vallès',
		mode: 'deep',
		schemaName: 'company_enrichment_v1',
		kind: 'leaf',
		status: 'failed',
		reasonCode: 'internal_error',
		entityMatch: 'strong',
		findings: {},
		briefMd: null,
		budgetCents: 50,
		costCents: 2,
		tokensIn: 400,
		tokensOut: 60,
		startedAt: new Date('2026-05-20T10:25:00Z'),
		completedAt: new Date('2026-05-20T10:25:05Z'),
	},

	// A shape nothing knows how to render, so the raw-JSON fallback in the
	// detail view is reachable.
	{
		key: 'unknown-shape',
		companySlug: 'bright-lane-boutique',
		query: 'experimental extraction for Bright Lane Boutique',
		mode: 'deep',
		schemaName: 'experimental_shape_v9',
		kind: 'leaf',
		status: 'succeeded',
		findings: { anything: { at_all: ['a', 'b'], depth: 2 } },
		briefMd:
			'## Bright Lane — experimental\nAn output shape the UI has no view for.',
		budgetCents: 20,
		costCents: 9,
		tokensIn: 1400,
		tokensOut: 350,
		startedAt: new Date('2026-05-21T09:00:00Z'),
		completedAt: new Date('2026-05-21T09:00:50Z'),
	},

	// ── Proposals across every tier the review inbox sorts into ──
	// "Ready to apply" needs a checkable email channel, a deliverable verdict
	// and enough confidence; everything else lands in "Needs your review".
	{
		key: 'proposals-trusted',
		companySlug: 'cal-pep-fonda',
		query: 'find the people to contact at Cal Pep Fonda',
		mode: 'deep',
		schemaName: 'contact_discovery_v1',
		kind: 'leaf',
		status: 'succeeded',
		findings: {
			proposed_updates: [
				proposal({
					key: 'trusted-fraction',
					citation: {
						sourceId: 'src_firecrawl_001',
						quote: 'Rosa Bertran, cap de cuina',
						confidence: 0.88,
					},
					subjectTable: 'contacts',
					operation: 'create',
					reason: 'Listed as head chef on the team page',
					fields: {
						name: 'Rosa Bertran',
						company_id: CAL_PEP_ID,
						channels: [
							channel('email', 'rosa@calpepfonda.cat', 'deliverable', 0.92),
							channel('phone', '+34 938 123 460', null, null),
						],
					},
				}),
				// Two addresses that disagree, with the bad one listed first: one
				// deliverable address still reaches the person, so this belongs in
				// "Ready to apply" and the best verdict has to win over the first.
				proposal({
					key: 'trusted-mixed-verdicts',
					citation: {
						sourceId: 'src_firecrawl_001',
						quote: 'Sílvia Roig, reserves de grups',
						confidence: 0.9,
					},
					subjectTable: 'contacts',
					operation: 'create',
					reason: 'Group-bookings contact; old address still on the page',
					fields: {
						name: 'Sílvia Roig',
						company_id: CAL_PEP_ID,
						channels: [
							channel('email', 'grups@calpepfonda.es', 'undeliverable', 0.35),
							channel('email', 'silvia@calpepfonda.cat', 'deliverable', 0.94),
						],
					},
				}),
				proposal({
					key: 'trusted-percent',
					citation: {
						sourceId: 'src_firecrawl_001',
						quote: 'Esdeveniments: Ignasi Mora',
						confidence: 0.9,
					},
					subjectTable: 'contacts',
					operation: 'create',
					reason: 'Named as the events contact, verified by the provider',
					fields: {
						name: 'Ignasi Mora',
						company_id: CAL_PEP_ID,
						// Same confidence expressed the other way round: vendors report
						// 0-100 where the model reports 0-1, and both must read as 88%.
						channels: [
							channel('email', 'ignasi@calpepfonda.cat', 'deliverable', 88),
						],
					},
				}),
				proposal({
					key: 'low-confidence',
					citation: {
						sourceId: 'src_exa_001',
						quote: 'Adreces del tipus nom@calpepfonda.cat',
						confidence: 0.35,
					},
					subjectTable: 'contacts',
					operation: 'create',
					reason: 'Guessed from the address pattern of colleagues',
					fields: {
						name: 'Nil Aguiló',
						company_id: CAL_PEP_ID,
						channels: [
							channel('email', 'nil@calpepfonda.cat', 'deliverable', 0.4),
						],
					},
				}),
			],
		},
		briefMd:
			'## Cal Pep Fonda — people\nThree candidate contacts, one of them only a guess.',
		budgetCents: 60,
		costCents: 30,
		tokensIn: 8200,
		tokensOut: 2400,
		startedAt: new Date('2026-05-22T09:00:00Z'),
		completedAt: new Date('2026-05-22T09:02:00Z'),
	},
	{
		key: 'proposals-verdicts',
		companySlug: 'cal-pep-fonda',
		query: 'verify the addresses found for Cal Pep Fonda',
		mode: 'deep',
		schemaName: 'contact_discovery_v1',
		kind: 'leaf',
		status: 'succeeded',
		findings: {
			proposed_updates: [
				proposal({
					key: 'verdict-risky',
					citation: {
						sourceId: 'src_exa_001',
						quote: 'Contacte: berta@calpepfonda.cat',
						confidence: 0.7,
					},
					subjectTable: 'contacts',
					operation: 'create',
					reason: 'Address accepted mail but the provider flags it as risky',
					fields: {
						name: 'Berta Ollé',
						company_id: CAL_PEP_ID,
						channels: [
							channel('email', 'berta@calpepfonda.cat', 'risky', 0.75),
						],
					},
				}),
				proposal({
					key: 'verdict-catch-all',
					citation: {
						sourceId: 'src_exa_001',
						quote: 'El domini accepta qualsevol adreça',
						confidence: 0.5,
					},
					subjectTable: 'contacts',
					operation: 'create',
					reason: 'Domain accepts everything, so the address proves nothing',
					fields: {
						name: 'Quim Vallès',
						company_id: CAL_PEP_ID,
						channels: [
							channel('email', 'quim@calpepfonda.cat', 'catch_all', 0.6),
						],
					},
				}),
				proposal({
					key: 'verdict-undeliverable',
					citation: {
						sourceId: 'src_archive_001',
						quote: 'Fitxa antiga amb ona@calpepfonda.cat',
						confidence: 0.6,
					},
					subjectTable: 'contacts',
					operation: 'create',
					reason: 'Mail to this address bounced during verification',
					fields: {
						name: 'Ona Prims',
						company_id: CAL_PEP_ID,
						channels: [
							channel('email', 'ona@calpepfonda.cat', 'undeliverable', 0.9),
						],
					},
				}),
				proposal({
					key: 'verdict-unknown',
					citation: {
						sourceId: 'src_exa_002',
						quote: 'Guiu Roset apareix al peu de pàgina',
						confidence: 0.5,
					},
					subjectTable: 'contacts',
					operation: 'create',
					reason: 'The provider could not reach the mail server to check',
					fields: {
						name: 'Guiu Roset',
						company_id: HOSTAL_ID,
						channels: [
							channel('email', 'guiu@calpepfonda.cat', 'unknown', 0.55),
						],
					},
				}),
				proposal({
					key: 'no-channels',
					citation: {
						sourceId: 'src_firecrawl_001',
						quote: 'Reserves gestionades amb Cover Manager',
						confidence: 0.82,
					},
					subjectTable: 'companies',
					operation: 'update',
					subjectId: FERROS_ID,
					reason: 'Opening hours changed, no address involved',
					// Nothing machine-checkable here, so this one carries no score at
					// all and disappears the moment a minimum confidence is set.
					fields: { current_tools: 'Cover Manager' },
				}),
			],
		},
		briefMd:
			'## Cal Pep Fonda — address checks\nEvery verification verdict, plus one change with nothing to verify.',
		budgetCents: 60,
		costCents: 26,
		tokensIn: 7400,
		tokensOut: 2100,
		startedAt: new Date('2026-05-22T10:00:00Z'),
		completedAt: new Date('2026-05-22T10:01:40Z'),
	},
	{
		key: 'proposals-existing-subject',
		companySlug: 'cal-pep-fonda',
		query: 'update what we know about Pep Casals',
		mode: 'deep',
		schemaName: 'contact_discovery_v1',
		kind: 'leaf',
		status: 'succeeded',
		findings: {
			proposed_updates: [
				proposal({
					key: 'update-existing-contact',
					citation: {
						sourceId: 'src_firecrawl_001',
						quote: 'Telèfon directe 938 123 999',
						confidence: 0.93,
					},
					subjectTable: 'contacts',
					operation: 'update',
					subjectId: PEP_CASALS_ID,
					reason: 'Direct line published on the contact page',
					fields: {
						channels: [
							channel('phone', '+34 938 123 999', null, 0.8),
							channel('email', 'pep@calpepfonda.cat', 'deliverable', 0.95),
						],
					},
				}),
			],
		},
		briefMd: '## Pep Casals — new direct line',
		budgetCents: 30,
		costCents: 11,
		tokensIn: 3200,
		tokensOut: 900,
		startedAt: new Date('2026-05-22T11:00:00Z'),
		completedAt: new Date('2026-05-22T11:00:40Z'),
	},

	// ── Paid actions awaiting a decision ─────────────────────────
	// Only registry_lookup and discover_contacts can be approved; anything
	// else can only be skipped, and actions predating the id stamp are
	// read-only. All four shapes appear here so the row renders every way.
	{
		key: 'paid-actions',
		companySlug: 'ferros-baix-llobregat',
		query: 'find decision makers at Ferros Baix Llobregat',
		mode: 'deep',
		schemaName: 'contact_discovery_v1',
		kind: 'leaf',
		status: 'succeeded',
		findings: {
			pending_paid_actions: [
				{
					id: seedUuid('paid-action', 'pending-discover'),
					status: 'pending',
					tool: 'discover_contacts',
					args: {
						company_name: 'Ferros Baix Llobregat',
						domain: 'ferrosbl.com',
					},
					estimated_cents: 45,
					reason: 'No public addresses on the site; a lookup would find them.',
				},
				{
					id: seedUuid('paid-action', 'approved-registry'),
					status: 'approved',
					followup_run_id: seedUuid(
						'research-run',
						'seed:run:ferros-baix-llobregat:enrichment',
					),
					tool: 'registry_lookup',
					args: { company_name: 'Ferros Baix Llobregat' },
					estimated_cents: 150,
					reason: 'Directors and share capital come from the company register.',
				},
				{
					id: seedUuid('paid-action', 'skipped-discover'),
					status: 'skipped',
					tool: 'discover_contacts',
					args: { company_name: 'Ferros Baix Llobregat' },
					estimated_cents: 45,
					reason:
						'Already have a named contact, so this was not worth paying for.',
				},
				{
					id: seedUuid('paid-action', 'unsupported-tool'),
					status: 'pending',
					tool: 'exotic_scraper',
					args: { target: 'ferrosbl.com' },
					estimated_cents: 20,
					reason: 'A tool nothing knows how to run, so it can only be skipped.',
				},
				{
					// No id: written before actions carried one, so it can only be read.
					status: 'pending',
					tool: 'discover_contacts',
					args: { company_name: 'Ferros Baix Llobregat' },
					estimated_cents: 45,
					reason: 'An older action with nothing to act on it by.',
				},
			],
		},
		briefMd:
			'## Ferros BL — paid steps\nOne waiting on a decision, one already approved, one skipped, one nothing can run.',
		budgetCents: 80,
		paidBudgetCents: 400,
		costCents: 18,
		tokensIn: 5200,
		tokensOut: 1500,
		startedAt: new Date('2026-05-23T09:00:00Z'),
		completedAt: new Date('2026-05-23T09:01:20Z'),
	},
]

export const seedResearchRuns = (
	{ sql, tallerOrgId, restaurantOrgId }: SeedCtx,
	testUser: ResolvedTestUser,
	companyMap: Map<string, string>,
) =>
	Effect.gen(function* () {
		yield* Effect.logInfo('Seeding research runs & sources...')

		// Sources before runs: research_run_sources FKs both.
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
				{
					id: 'src_firecrawl_003',
					kind: 'web',
					provider: 'firecrawl',
					url: 'https://hostalpirineu.com',
					urlHash: 'fc_hash_003',
					domain: 'hostalpirineu.com',
					title: 'Hostal del Pirineu — Reserves',
					language: 'ca',
					contentHash: 'sha256_ccdd33001',
					contentRef: 'sources/fc_003.md',
				},
				{
					id: 'src_exa_002',
					kind: 'web',
					provider: 'exa',
					url: 'https://brightlane.cat',
					urlHash: 'exa_hash_002',
					domain: 'brightlane.cat',
					title: 'Bright Lane Boutique — Lookbook',
					language: 'en',
					contentHash: 'sha256_eeff44001',
					contentRef: 'sources/exa_002.md',
				},
			]),
		)}`
		yield* Effect.logInfo('  8 sources')

		// `seed:` idempotency_key opts these out of the orphan-runs
		// sweep so running/queued specs survive across server boots
		// and tests stay predictable. tool_log is NOT NULL — stamped
		// explicitly because normalizeRows turns missing keys into NULL.
		const flatRunRows = TALLER_RUN_SPECS.map(s => ({
			organizationId: tallerOrgId,
			kind: s.kind,
			query: s.query,
			mode: s.mode,
			schemaName: s.schemaName,
			status: s.status,
			reasonCode: s.reasonCode ?? null,
			entityMatch: s.entityMatch ?? null,
			context: JSON.stringify({}),
			findings: JSON.stringify(withSourcedFields(s.findings)),
			briefMd: s.briefMd,
			budgetCents: s.budgetCents,
			paidBudgetCents: s.paidBudgetCents ?? 0,
			costCents: s.costCents,
			// The run's paid tier is exactly what its ledger rows sum to, so the
			// mock data can never drift from the paid_cost_cents invariant.
			paidCostCents: s.paidSpend?.reduce((n, p) => n + p.amountCents, 0) ?? 0,
			tokensIn: s.tokensIn,
			tokensOut: s.tokensOut,
			toolLog: JSON.stringify(s.toolLog ?? []),
			idempotencyKey: `seed:run:${s.companySlug}:${s.key}`,
			createdBy: testUser?.id ?? 'seed',
			startedAt: s.startedAt ?? null,
			completedAt: s.completedAt ?? null,
		}))
		const insertedRuns = yield* sql<{
			id: string
		}>`INSERT INTO research_runs ${sql.insert(
			normalizeRows(
				withSeedIds('research-run', flatRunRows, r => String(r.idempotencyKey)),
			),
		)} RETURNING id`
		yield* Effect.logInfo(`  ${insertedRuns.length} per-company runs`)

		const groupRunInsert = yield* sql<{
			id: string
		}>`INSERT INTO research_runs ${sql.insert([
			normalizeRows([
				{
					id: seedUuid('research-run', 'group:discovery-scan'),
					organizationId: tallerOrgId,
					kind: 'group',
					query: 'Catalonia small businesses — discovery scan',
					mode: 'deep',
					schemaName: 'prospect_scan_v1',
					status: 'succeeded',
					context: JSON.stringify({ scope: 'catalonia' }),
					findings: JSON.stringify({
						leaf_results: [
							{ count: 45, summary: 'Restaurants without web' },
							{ count: 18, summary: 'Retail Instagram-only' },
						],
					}),
					briefMd:
						'## Catalonia scan rollup\n45 restaurants without web + 18 retail-on-Instagram. Top quartile by location density: Barcelona + Garraf.',
					budgetCents: 100,
					costCents: 47,
					// Rolls up its children: cost 25 + 22, paid 8 + 5.
					paidCostCents: 13,
					tokensIn: 16900,
					tokensOut: 4000,
					toolLog: JSON.stringify([]),
					createdBy: testUser?.id ?? 'seed',
					startedAt: new Date('2026-02-05T09:00:00Z'),
					completedAt: new Date('2026-02-05T09:05:00Z'),
				},
			])[0]!,
		])} RETURNING id`
		const groupRunId = groupRunInsert[0]!.id
		const groupChildInsert = yield* sql<{
			id: string
		}>`INSERT INTO research_runs ${sql.insert(
			normalizeRows(
				withSeedIds(
					'research-run',
					[
						{
							organizationId: tallerOrgId,
							parentId: groupRunId,
							kind: 'leaf',
							query: 'restaurants Catalonia without websites',
							mode: 'deep',
							schemaName: 'prospect_scan_v1',
							status: 'succeeded',
							findings: JSON.stringify({
								prospects: [],
								market_summary: { total_competitors_found: 45 },
							}),
							briefMd: '45 restaurants in Catalonia without a public web site.',
							budgetCents: 50,
							costCents: 25,
							paidCostCents: 8,
							tokensIn: 9000,
							tokensOut: 2200,
							toolLog: JSON.stringify([]),
							createdBy: testUser?.id ?? 'seed',
							startedAt: new Date('2026-02-05T09:00:30Z'),
							completedAt: new Date('2026-02-05T09:03:00Z'),
						},
						{
							organizationId: tallerOrgId,
							parentId: groupRunId,
							kind: 'followup',
							query: 'retail shops Barcelona Instagram-only',
							mode: 'deep',
							schemaName: 'prospect_scan_v1',
							status: 'succeeded',
							findings: JSON.stringify({
								prospects: [],
								market_summary: { total_competitors_found: 18 },
							}),
							briefMd:
								'18 retail shops selling only via Instagram DM in Barcelona.',
							budgetCents: 50,
							costCents: 22,
							paidCostCents: 5,
							tokensIn: 7900,
							tokensOut: 1800,
							toolLog: JSON.stringify([]),
							createdBy: testUser?.id ?? 'seed',
							startedAt: new Date('2026-02-05T09:03:00Z'),
							completedAt: new Date('2026-02-05T09:05:00Z'),
						},
					],
					(_, index) => `group-child:${index}`,
				),
			),
		)} RETURNING id`
		yield* Effect.logInfo('  + 1 group with 2 children')

		// Back the children's paid_cost_cents (8 + 5) with real ledger rows, so
		// the group's rolled-up paid total is consistent with the paid-spend
		// table. Guarded on testUser because research_paid_spend needs a user id.
		if (testUser) {
			const [restaurantsChild, retailChild] = groupChildInsert
			yield* sql`INSERT INTO research_paid_spend ${sql.insert(
				normalizeRows(
					withSeedIds(
						'paid-spend',
						[
							{
								organizationId: tallerOrgId,
								researchId: restaurantsChild!.id,
								userId: testUser.id,
								provider: 'einforma',
								tool: 'registry_lookup',
								idempotencyKey: `seed_paid_${restaurantsChild!.id}_registry`,
								amountCents: 8,
								quotaUnits: 1,
								quotaUnit: 'lookups',
								args: JSON.stringify({}),
								sourceId: null,
								autoApproved: true,
							},
							{
								organizationId: tallerOrgId,
								researchId: retailChild!.id,
								userId: testUser.id,
								provider: 'hunter',
								tool: 'hunter_enrich',
								idempotencyKey: `seed_paid_${retailChild!.id}_enrich`,
								amountCents: 5,
								quotaUnits: 1,
								quotaUnit: 'requests',
								args: JSON.stringify({}),
								sourceId: null,
								autoApproved: true,
							},
						],
						r => String(r.idempotencyKey),
					),
				),
			)}`
		}

		// Without research_links the company-detail Research card
		// is empty — the API filters via EXISTS on this table.
		const linkRows: Array<Record<string, unknown>> = []
		for (let i = 0; i < TALLER_RUN_SPECS.length; i += 1) {
			const spec = TALLER_RUN_SPECS[i]!
			const runId = insertedRuns[i]!.id
			const subjectId = companyMap.get(spec.companySlug)
			if (subjectId !== undefined) {
				linkRows.push({
					organizationId: tallerOrgId,
					researchId: runId,
					subjectTable: 'companies',
					subjectId,
					linkKind: 'input',
				})
			}
			if (spec.findingLinks) {
				for (const fl of spec.findingLinks) {
					const findingSubjectId = companyMap.get(fl.companySlug)
					if (
						findingSubjectId !== undefined &&
						findingSubjectId !== subjectId
					) {
						linkRows.push({
							organizationId: tallerOrgId,
							researchId: runId,
							subjectTable: fl.table,
							subjectId: findingSubjectId,
							linkKind: 'finding',
						})
					}
				}
			}
		}
		if (linkRows.length > 0) {
			yield* sql`INSERT INTO research_links ${sql.insert(
				normalizeRows(linkRows),
			)}`
			yield* Effect.logInfo(`  ${linkRows.length} research_links rows`)
		}

		const runSourceRows: Array<Record<string, unknown>> = []
		for (let i = 0; i < TALLER_RUN_SPECS.length; i += 1) {
			const spec = TALLER_RUN_SPECS[i]!
			if (!spec.attachSources) continue
			const runId = insertedRuns[i]!.id
			for (const a of spec.attachSources) {
				runSourceRows.push({
					organizationId: tallerOrgId,
					researchId: runId,
					sourceId: a.sourceId,
					localRef: `runs/${runId}/${a.sourceId}.bin`,
					costCents: a.costCents ?? 0,
				})
			}
		}
		if (runSourceRows.length > 0) {
			yield* sql`INSERT INTO research_run_sources ${sql.insert(
				normalizeRows(runSourceRows),
			)}`
			yield* Effect.logInfo(
				`  ${runSourceRows.length} research_run_sources rows`,
			)
		}

		if (testUser) {
			const paidSpendRows: Array<Record<string, unknown>> = []
			for (let i = 0; i < TALLER_RUN_SPECS.length; i += 1) {
				const spec = TALLER_RUN_SPECS[i]!
				if (!spec.paidSpend) continue
				const runId = insertedRuns[i]!.id
				for (let j = 0; j < spec.paidSpend.length; j += 1) {
					const p = spec.paidSpend[j]!
					paidSpendRows.push({
						organizationId: tallerOrgId,
						researchId: runId,
						userId: testUser.id,
						provider: p.provider,
						tool: p.tool,
						idempotencyKey: `seed_paid_${runId}_${j}`,
						amountCents: p.amountCents,
						quotaUnits: p.quotaUnits ?? null,
						quotaUnit: p.quotaUnit ?? null,
						args: JSON.stringify({}),
						sourceId: p.sourceId ?? null,
						autoApproved: p.autoApproved,
					})
				}
			}
			if (paidSpendRows.length > 0) {
				yield* sql`INSERT INTO research_paid_spend ${sql.insert(
					normalizeRows(
						withSeedIds('paid-spend', paidSpendRows, r =>
							String(r['idempotencyKey']),
						),
					),
				)}`
				yield* Effect.logInfo(
					`  ${paidSpendRows.length} research_paid_spend rows`,
				)
			}
		}

		// Restaurant-org runs anchor the multi-org switcher e2e.
		if (restaurantOrgId) {
			const marisqueriaIdRows = yield* sql<{ id: string }>`
				SELECT id FROM companies
				WHERE slug = 'marisqueria-del-port'
					AND organization_id = ${restaurantOrgId}
				LIMIT 1
			`
			const marisqueriaId = marisqueriaIdRows[0]?.id
			if (marisqueriaId) {
				const restaurantRunRows = [
					{
						organizationId: restaurantOrgId,
						kind: 'leaf',
						query:
							'Marisqueria del Port — direct booking + lunch-menu opportunity',
						mode: 'deep',
						schemaName: 'company_enrichment_v1',
						status: 'succeeded',
						context: JSON.stringify({}),
						findings: JSON.stringify({
							enrichment: {
								industry: 'restaurants',
								size_range: '6-10',
								pain_points:
									'Telèfon-only reservations on weekends, ~20% no-show rate.',
								current_tools: 'Booking + paper.',
								products_fit: ['gestio-reserves'],
								tags: ['gastro', 'sitges'],
								location: 'Sitges',
								country: 'ES',
								citations: [],
							},
						}),
						briefMd:
							'## Marisqueria del Port — enrichment\nSitges seafood, ~30 covers. Booking commission frustration. Direct-channel pitch validated.',
						budgetCents: 50,
						costCents: 24,
						tokensIn: 9200,
						tokensOut: 2200,
						toolLog: JSON.stringify([]),
						idempotencyKey: 'seed:run:marisqueria-del-port-enrichment',
						createdBy: testUser?.id ?? 'seed',
						startedAt: new Date('2026-02-15T11:00:00Z'),
						completedAt: new Date('2026-02-15T11:01:30Z'),
					},
					{
						organizationId: restaurantOrgId,
						kind: 'leaf',
						query: 'seafood restaurants Sitges — competitor overview',
						mode: 'quick',
						schemaName: 'competitor_scan_v1',
						status: 'queued',
						context: JSON.stringify({}),
						findings: JSON.stringify({}),
						briefMd: null,
						budgetCents: 30,
						costCents: 0,
						tokensIn: 0,
						tokensOut: 0,
						toolLog: JSON.stringify([]),
						idempotencyKey: 'seed:run:marisqueria-del-port-competitors',
						createdBy: testUser?.id ?? 'seed',
					},
					// LOCAL-DEV: a failed run so the restaurant tenant can show
					// the error block after an org switch (the two runs above
					// only cover succeeded + queued).
					{
						organizationId: restaurantOrgId,
						kind: 'leaf',
						query: 'Marisqueria del Port — directors via paid registry lookup',
						mode: 'deep',
						schemaName: 'company_enrichment_v1',
						status: 'failed',
						context: JSON.stringify({}),
						findings: JSON.stringify({
							error: 'einforma quota exhausted for this period',
						}),
						briefMd: null,
						budgetCents: 60,
						costCents: 12,
						tokensIn: 4200,
						tokensOut: 480,
						toolLog: JSON.stringify([]),
						idempotencyKey: 'seed:run:marisqueria-del-port-registry-failed',
						createdBy: testUser?.id ?? 'seed',
						startedAt: new Date('2026-03-02T11:00:00Z'),
						completedAt: new Date('2026-03-02T11:00:42Z'),
					},
				]
				const restaurantRuns = yield* sql<{
					id: string
				}>`INSERT INTO research_runs ${sql.insert(
					normalizeRows(
						withSeedIds(
							'research-run',
							restaurantRunRows,
							(_, index) => `restaurant:${index}`,
						),
					),
				)} RETURNING id`
				const restaurantLinks = restaurantRuns.map(r => ({
					organizationId: restaurantOrgId,
					researchId: r.id,
					subjectTable: 'companies',
					subjectId: marisqueriaId,
					linkKind: 'input',
				}))
				yield* sql`INSERT INTO research_links ${sql.insert(
					normalizeRows(restaurantLinks),
				)}`
				yield* Effect.logInfo(
					`  ${restaurantRuns.length} restaurant-org runs (linked to marisqueria-del-port)`,
				)
			}
		}
	})

import { Effect } from 'effect'

import {
	COMPANIES,
	getPresetData,
	MINIMAL_COMPANY_SLUGS,
	PRODUCTS,
} from './fixtures'
import { generateCompanies, generateContacts } from './generate'
import {
	normalizeRows,
	SEED_REFERENCE,
	type SeedCtx,
	seedCompanyId,
	seedContactId,
	seedUuid,
	splitCompanyChannels,
	withSeedIds,
} from './shared'

// Bulk volume for the `full` preset. Sized so each org comfortably exceeds the
// 60-row first page, exercising "load more" and the filters against a list
// that does not fit on screen.
const TALLER_GENERATED_COMPANIES = 106
const RESTAURANT_GENERATED_COMPANIES = 39

// Fixed seeds keep every re-seed identical; two values so the orgs get
// different companies rather than the same list under different slugs. These
// particular numbers were chosen because they draw a pipeline close to the
// intended funnel shape — an arbitrary seed can land a lopsided one (more
// closed-lost than contacted), which reads as broken demo data.
const TALLER_SEED = 0x907
const RESTAURANT_SEED = 0x669

export type ProductRow = { readonly id: string; readonly slug: string }
export type CompanyRow = {
	readonly id: string
	readonly slug: string
	readonly status: string
}
export type ContactRow = { readonly id: string; readonly name: string }
// A seed contact before its reachable addresses are split into channels.
type ContactFixture = {
	readonly companyId: string
	readonly name: string
	readonly role?: string
	readonly buyingRole?: string | null
	readonly email?: string
	readonly phone?: string
	readonly whatsapp?: string
	readonly linkedin?: string
	readonly instagram?: string
	readonly emailStatus?: string
	readonly emailStatusReason?: string
}
export type InteractionRow = {
	readonly id: string
	readonly channel: string
	readonly type: string
}
export type TaskRow = { readonly id: string; readonly title: string }

export const seedProducts = ({ sql, preset, stamp }: SeedCtx) =>
	Effect.gen(function* () {
		const products =
			preset === 'minimal'
				? PRODUCTS.filter(c =>
						['web-starter', 'automatitzacions'].includes(c.slug),
					)
				: PRODUCTS
		yield* Effect.logInfo(`Seeding products (${preset})...`)
		const insertedProducts =
			yield* sql<ProductRow>`INSERT INTO products ${sql.insert(
				normalizeRows(
					stamp(withSeedIds('product', products, r => String(r.slug))),
				),
			)} RETURNING id, slug`
		for (const p of insertedProducts) {
			yield* Effect.logInfo(`  product: ${p.slug} (${p.id})`)
		}
		return insertedProducts
	})

/**
 * Spread ownership across the demo accounts so signing in as each one shows a
 * different slice of the pipeline — that is what makes the "my leads" owner
 * filter demonstrable. Falls back to leaving the owner unset when an account
 * is missing, which happens on a database seeded before those users existed.
 */
const assignOwners = <T>(
	rows: ReadonlyArray<T>,
	owners: ReadonlyArray<string | null>,
): Array<T & { ownerId: string | null }> => {
	const usable = owners.filter((id): id is string => id !== null)
	return rows.map((row, index) => ({
		...row,
		ownerId: usable[index % usable.length] ?? null,
	}))
}

const userIdByEmail = (sql: SeedCtx['sql'], email: string) =>
	Effect.gen(function* () {
		const rows = yield* sql<{
			id: string
		}>`SELECT id FROM "user" WHERE email = ${email} LIMIT 1`
		return rows[0]?.id ?? null
	})

export const seedCompanies = (
	{ sql, preset, tallerOrgId, restaurantOrgId, stamp }: SeedCtx,
	productSlugs: ReadonlyArray<string>,
) =>
	Effect.gen(function* () {
		const reference = SEED_REFERENCE
		const [alice, carol, bea, bob] = yield* Effect.all([
			userIdByEmail(sql, 'admin@taller.cat'),
			userIdByEmail(sql, 'colleague@taller.cat'),
			userIdByEmail(sql, 'boss@batuda.dev'),
			userIdByEmail(sql, 'admin@restaurant.demo'),
		])

		const handWritten =
			preset === 'minimal'
				? COMPANIES.filter(c => MINIMAL_COMPANY_SLUGS.has(c.slug))
				: COMPANIES
		// Bulk rows only in `full` — `minimal` backs the worktree provision and
		// the integration suite, which both want a small, fast dataset.
		const generated =
			preset === 'full'
				? generateCompanies({
						count: TALLER_GENERATED_COMPANIES,
						seed: TALLER_SEED,
						reference,
						productSlugs,
					})
				: []
		const companies = assignOwners(
			[...handWritten, ...generated],
			[alice, alice, carol, bea],
		).map(c => ({ ...c, id: seedCompanyId(c.slug) }))

		yield* Effect.logInfo(`Seeding companies (${preset})...`)
		// A company's website and mailbox are no longer columns on its row, so the
		// fixtures — which still describe a company as having them, because that is
		// how a person describes one — are split before the insert.
		const taller = splitCompanyChannels(companies, tallerOrgId)
		const insertedCompanies =
			yield* sql<CompanyRow>`INSERT INTO companies ${sql.insert(
				normalizeRows(stamp(taller.companies)),
			)} RETURNING id, slug, status`
		if (taller.channels.length > 0) {
			yield* sql`INSERT INTO channels ${sql.insert(
				normalizeRows(taller.channels),
			)}`
		}

		const companyMap = new Map(insertedCompanies.map(c => [c.slug, c.id]))
		yield* Effect.logInfo(`  taller org: ${insertedCompanies.length} companies`)

		// Filled in below when the second org exists; the contact seed needs both
		// the generated rows and the ids they landed on.
		let restaurantGenerated: ReturnType<typeof generateCompanies> = []
		const restaurantCompanyMap = new Map<string, string>()

		// One Restaurant company anchors the multi-org switcher e2e:
		// data must re-scope after setActive, not just the label flip.
		if (restaurantOrgId !== null) {
			const anchor = {
				slug: 'marisqueria-del-port',
				name: 'Marisqueria del Port',
				status: 'client',
				industry: 'Restauració',
				sizeRange: '1-10',
				country: 'ES',
				location: 'Sitges',
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
			}
			// The second org carries its own book of business so signing in as its
			// owner shows a full pipeline rather than a single company.
			restaurantGenerated =
				preset === 'full'
					? generateCompanies({
							count: RESTAURANT_GENERATED_COMPANIES,
							seed: RESTAURANT_SEED,
							reference,
							productSlugs,
							slugPrefix: 'rst',
						})
					: []
			const restaurantRows = assignOwners(
				[anchor, ...restaurantGenerated],
				[bob, bob, bea],
			).map(r => ({
				...r,
				id: seedCompanyId(r.slug),
				organizationId: restaurantOrgId,
			}))

			const restaurant = splitCompanyChannels(restaurantRows, restaurantOrgId)
			const insertedRestaurant =
				yield* sql<CompanyRow>`INSERT INTO companies ${sql.insert(
					normalizeRows(restaurant.companies),
				)} RETURNING id, slug, status`
			if (restaurant.channels.length > 0) {
				yield* sql`INSERT INTO channels ${sql.insert(
					normalizeRows(restaurant.channels),
				)}`
			}
			for (const c of insertedRestaurant) {
				restaurantCompanyMap.set(c.slug, c.id)
			}
			yield* Effect.logInfo(
				`  restaurant org: ${insertedRestaurant.length} companies`,
			)
		}
		// Destructured for parity with restaurantOrgId; stamp() already used it.
		void tallerOrgId

		return {
			insertedCompanies,
			companyMap,
			generated,
			restaurantGenerated,
			restaurantCompanyMap,
		}
	})

/**
 * Every reachable address a contact has becomes its own channel row; the email
 * channel also carries any seeded suppression. Uniform shape so normalizeRows
 * aligns the batch.
 */
const buildChannels = (
	contacts: ReadonlyArray<ContactFixture>,
	contactIds: Map<string, string>,
) =>
	contacts.flatMap(c => {
		const contactId = contactIds.get(c.name)
		if (!contactId) return []
		const channel = (
			kind: string,
			value: string,
			isPrimary: boolean,
			status: string,
			statusReason: string | null,
		) => ({
			id: seedUuid('channel', `${contactId}:${kind}:${value}`),
			subjectTable: 'contacts',
			subjectId: contactId,
			channel: kind,
			address: value,
			isPrimary,
			verification: null,
			confidence: null,
			status,
			statusReason,
			softBounceCount: 0,
		})
		return [
			c.email
				? channel(
						'email',
						c.email,
						true,
						c.emailStatus ?? 'unknown',
						c.emailStatusReason ?? null,
					)
				: null,
			c.phone ? channel('phone', c.phone, false, 'unknown', null) : null,
			c.whatsapp
				? channel('whatsapp', c.whatsapp, false, 'unknown', null)
				: null,
			c.linkedin
				? channel('linkedin', c.linkedin, false, 'unknown', null)
				: null,
			c.instagram
				? channel('instagram', c.instagram, false, 'unknown', null)
				: null,
		].filter(r => r !== null)
	})

export const seedContacts = (
	{ sql, preset, stamp, restaurantOrgId }: SeedCtx,
	companyMap: Map<string, string>,
	bulk: {
		readonly generated: ReturnType<typeof generateCompanies>
		readonly restaurantGenerated: ReturnType<typeof generateCompanies>
		readonly restaurantCompanyMap: Map<string, string>
	},
) =>
	Effect.gen(function* () {
		yield* Effect.logInfo('Seeding contacts...')
		const curated = getPresetData(preset, companyMap, new Map())
			.contacts as ReadonlyArray<ContactFixture>

		// Every generated company gets people too, otherwise the bulk pipeline is
		// full of companies nobody can actually be contacted at.
		const toFixture = (
			rows: ReturnType<typeof generateContacts>,
			ids: Map<string, string>,
		): ContactFixture[] =>
			rows.flatMap(c => {
				const companyId = ids.get(c.companySlug)
				if (companyId === undefined) return []
				return [
					{
						companyId,
						name: c.name,
						role: c.role,
						buyingRole: c.buyingRole,
						...(c.email === null ? {} : { email: c.email }),
						...(c.phone === null ? {} : { phone: c.phone }),
					},
				]
			})

		// Contacts are looked up by name further down, so the generator is told
		// which names the curated fixtures already own and steers clear of them.
		const curatedNames = new Set(curated.map(c => c.name))
		const generatedTaller = toFixture(
			generateContacts({
				companies: bulk.generated,
				seed: TALLER_SEED,
				reservedNames: curatedNames,
			}),
			companyMap,
		)
		const contacts = [...curated, ...generatedTaller]

		// Identity rows only — reachable addresses become channels below.
		const insertedContacts =
			yield* sql<ContactRow>`INSERT INTO contacts ${sql.insert(
				normalizeRows(
					stamp(
						contacts.map(c => ({
							id: seedContactId(c.companyId, c.name),
							companyId: c.companyId,
							name: c.name,
							role: c.role ?? null,
							buyingRole: c.buyingRole ?? null,
						})),
					),
				),
			)} RETURNING id, name`
		const contactMap = new Map(insertedContacts.map(c => [c.name, c.id]))

		const channelRows = buildChannels(contacts, contactMap)
		if (channelRows.length > 0) {
			yield* sql`INSERT INTO channels ${sql.insert(
				normalizeRows(stamp(channelRows)),
			)}`
		}

		// The second org's people are stamped with its own id rather than the
		// default taller one, so its pipeline is independently browsable.
		if (restaurantOrgId !== null && bulk.restaurantGenerated.length > 0) {
			const restaurantContacts = toFixture(
				generateContacts({
					companies: bulk.restaurantGenerated,
					seed: RESTAURANT_SEED,
					reservedNames: curatedNames,
				}),
				bulk.restaurantCompanyMap,
			)
			const insertedRestaurant =
				yield* sql<ContactRow>`INSERT INTO contacts ${sql.insert(
					normalizeRows(
						restaurantContacts.map(c => ({
							id: seedContactId(c.companyId, c.name),
							organizationId: restaurantOrgId,
							companyId: c.companyId,
							name: c.name,
							role: c.role ?? null,
							buyingRole: c.buyingRole ?? null,
						})),
					),
				)} RETURNING id, name`
			const restaurantIds = new Map(insertedRestaurant.map(c => [c.name, c.id]))
			const restaurantChannels = buildChannels(
				restaurantContacts,
				restaurantIds,
			).map(r => ({ ...r, organizationId: restaurantOrgId }))
			if (restaurantChannels.length > 0) {
				yield* sql`INSERT INTO channels ${sql.insert(
					normalizeRows(restaurantChannels),
				)}`
			}
			yield* Effect.logInfo(
				`  restaurant org: ${insertedRestaurant.length} contacts`,
			)
		}

		yield* Effect.logInfo(`  taller org: ${insertedContacts.length} contacts`)
		return { insertedContacts, contactMap }
	})

export const seedInteractions = (
	{ sql, preset, tallerOrgId, stamp }: SeedCtx,
	companyMap: Map<string, string>,
	contactMap: Map<string, string>,
) =>
	Effect.gen(function* () {
		yield* Effect.logInfo('Seeding interactions...')
		const dataWithContacts = getPresetData(preset, companyMap, contactMap)
		const insertedInteractions =
			yield* sql<InteractionRow>`INSERT INTO interactions ${sql.insert(
				normalizeRows(
					stamp(
						dataWithContacts.interactions.map(i => ({
							id: seedUuid(
								'interaction',
								`${String(i.companyId)}:${String(i.date)}:${String(i.summary)}`,
							),
							...i,
						})),
					),
				),
			)} RETURNING id, channel, type`
		for (const i of insertedInteractions.slice(0, 3)) {
			yield* Effect.logInfo(`  interaction: ${i.channel}/${i.type} (${i.id})`)
		}
		if (insertedInteractions.length > 3) {
			yield* Effect.logInfo(`  ... and ${insertedInteractions.length - 3} more`)
		}

		// Mirrors TimelineActivityService at the SQL layer to avoid
		// importing the server service into the CLI bundle.
		yield* sql`
			INSERT INTO timeline_activity (
				id, organization_id, kind, entity_type, entity_id, company_id, contact_id,
				channel, direction, occurred_at, summary, payload
			)
			SELECT
				md5('batuda-seed:timeline:' || id::text)::uuid,
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
		return { insertedInteractions, dataWithContacts }
	})

export const seedTasks = (
	{ sql, stamp }: SeedCtx,
	dataWithContacts: ReturnType<typeof getPresetData>,
) =>
	Effect.gen(function* () {
		yield* Effect.logInfo('Seeding tasks...')
		const insertedTasks = yield* sql<TaskRow>`INSERT INTO tasks ${sql.insert(
			normalizeRows(
				stamp(
					dataWithContacts.tasks.map(t => ({
						id: seedUuid('task', String(t.title)),
						...t,
					})),
				),
			),
		)} RETURNING id, title`
		for (const t of insertedTasks.slice(0, 3)) {
			yield* Effect.logInfo(`  task: ${t.title} (${t.id})`)
		}
		if (insertedTasks.length > 3) {
			yield* Effect.logInfo(`  ... and ${insertedTasks.length - 3} more`)
		}
		return insertedTasks
	})

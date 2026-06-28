import { Effect } from 'effect'

import {
	COMPANIES,
	getPresetData,
	MINIMAL_COMPANY_SLUGS,
	PRODUCTS,
} from './fixtures'
import { normalizeRows, type SeedCtx } from './shared'

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
	readonly isDecisionMaker?: boolean
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
				normalizeRows(stamp(products)),
			)} RETURNING id, slug`
		for (const p of insertedProducts) {
			yield* Effect.logInfo(`  product: ${p.slug} (${p.id})`)
		}
		return insertedProducts
	})

export const seedCompanies = ({
	sql,
	preset,
	tallerOrgId,
	restaurantOrgId,
	stamp,
}: SeedCtx) =>
	Effect.gen(function* () {
		const companies =
			preset === 'minimal'
				? COMPANIES.filter(c => MINIMAL_COMPANY_SLUGS.has(c.slug))
				: COMPANIES

		yield* Effect.logInfo(`Seeding companies (${preset})...`)
		const insertedCompanies =
			yield* sql<CompanyRow>`INSERT INTO companies ${sql.insert(
				normalizeRows(stamp(companies)),
			)} RETURNING id, slug, status`

		const companyMap = new Map(insertedCompanies.map(c => [c.slug, c.id]))
		for (const c of insertedCompanies) {
			yield* Effect.logInfo(`  company: ${c.slug} [${c.status}] (${c.id})`)
		}

		// One Restaurant company anchors the multi-org switcher e2e:
		// data must re-scope after setActive, not just the label flip.
		if (restaurantOrgId !== null) {
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
		// Destructured for parity with restaurantOrgId; stamp() already used it.
		void tallerOrgId

		return { insertedCompanies, companyMap }
	})

export const seedContacts = (
	{ sql, preset, stamp }: SeedCtx,
	companyMap: Map<string, string>,
) =>
	Effect.gen(function* () {
		yield* Effect.logInfo('Seeding contacts...')
		const contacts = getPresetData(preset, companyMap, new Map())
			.contacts as ReadonlyArray<ContactFixture>

		// Identity rows only — reachable addresses become channels below.
		const insertedContacts =
			yield* sql<ContactRow>`INSERT INTO contacts ${sql.insert(
				normalizeRows(
					stamp(
						contacts.map(c => ({
							companyId: c.companyId,
							name: c.name,
							role: c.role ?? null,
							isDecisionMaker: c.isDecisionMaker ?? null,
						})),
					),
				),
			)} RETURNING id, name`
		const contactMap = new Map(insertedContacts.map(c => [c.name, c.id]))

		// Every reachable address is a channel; the email channel also carries
		// any seeded suppression. Uniform shape so normalizeRows aligns the batch.
		const channelRows = contacts.flatMap(c => {
			const contactId = contactMap.get(c.name)
			if (!contactId) return []
			const channel = (
				kind: string,
				value: string,
				isPrimary: boolean,
				status: string,
				statusReason: string | null,
			) => ({
				contactId,
				kind,
				value,
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
		if (channelRows.length > 0) {
			yield* sql`INSERT INTO contact_channels ${sql.insert(
				normalizeRows(stamp(channelRows)),
			)}`
		}

		for (const c of insertedContacts) {
			yield* Effect.logInfo(`  contact: ${c.name} (${c.id})`)
		}
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
				normalizeRows(stamp(dataWithContacts.interactions)),
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
		return { insertedInteractions, dataWithContacts }
	})

export const seedTasks = (
	{ sql, stamp }: SeedCtx,
	dataWithContacts: ReturnType<typeof getPresetData>,
) =>
	Effect.gen(function* () {
		yield* Effect.logInfo('Seeding tasks...')
		const insertedTasks = yield* sql<TaskRow>`INSERT INTO tasks ${sql.insert(
			normalizeRows(stamp(dataWithContacts.tasks)),
		)} RETURNING id, title`
		for (const t of insertedTasks.slice(0, 3)) {
			yield* Effect.logInfo(`  task: ${t.title} (${t.id})`)
		}
		if (insertedTasks.length > 3) {
			yield* Effect.logInfo(`  ... and ${insertedTasks.length - 3} more`)
		}
		return insertedTasks
	})

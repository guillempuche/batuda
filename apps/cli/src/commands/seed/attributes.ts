/** biome-ignore-all lint/style/noNonNullAssertion: seed data */
import { Effect } from 'effect'

import type { AttributeKind } from '@batuda/domain'

import { normalizeRows, type SeedCtx, withSeedIds } from './shared'

// The facts each demo organisation records on every company, declared on its
// org-owned research stacks. The taller org's default stack carries one of
// each kind plus a retired one, so every shape the settings page and the
// filters handle is on show; its hospitality variant re-declares one key with
// the same shape, which is the one way two stacks may share a key; the
// restaurant org has a single fact of its own, so switching orgs changes what
// is declared.

type Declaration = {
	readonly stack: string
	readonly key: string
	readonly label: string
	readonly kind: AttributeKind
	readonly enumValues?: ReadonlyArray<string>
	readonly unit?: string
	readonly description: string
	readonly isActive?: boolean
}

const TALLER_DECLARATIONS: ReadonlyArray<Declaration> = [
	{
		stack: 'default',
		key: 'current_tools',
		label: 'Current tools',
		kind: 'text',
		description:
			'The software or manual method the business runs its bookings, invoicing or stock on: paper, WhatsApp, Excel, or a named product.',
	},
	{
		stack: 'default',
		key: 'site_count',
		label: 'Sites',
		kind: 'number',
		unit: 'sites',
		description: 'How many premises the business trades from.',
	},
	{
		stack: 'default',
		key: 'takes_online_bookings',
		label: 'Takes online bookings',
		kind: 'boolean',
		description:
			"Whether customers can book or order on the business's own site, rather than by phone or through a third-party portal.",
	},
	{
		stack: 'default',
		key: 'fit',
		label: 'Fit',
		kind: 'enum',
		enumValues: ['strong', 'possible', 'no'],
		description:
			'Your own reading of whether the business fits one of our offers.',
	},
	{
		stack: 'default',
		key: 'founded_on',
		label: 'Founded on',
		kind: 'date',
		description:
			'The day the business was founded or registered, from the registry or its own site.',
	},
	{
		stack: 'default',
		key: 'uses_whatsapp',
		label: 'Uses WhatsApp',
		kind: 'boolean',
		description: 'Whether the business takes orders or bookings over WhatsApp.',
		isActive: false,
	},
	{
		stack: 'hospitality-es',
		key: 'covers',
		label: 'Covers',
		kind: 'number',
		unit: 'covers',
		description: 'Seats served per sitting.',
	},
	{
		stack: 'hospitality-es',
		key: 'current_tools',
		label: 'Current tools',
		kind: 'text',
		description:
			'The software or manual method the venue runs its bookings on: paper, a portal, or a named product.',
	},
]

const RESTAURANT_DECLARATIONS: ReadonlyArray<Declaration> = [
	{
		stack: 'default',
		key: 'catering',
		label: 'Does catering',
		kind: 'boolean',
		description:
			'Whether the supplier or partner also caters events and groups.',
	},
]

export const seedAttributes = ({
	sql,
	tallerOrgId,
	restaurantOrgId,
}: SeedCtx) =>
	Effect.gen(function* () {
		yield* Effect.logInfo('Seeding research attributes...')

		const stacks = yield* sql<{
			id: string
			organizationId: string
			name: string
		}>`
			SELECT id, organization_id, name FROM instruction_stacks
			WHERE owner_user_id IS NULL AND agent = 'research'
				AND organization_id IN ${sql.in([tallerOrgId, restaurantOrgId ?? tallerOrgId])}
		`
		const stackId = (organizationId: string, name: string) =>
			stacks.find(s => s.organizationId === organizationId && s.name === name)
				?.id

		const users = yield* sql<{ id: string; email: string }>`
			SELECT id, email FROM "user"
			WHERE email IN ('admin@taller.cat', 'admin@restaurant.demo')
		`
		const userIdByEmail = new Map(users.map(u => [u.email, u.id]))
		const alice = userIdByEmail.get('admin@taller.cat')!
		const bob = userIdByEmail.get('admin@restaurant.demo')

		const toRow = (
			organizationId: string,
			createdBy: string,
			declaration: Declaration,
		) => ({
			organizationId,
			stackId: stackId(organizationId, declaration.stack)!,
			key: declaration.key,
			label: declaration.label,
			kind: declaration.kind,
			enumValues: declaration.enumValues ?? null,
			unit: declaration.unit ?? null,
			description: declaration.description,
			isActive: declaration.isActive ?? true,
			createdBy,
		})

		const rows = [
			...TALLER_DECLARATIONS.map(d => toRow(tallerOrgId, alice, d)),
			...(restaurantOrgId !== null && bob
				? RESTAURANT_DECLARATIONS.map(d => toRow(restaurantOrgId, bob, d))
				: []),
		]
		yield* sql`INSERT INTO research_attributes ${sql.insert(
			normalizeRows(
				withSeedIds(
					'research-attribute',
					rows,
					r => `${r.organizationId}:${r.stackId}:${r.key}`,
				),
			),
		)}`

		yield* Effect.logInfo(`  attributes: ${rows.length}`)
	})

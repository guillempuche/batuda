/** biome-ignore-all lint/style/noNonNullAssertion: seed data */
import { createHash } from 'node:crypto'

import { Effect } from 'effect'

import { normalizeRows, type SeedCtx } from './shared'

// Standing instruction templates + per-agent default stacks for local dev.
// owner_user_id NULL = org-owned (admin-managed, every member reads it); a set
// owner = personal (only that user). The research agent reads its default stack
// on every run: the org default is the base ('replace'), and a user stack with
// 'extend' adds that user's own templates on top. The [tag] name prefix is just
// part of the name — it only makes the library easier to scan.

const TALLER_ORG_TEMPLATES = [
	{
		name: '[org] Company context',
		body: 'I sell websites, online booking, and workflow automation to small businesses in Catalonia and Spain — restaurants, hospitality, retail, and light manufacturing. A typical engagement is a 990 to 2,500 euro one-off build or a 49 euro per month service. When you research a company, frame everything around whether they fit one of those offers and what concrete pain a website, a booking system, or an automation would remove.',
	},
	{
		name: '[org] Qualification rubric',
		body: 'Score every company on three things: team size (my sweet spot is 1 to 25 people), how manual their current tools are (paper, WhatsApp, and spreadsheets signal a strong fit; a modern stack signals a weak one), and whether there is a reachable decision-maker. Always end with the single clearest pain a small digital project would solve for them.',
	},
] as const

const ALICE_TEMPLATES = [
	{
		name: '[tone] Terse, no fluff',
		body: 'Be terse. Lead with the answer, then the evidence. Use bullet points over paragraphs. No preamble, no filler, and do not restate my question back to me.',
	},
	{
		name: '[lang] Spanish brief',
		body: 'Write the final brief in Spanish (Spain), using a formal register. Keep the section headings in Spanish too. Quote any source names and figures exactly as found.',
	},
] as const

const CAROL_TEMPLATES = [
	{
		name: '[research] Spain hospitality ICP',
		body: 'Focus on hospitality in Spain: independent hotels, hostales, and restaurants with roughly 5 to 40 covers. Prioritise venues that still take bookings by phone or only through a third-party portal like Booking or TheFork — they have the most to gain from a direct channel.',
	},
	{
		name: '[tone] Warm and consultative',
		body: 'Write like a trusted advisor, not a salesperson. Start by acknowledging what the business already does well, then suggest where a small change would help. Plain language, no jargon.',
	},
] as const

const RESTAURANT_ORG_TEMPLATE = {
	name: '[org] Restaurant context',
	body: 'I run a seafood restaurant in Sitges. When you research suppliers, partners, or competitors, focus on local sourcing, demand for event and group catering, and anything that would help fill tables midweek.',
} as const

export const seedInstructions = ({
	sql,
	tallerOrgId,
	restaurantOrgId,
}: SeedCtx) =>
	Effect.gen(function* () {
		yield* Effect.logInfo('Seeding instruction templates...')

		const users = yield* sql<{ id: string; email: string }>`
			SELECT id, email FROM "user"
			WHERE email IN ('admin@taller.cat', 'colleague@taller.cat', 'admin@restaurant.demo')
		`
		const userIdByEmail = new Map(users.map(u => [u.email, u.id]))
		const alice = userIdByEmail.get('admin@taller.cat')
		const carol = userIdByEmail.get('colleague@taller.cat')
		const bob = userIdByEmail.get('admin@restaurant.demo')
		if (!alice) {
			return yield* Effect.fail(
				new Error(
					'Instruction-template seed requires admin@taller.cat — run `pnpm cli seed` so identities seed before this step.',
				),
			)
		}

		// Two personal owners (Alice the admin, Carol a plain member) so the
		// personal-vs-org split and the admin-only gate on org rows are both
		// exercisable; a restaurant-org row proves cross-org RLS isolation.
		const templateRows = [
			...TALLER_ORG_TEMPLATES.map(t => ({
				organizationId: tallerOrgId,
				ownerUserId: null,
				createdBy: alice,
				name: t.name,
				body: t.body,
			})),
			...ALICE_TEMPLATES.map(t => ({
				organizationId: tallerOrgId,
				ownerUserId: alice,
				createdBy: alice,
				name: t.name,
				body: t.body,
			})),
			...(carol
				? CAROL_TEMPLATES.map(t => ({
						organizationId: tallerOrgId,
						ownerUserId: carol,
						createdBy: carol,
						name: t.name,
						body: t.body,
					}))
				: []),
			...(restaurantOrgId !== null && bob
				? [
						{
							organizationId: restaurantOrgId,
							ownerUserId: null,
							createdBy: bob,
							name: RESTAURANT_ORG_TEMPLATE.name,
							body: RESTAURANT_ORG_TEMPLATE.body,
						},
					]
				: []),
			// An org template imported from a preset (records source_preset_id),
			// and a personal template Alice created then handed to Carol so its
			// owner differs from its creator.
			{
				organizationId: tallerOrgId,
				ownerUserId: null,
				createdBy: alice,
				sourcePresetId: 'research-concise-brief',
				name: '[research] Concise brief',
				body: 'Write the brief to be skimmed in under a minute: lead with the conclusion, then the few facts that back it, in short sentences with no filler.',
			},
			...(carol
				? [
						{
							organizationId: tallerOrgId,
							ownerUserId: carol,
							createdBy: alice,
							sourcePresetId: null,
							name: '[lang] Catalan brief',
							body: 'Write the final brief in Catalan, formal register, with the section headings in Catalan too.',
						},
					]
				: []),
		]
		const insertedTemplates = yield* sql<{ id: string; name: string }>`
			INSERT INTO instruction_templates ${sql.insert(normalizeRows(templateRows))}
			RETURNING id, name
		`
		const templateIdByName = new Map(insertedTemplates.map(t => [t.name, t.id]))
		const templateId = (name: string) => templateIdByName.get(name)!

		const stackRows = [
			{
				organizationId: tallerOrgId,
				ownerUserId: null,
				agent: 'research',
				composition: 'replace',
			},
			{
				organizationId: tallerOrgId,
				ownerUserId: alice,
				agent: 'research',
				composition: 'replace',
			},
			...(carol
				? [
						{
							organizationId: tallerOrgId,
							ownerUserId: carol,
							agent: 'research',
							composition: 'extend',
						},
					]
				: []),
			...(restaurantOrgId !== null && bob
				? [
						{
							organizationId: restaurantOrgId,
							ownerUserId: null,
							agent: 'research',
							composition: 'replace',
						},
					]
				: []),
		]
		const insertedStacks = yield* sql<{
			id: string
			ownerUserId: string | null
			organizationId: string
		}>`
			INSERT INTO agent_default_stacks ${sql.insert(normalizeRows(stackRows))}
			RETURNING id, owner_user_id, organization_id
		`
		const tallerOrgStackId = insertedStacks.find(
			s => s.organizationId === tallerOrgId && s.ownerUserId === null,
		)!.id
		const carolStackId = insertedStacks.find(s => s.ownerUserId === carol)?.id
		const aliceStackId = insertedStacks.find(s => s.ownerUserId === alice)?.id
		const restaurantStackId = insertedStacks.find(
			s =>
				restaurantOrgId !== null &&
				s.organizationId === restaurantOrgId &&
				s.ownerUserId === null,
		)?.id

		// An org stack may reference org-owned templates ONLY: a personal template
		// inside it would be hidden by RLS from other members and silently dropped
		// from their resolved prompt. A personal stack may add the owner's own.
		const itemRows = [
			{
				organizationId: tallerOrgId,
				stackId: tallerOrgStackId,
				templateId: templateId('[org] Company context'),
				position: 0,
			},
			{
				organizationId: tallerOrgId,
				stackId: tallerOrgStackId,
				templateId: templateId('[org] Qualification rubric'),
				position: 1,
			},
			...(carolStackId
				? [
						{
							organizationId: tallerOrgId,
							stackId: carolStackId,
							templateId: templateId('[research] Spain hospitality ICP'),
							position: 0,
						},
						{
							organizationId: tallerOrgId,
							stackId: carolStackId,
							templateId: templateId('[tone] Warm and consultative'),
							position: 1,
						},
						{
							organizationId: tallerOrgId,
							stackId: carolStackId,
							templateId: templateId('[org] Company context'),
							position: 2,
						},
					]
				: []),
			...(aliceStackId
				? [
						{
							organizationId: tallerOrgId,
							stackId: aliceStackId,
							templateId: templateId('[tone] Terse, no fluff'),
							position: 0,
						},
						{
							organizationId: tallerOrgId,
							stackId: aliceStackId,
							templateId: templateId('[lang] Spanish brief'),
							position: 1,
						},
					]
				: []),
			...(restaurantStackId && restaurantOrgId !== null
				? [
						{
							organizationId: restaurantOrgId,
							stackId: restaurantStackId,
							templateId: templateId('[org] Restaurant context'),
							position: 0,
						},
					]
				: []),
		]
		yield* sql`INSERT INTO agent_default_stack_items ${sql.insert(normalizeRows(itemRows))}`

		// A member's pending donation drives the org admin's review queue; an
		// already-accepted one shows the resolved side of the same flow. The row
		// snapshots the template's name and body, which is what lets an admin
		// review a proposal they otherwise couldn't read (RLS hides the still-
		// personal source template from them).
		const donationRows = [
			{
				organizationId: tallerOrgId,
				sourceTemplateId: templateId('[research] Spain hospitality ICP'),
				createdTemplateId: null,
				name: '[research] Spain hospitality ICP',
				body: CAROL_TEMPLATES[0].body,
				proposedBy: carol ?? alice,
				status: 'pending',
				resolvedBy: null,
				resolvedAt: null,
			},
			{
				organizationId: tallerOrgId,
				sourceTemplateId: null,
				createdTemplateId: templateId('[org] Qualification rubric'),
				name: '[org] Qualification rubric',
				body: TALLER_ORG_TEMPLATES[1].body,
				proposedBy: carol ?? alice,
				status: 'accepted',
				resolvedBy: alice,
				resolvedAt: new Date('2026-05-01'),
			},
		]
		yield* sql`INSERT INTO instruction_template_donations ${sql.insert(normalizeRows(donationRows))}`

		yield* Effect.logInfo(
			`  templates: ${insertedTemplates.length}, stacks: ${insertedStacks.length}, items: ${itemRows.length}, donations: ${donationRows.length}`,
		)
		return templateIdByName
	})

// Stamp a few succeeded research runs with the templates that "shaped" them, so
// the run-detail "Shaped by" line renders with real data locally. Runs exist
// only in the full preset, so this is called from the full block.
export const linkRunProvenance = (
	{ sql, tallerOrgId }: SeedCtx,
	templateIdByName: Map<string, string>,
) =>
	Effect.gen(function* () {
		const runs = yield* sql<{ id: string }>`
			SELECT id FROM research_runs
			WHERE organization_id = ${tallerOrgId} AND status = 'succeeded'
			ORDER BY created_at, id
			LIMIT 3
		`
		if (runs.length === 0) return

		// {id, name} of each template that exists, in order — the ids feed the
		// fingerprint, the names are what the run-detail UI shows.
		const resolve = (names: ReadonlyArray<string>) =>
			names.flatMap(name => {
				const id = templateIdByName.get(name)
				return id ? [{ id, name }] : []
			})
		const orgDefault = resolve([
			'[org] Company context',
			'[org] Qualification rubric',
		])
		const orgDefaultWithTone = resolve([
			'[org] Company context',
			'[org] Qualification rubric',
			'[tone] Terse, no fluff',
		])

		const setProvenance = (
			runId: string,
			templates: ReadonlyArray<{ readonly id: string; readonly name: string }>,
		) =>
			Effect.gen(function* () {
				const ids = templates.map(t => t.id)
				const fingerprint = createHash('sha256')
					.update(ids.join('|'))
					.digest('hex')
					.slice(0, 32)
				yield* sql`
					UPDATE research_runs
					SET template_ids = ${JSON.stringify(ids)},
						template_names = ${JSON.stringify(templates.map(t => t.name))},
						template_fingerprint = ${fingerprint}
					WHERE id = ${runId}
				`
			})

		// First runs reflect the plain org default; the last adds a per-run tone.
		for (const run of runs.slice(0, 2)) {
			yield* setProvenance(run.id, orgDefault)
		}
		const third = runs[2]
		if (third) yield* setProvenance(third.id, orgDefaultWithTone)

		yield* Effect.logInfo(
			`  linked instruction provenance on ${Math.min(runs.length, 3)} research runs`,
		)
	})

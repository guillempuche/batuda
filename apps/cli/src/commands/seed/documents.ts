/** biome-ignore-all lint/style/noNonNullAssertion: seed data */
import { Effect } from 'effect'

import { normalizeRows, type SeedCtx, withSeedIds } from './shared'

type DocumentSeed = {
	readonly subjectTable: 'companies' | 'contacts'
	readonly subjectKey: string
	readonly type: string
	readonly title: string
	readonly content: string
}

// `subjectKey` is the seed's own handle for the record a document is filed
// under — a company slug or a contact name — resolved to a real id once those
// rows exist. Most of the fixtures sit on a company, one on a person, so the
// demo data shows a note about someone as well as notes about a business.
const DOCUMENTS: ReadonlyArray<DocumentSeed> = [
	{
		subjectTable: 'companies',
		subjectKey: 'cal-pep-fonda',
		type: 'prenote',
		title: 'Visit prep — Cal Pep',
		content:
			'## Goal\nSee the restaurant, understand current booking flow.\n\n## Questions\n- How many covers per service?\n- Do they take reservations via WhatsApp or phone?\n- Do they have a website?',
	},
	{
		subjectTable: 'companies',
		subjectKey: 'cal-pep-fonda',
		type: 'postnote',
		title: 'Visit summary — Cal Pep',
		content:
			"## Summary\n60 covers, 2 services/day. Phone-only reservations — they lose ~15% of walk-ups who won't wait.\n\n## Decision\nWants website + booking. Budget approved up to 1500 EUR.",
	},
	{
		subjectTable: 'companies',
		subjectKey: 'ferros-baix-llobregat',
		type: 'research',
		title: 'Company analysis — Ferros BL',
		content:
			'## Company\n40 employees, 2 warehouses in Cornellà. Revenue ~3M EUR/year.\n\n## Pain points detected\n- Manual invoicing: 2 days/month\n- Transcription errors: ~5% of invoices\n- No real-time stock control',
	},
	{
		subjectTable: 'companies',
		subjectKey: 'hostal-pirineu',
		type: 'visit_notes',
		title: 'Visit notes — Hostal Pirineu',
		content:
			'## Context\n12 rooms, high season June–September + ski December–March.\n\n## Commissions\nBooking: 15–18%. They want to drop below 5% with a direct channel.\n\n## Requirements\n- Availability calendar\n- Upfront payment (Stripe/Redsys)\n- Multi-language: ca, es, fr',
	},
	{
		subjectTable: 'companies',
		subjectKey: 'tancaments-garraf',
		type: 'call_notes',
		title: 'Demo debrief — Tancaments Garraf',
		content:
			'## Attendees\nRamon Vila (owner), Oriol Camps (project manager)\n\n## Key points\n- Currently tracking 12 concurrent projects in shared Google Sheets\n- Lost a client last month due to a missed deadline nobody saw in the spreadsheet\n- Want a dashboard with alerts per project phase\n\n## Objections\n- Worried about migration effort from existing sheets\n- Need offline access for site visits',
	},
	{
		subjectTable: 'companies',
		subjectKey: 'distribuciones-martinez',
		type: 'general',
		title: 'Competitor landscape — logistics in Alzira',
		content:
			'## Notes\nNo direct competitor offering digital delivery notes in this area.\nClosest: a Valencia-based firm doing fleet GPS, but not document digitisation.\n\n## Opportunity\nFirst-mover advantage if we land Distribuciones Martínez as a reference client.',
	},
	{
		subjectTable: 'contacts',
		subjectKey: 'Pep Casals',
		type: 'general',
		title: 'Working with Pep',
		content:
			'## How he likes to work\nPrefers a call before 10am; reads nothing longer than a page.\n\n## Watch out for\nSays yes in the room and reconsiders overnight — confirm in writing the same day.',
	},
]

export const seedDocuments = (
	{ sql, stamp }: SeedCtx,
	companyMap: Map<string, string>,
	contactMap: Map<string, string>,
) =>
	Effect.gen(function* () {
		yield* Effect.logInfo('Seeding documents...')

		const rows = withSeedIds(
			'document',
			DOCUMENTS.map(doc => ({
				type: doc.type,
				title: doc.title,
				content: doc.content,
			})),
			(_, index) => String(index),
		)

		yield* sql`INSERT INTO documents ${sql.insert(normalizeRows(stamp(rows)))}`

		const links = DOCUMENTS.flatMap((doc, index) => {
			const subjectId =
				doc.subjectTable === 'companies'
					? companyMap.get(doc.subjectKey)
					: contactMap.get(doc.subjectKey)
			// A fixture naming a record the seed did not create is skipped rather
			// than inserted as a link pointing at nothing.
			if (subjectId === undefined) return []
			return [
				{
					documentId: rows[index]!.id,
					subjectTable: doc.subjectTable,
					subjectId,
				},
			]
		})

		yield* sql`INSERT INTO document_links ${sql.insert(
			normalizeRows(stamp(links)),
		)}`
		yield* Effect.logInfo(`  ${links.length} document_links rows`)
	})

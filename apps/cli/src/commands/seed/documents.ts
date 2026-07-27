/** biome-ignore-all lint/style/noNonNullAssertion: seed data */
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { Config, Effect, Redacted } from 'effect'

import { normalizeRows, type SeedCtx, withSeedIds } from './shared'

type SubjectTable =
	| 'companies'
	| 'contacts'
	| 'tasks'
	| 'proposals'
	| 'calendar_events'

// The seed's own handle for a record — a company slug, a person's name, or the
// title of a task, an offer or a meeting — resolved to a real id below.
type SubjectRef = { readonly table: SubjectTable; readonly key: string }

type DocumentSeed = {
	readonly type: string
	readonly format: 'markdown' | 'html'
	readonly title: string
	readonly content: string
	readonly filedUnder: ReadonlyArray<SubjectRef>
}

// Covers every kind, both formats, all five records a document can be filed
// under, and one document filed in two places at once, so every surface the app
// offers has something to show.
const DOCUMENTS: ReadonlyArray<DocumentSeed> = [
	{
		type: 'prenote',
		format: 'markdown',
		title: 'Visit prep — Cal Pep',
		content:
			'## Goal\nSee the restaurant, understand current booking flow.\n\n## Questions\n- How many covers per service?\n- Do they take reservations via WhatsApp or phone?\n- Do they have a website?',
		filedUnder: [{ table: 'companies', key: 'cal-pep-fonda' }],
	},
	{
		type: 'postnote',
		format: 'markdown',
		title: 'Visit summary — Cal Pep',
		content:
			"## Summary\n60 covers, 2 services/day. Phone-only reservations — they lose ~15% of walk-ups who won't wait.\n\n## Decision\nWants website + booking. Budget approved up to 1500 EUR.",
		filedUnder: [{ table: 'companies', key: 'cal-pep-fonda' }],
	},
	{
		type: 'research',
		format: 'markdown',
		title: 'Company analysis — Ferros BL',
		content:
			'## Company\n40 employees, 2 warehouses in Cornellà. Revenue ~3M EUR/year.\n\n## Pain points detected\n- Manual invoicing: 2 days/month\n- Transcription errors: ~5% of invoices\n- No real-time stock control',
		filedUnder: [{ table: 'companies', key: 'ferros-baix-llobregat' }],
	},
	{
		type: 'visit_notes',
		format: 'markdown',
		title: 'Visit notes — Hostal Pirineu',
		content:
			'## Context\n12 rooms, high season June–September + ski December–March.\n\n## Commissions\nBooking: 15–18%. They want to drop below 5% with a direct channel.\n\n## Requirements\n- Availability calendar\n- Upfront payment (Stripe/Redsys)\n- Multi-language: ca, es, fr',
		filedUnder: [{ table: 'companies', key: 'hostal-pirineu' }],
	},
	{
		type: 'call_notes',
		format: 'markdown',
		title: 'Demo debrief — Tancaments Garraf',
		content:
			'## Attendees\nRamon Vila (owner), Oriol Camps (project manager)\n\n## Key points\n- Currently tracking 12 concurrent projects in shared Google Sheets\n- Lost a client last month due to a missed deadline nobody saw in the spreadsheet\n- Want a dashboard with alerts per project phase\n\n## Objections\n- Worried about migration effort from existing sheets\n- Need offline access for site visits',
		filedUnder: [{ table: 'companies', key: 'tancaments-garraf' }],
	},
	{
		type: 'general',
		format: 'markdown',
		title: 'Competitor landscape — logistics in Alzira',
		content:
			'## Notes\nNo direct competitor offering digital delivery notes in this area.\nClosest: a Valencia-based firm doing fleet GPS, but not document digitisation.\n\n## Opportunity\nFirst-mover advantage if we land Distribuciones Martínez as a reference client.',
		filedUnder: [{ table: 'companies', key: 'distribuciones-martinez' }],
	},
	{
		type: 'general',
		format: 'markdown',
		title: 'Working with Pep',
		content:
			'## How he likes to work\nPrefers a call before 10am; reads nothing longer than a page.\n\n## Watch out for\nSays yes in the room and reconsiders overnight — confirm in writing the same day.',
		filedUnder: [{ table: 'contacts', key: 'Pep Casals' }],
	},
	// Written for the meeting, and worth finding from the company too, without a
	// second copy of it.
	{
		type: 'prenote',
		format: 'markdown',
		title: 'Before the sync — Cal Pep',
		content:
			'## Aim\nAgree the booking flow before build starts.\n\n## Bring\n- Two layout options\n- The deposit question, which they have dodged twice',
		filedUnder: [
			{ table: 'calendar_events', key: 'Zoom sync with Cal Pep' },
			{ table: 'companies', key: 'cal-pep-fonda' },
		],
	},
	{
		type: 'call_notes',
		format: 'markdown',
		title: 'What came out of the follow-up call',
		content:
			'## Outcome\nThey will send last quarter’s invoice volumes on Friday.\n\n## Blocker\nTheir accountant wants to see the export format first.',
		filedUnder: [{ table: 'tasks', key: 'Revisió mensual amb Cal Pep' }],
	},
	{
		type: 'general',
		format: 'markdown',
		title: 'Why this offer is shaped the way it is',
		content:
			'## Reasoning\nBooking management is priced monthly so the first invoice stays under their approval threshold.\n\n## If they push back\nDrop local SEO before touching the booking line.',
		filedUnder: [{ table: 'proposals', key: 'Web + Booking — Cal Pep Fonda' }],
	},
	// The one web page, so the "open the page" link has something to open and
	// the stored-file path is exercised by the seed, not only by tests.
	{
		type: 'research',
		format: 'html',
		title: 'Cal Pep Fonda — saved website',
		content: `<!doctype html>
<html lang="ca">
	<head>
		<meta charset="utf-8" />
		<title>Cal Pep Fonda</title>
		<style>
			body { font-family: Georgia, serif; margin: 3rem auto; max-width: 40rem; }
			h1 { font-variant: small-caps; }
		</style>
	</head>
	<body>
		<h1>Cal Pep Fonda</h1>
		<p>Cuina catalana de mercat des de 1978. Reserva la teva taula trucant al restaurant.</p>
		<h2>Horaris</h2>
		<ul><li>Dimarts a dissabte, 13:00-16:00 i 20:00-23:00</li><li>Diumenge, nomes migdia</li></ul>
		<p>Telefon: 938 000 000</p>
	</body>
</html>`,
		filedUnder: [{ table: 'companies', key: 'cal-pep-fonda' }],
	},
]

// Mirrors `searchTextFromHtml` in the server: the plain words of a page, so a
// search still reaches a document whose body is a file. Duplicated rather than
// imported because the CLI does not depend on the server package.
const plainWordsOf = (html: string): string =>
	html
		.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&nbsp;/gi, ' ')
		.replace(/\s+/g, ' ')
		.trim()

const htmlKeyFor = (orgId: string, documentId: string): string =>
	`documents/${orgId}/${documentId}.html`

export const seedDocuments = (
	{ sql, stamp, tallerOrgId }: SeedCtx,
	subjects: Record<SubjectTable, Map<string, string>>,
) =>
	Effect.gen(function* () {
		yield* Effect.logInfo('Seeding documents...')

		const rows = withSeedIds(
			'document',
			DOCUMENTS.map(doc => ({
				type: doc.type,
				format: doc.format,
				title: doc.title,
				// A web page's body is a file, not a column; only its plain words
				// stay behind so search can still reach it.
				content: doc.format === 'html' ? '' : doc.content,
				searchText: doc.format === 'html' ? plainWordsOf(doc.content) : null,
				// A placeholder until the loop below, which needs the row's id to
				// name the file.
				storageKey: doc.format === 'html' ? ('pending' as string | null) : null,
			})),
			(_, index) => String(index),
		)

		// The page has to be in storage before the row that points at it, and its
		// name is built from the id — which is why the ids are chosen above rather
		// than left to the database.
		const htmlDocs = DOCUMENTS.map((doc, index) => ({ doc, index })).filter(
			({ doc }) => doc.format === 'html',
		)
		if (htmlDocs.length > 0) {
			const s3 = new S3Client({
				endpoint: yield* Config.string('STORAGE_ENDPOINT'),
				region: yield* Config.string('STORAGE_REGION'),
				credentials: {
					accessKeyId: yield* Config.string('STORAGE_ACCESS_KEY_ID'),
					secretAccessKey: Redacted.value(
						yield* Config.redacted('STORAGE_SECRET_ACCESS_KEY'),
					),
				},
				forcePathStyle: true,
			})
			const bucket = yield* Config.string('STORAGE_BUCKET')
			for (const { doc, index } of htmlDocs) {
				const key = htmlKeyFor(tallerOrgId, rows[index]!.id)
				rows[index]!.storageKey = key
				yield* Effect.promise(() =>
					s3.send(
						new PutObjectCommand({
							Bucket: bucket,
							Key: key,
							Body: doc.content,
							ContentType: 'text/html; charset=utf-8',
						}),
					),
				)
			}
		}

		yield* sql`INSERT INTO documents ${sql.insert(normalizeRows(stamp(rows)))}`

		const links = DOCUMENTS.flatMap((doc, index) =>
			doc.filedUnder.flatMap(ref => {
				const subjectId = subjects[ref.table].get(ref.key)
				// A fixture naming a record the seed did not create is skipped rather
				// than filed against an id that resolves to nothing.
				if (subjectId === undefined) return []
				return [
					{ documentId: rows[index]!.id, subjectTable: ref.table, subjectId },
				]
			}),
		)

		yield* sql`INSERT INTO document_links ${sql.insert(
			normalizeRows(stamp(links)),
		)}`
		yield* Effect.logInfo(`  ${rows.length} documents, ${links.length} filings`)
	})

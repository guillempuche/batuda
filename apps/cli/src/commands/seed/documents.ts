import { Effect } from 'effect'

import type { InteractionRow } from './crm'
import { normalizeRows, type SeedCtx } from './shared'

export const seedDocuments = (
	{ sql, stamp }: SeedCtx,
	companyMap: Map<string, string>,
	insertedInteractions: ReadonlyArray<InteractionRow>,
) =>
	Effect.gen(function* () {
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
	})

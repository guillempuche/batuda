import { Effect } from 'effect'

import type { ProductRow } from './crm'
import { normalizeRows, type SeedCtx } from './shared'

// One row per pipeline status so the dashboard exercises every status pill.
export const seedProposals = (
	{ sql, stamp }: SeedCtx,
	companyMap: Map<string, string>,
	contactMap: Map<string, string>,
	insertedProducts: ReadonlyArray<ProductRow>,
) =>
	Effect.gen(function* () {
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
	})

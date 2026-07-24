import { Schema } from 'effect'

import {
	Citation,
	DiscoveredExisting,
	PendingPaidAction,
	ProposedUpdate,
	Sourced,
} from './_shared'

export const CompanyEnrichmentV1Schema = Schema.Struct({
	enrichment: Schema.Struct({
		industry: Schema.optionalKey(Sourced(Schema.String)),
		size_range: Schema.optionalKey(Sourced(Schema.String)),
		pain_points: Schema.optionalKey(
			Sourced(
				Schema.String.annotate({
					description:
						"A specific operational pain or challenge the evidence indicates this company has, e.g. 'manual load booking across several systems'. This is not the place for a note about disagreeing sources — put those in `conflicts`.",
				}),
			),
		),
		current_tools: Schema.optionalKey(
			Sourced(
				Schema.String.annotate({
					description:
						"The company's own business or operations software (e.g. TMS, ERP, CRM, WMS, load boards). Exclude generic website infrastructure that appears on any site — reCAPTCHA, analytics, CDNs, cookie/consent banners.",
				}),
			),
		),
		tags: Schema.optionalKey(
			Schema.Array(
				Schema.String.annotate({
					description:
						"A short descriptive label for this company drawn from the evidence, e.g. 'refrigerated', 'cross-border', 'FMCSA-licensed'. Only labels the evidence supports.",
				}),
			),
		),
		location: Schema.optionalKey(Sourced(Schema.String)),
		country: Schema.optionalKey(
			Sourced(
				Schema.String.annotate({
					description:
						'ISO 3166-1 alpha-2 country code, e.g. US, ES, DE — the country the company is based in.',
				}),
			),
		),
	}),
	// The fit judgement the run reaches. It was previously written only into the
	// human brief and lost from the structured output, so a consumer reading
	// `findings` couldn't tell a qualified prospect from a disqualified one.
	verdict: Schema.optionalKey(
		Schema.Literals([
			'strong_fit',
			'possible_fit',
			'weak_fit',
			'no_fit',
		]).annotate({
			description:
				'Whether this company fits the target customer profile, judged against the fit rules in the active instructions. Use the same verdict the brief states.',
		}),
	),
	verdict_rationale: Schema.optionalKey(
		Schema.String.annotate({
			description:
				'One or two plain sentences explaining the verdict, citing the deciding facts.',
		}),
	),
	// Each fit rule the company fails, so a "no fit" is auditable rather than a bare
	// label. The quote and source point at the evidence behind the rule.
	disqualifiers: Schema.optionalKey(
		Schema.Array(
			Schema.Struct({
				rule: Schema.String.annotate({
					description:
						'The fit rule the company fails, e.g. "asset-based carrier, not a freight broker".',
				}),
				evidence_quote: Schema.optionalKey(Schema.String),
				source_id: Schema.optionalKey(Schema.String),
			}),
		),
	),
	// A per-criterion companion to the holistic verdict: one row per fit rule
	// from the instructions, each judged from the evidence, so a reader sees
	// WHICH rules the company passes instead of trusting one overall word.
	fit_checks: Schema.optionalKey(
		Schema.Array(
			Schema.Struct({
				criterion: Schema.String.annotate({
					description:
						'One fit rule from the instructions, stated short, e.g. "freight broker, not asset carrier".',
				}),
				result: Schema.Literals(['pass', 'fail', 'unknown']).annotate({
					description:
						'Whether the evidence shows the company meets this criterion; "unknown" when the evidence does not say.',
				}),
				evidence_quote: Schema.optionalKey(Schema.String),
				source_id: Schema.optionalKey(Schema.String),
			}),
		),
	),
	// A one-line outreach angle grounded in the evidence. Absent when the evidence
	// supports none — never a fabricated number or claim.
	hook: Schema.optionalKey(
		Schema.String.annotate({
			description:
				'A short, specific outreach angle drawn only from the evidence. Leave it out rather than invent a figure or a pain point.',
		}),
	),
	// A home for "the sources disagree" observations — three sites giving three
	// different head-counts is genuinely useful, but it is not a pain point, so it
	// no longer gets stuffed into `pain_points` as a scratch field. The field
	// itself carries the most recently published reading; each entry here is one
	// losing reading, tied to the page that stated it so a reader can weigh both.
	conflicts: Schema.optionalKey(
		Schema.Array(
			Schema.Struct({
				field: Schema.String.annotate({
					description: 'The field the sources disagree on, e.g. "size_range".',
				}),
				value: Schema.String.annotate({
					description:
						'One reading the sources gave that the field did NOT take, e.g. "11-50". The field itself should carry the most recently published reading.',
				}),
				source_id: Schema.optionalKey(
					Schema.String.annotate({
						description: 'URL of the source that stated this reading.',
					}),
				),
				note: Schema.optionalKey(
					Schema.String.annotate({
						description:
							'Optional context on the disagreement, e.g. "Indeed snapshot looks older than the careers page".',
					}),
				),
			}),
		),
	),
	competitors: Schema.optionalKey(
		Schema.Array(
			Schema.Struct({
				name: Schema.String,
				website: Schema.optionalKey(Schema.String).annotate({
					description:
						"The competitor's own official website. It must belong to the named competitor — not a directory/aggregator profile page and not another company that happened to appear in search results.",
				}),
				why: Schema.optionalKey(Schema.String),
				citations: Schema.Array(Citation),
			}),
		),
	),
	contacts: Schema.optionalKey(
		Schema.Array(
			Schema.Struct({
				name: Schema.String,
				role: Schema.optionalKey(Sourced(Schema.String)),
				email: Schema.optionalKey(Sourced(Schema.String)),
				phone: Schema.optionalKey(Sourced(Schema.String)),
				// The page(s) that name this person as the company's own staff, so a
				// contact can be tied to the target and not confused with a client,
				// partner, or competitor's executive quoted on the same site.
				citations: Schema.optionalKey(Schema.Array(Citation)).annotate({
					description:
						'Sources naming this person as the company\'s own leader or employee (prefer the company\'s own website). A person described as a client, partner, or "customer testimonial" is not a contact.',
				}),
			}),
		),
	),
	discovered_existing: Schema.optionalKey(Schema.Array(DiscoveredExisting)),
	proposed_updates: Schema.optionalKey(Schema.Array(ProposedUpdate)),
	pending_paid_actions: Schema.optionalKey(Schema.Array(PendingPaidAction)),
})

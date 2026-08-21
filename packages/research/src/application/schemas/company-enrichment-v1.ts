import { Schema } from 'effect'

import {
	Citation,
	DiscoveredExisting,
	PendingPaidAction,
	ProposedUpdate,
	SocialProfile,
	Sourced,
} from './_shared'

export const CompanyEnrichmentV1Schema = Schema.Struct({
	enrichment: Schema.Struct({
		industry: Schema.optionalKey(Sourced(Schema.String)),
		size_range: Schema.optionalKey(Sourced(Schema.String)),
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
		// The company's registration number, sourced like every other field here.
		// The prospect scan reads one too, but as a plain string with no page behind
		// it, so nothing can be written from that — this is the graded version.
		tax_id: Schema.optionalKey(
			Sourced(
				Schema.String.annotate({
					description:
						'The number the company is registered or taxed under, copied exactly as printed — a Spanish NIF/CIF, a UK company number, an EU VAT number. Take it only from a page that states it for THIS company (its own legal notice or imprint, or an official register); never assemble or infer one.',
				}),
			),
		),
		// How to reach the company itself, as opposed to one of its people. For a
		// company with a thin website and nobody named on it, a department mailbox
		// or a switchboard number printed on its contact page is the only way in.
		email: Schema.optionalKey(
			Sourced(
				Schema.String.annotate({
					description:
						"A mailbox the company publishes for itself — a department or role address printed on its own pages (info@, sales@, hola@). A named person's own address belongs on that person in the people list, not here.",
				}),
			),
		),
		phone: Schema.optionalKey(
			Sourced(
				Schema.String.annotate({
					description:
						"The company's own published telephone number, copied as printed including its country code where the page gives one.",
				}),
			),
		),
		website: Schema.optionalKey(
			Sourced(
				Schema.String.annotate({
					description:
						"The company's own official website. It must be the site the company runs — not a directory or aggregator profile page about the company, and not a social-media page. A page on a platform goes in `social_profiles` instead, even when it is the only web presence you can find.",
				}),
			),
		),
		// Where the social-media pages the website field refuses belong. A company
		// with no site of its own often has one of these and nothing else, and it
		// is worth keeping as a way of reaching the company rather than being lost
		// for not being a website.
		social_profiles: Schema.optionalKey(Schema.Array(SocialProfile)),
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
	// A home for "the sources disagree" observations — three sites giving three
	// different head-counts is useful to whoever reads the profile. The disputed
	// field carries the most recently published reading; each entry here is one
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

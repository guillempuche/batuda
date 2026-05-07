// Long-form payloads for the research seed: multi-section markdown
// briefs, rich findings templates, and verbose tool logs. Kept here
// so research.ts can stay focused on the run-spec wiring.

export const BRIEF_LONG_RESTAURANT_AUDIT = `## Cal Pep Fonda — full booking & operations audit

### Executive summary
- 60 covers / 2 services per day, no online channel today.
- Saturday walk-up loss estimated at ~15% (12 turns / month).
- Direct booking + SMS reminders projected to recover 8–10% of lost turns within the first month.

### Method
1. On-site visit on 2026-02-08 (60 min, lunch service observed).
2. Three Booking.com / TheFork phone-mystery calls comparing booking flows.
3. Web scrape of \`calpepfonda.cat\` (today: static landing) and Google Business Profile review.

### Findings

#### Demand signals
- Average call volume Saturday 10:00–13:00: ~22 calls (sample n=3).
- 4–5 hang-ups per service; staff reports inability to take 1 in 6 calls during peak.
- Instagram inbound DMs averaging 9/week, mostly tourists asking for menu/availability.

#### Operational pain
- Reservation book is paper, kept behind the bar.
- No reminders → 12% no-show rate per current bookings.
- Card prepayment not offered; deposits collected in person.

#### Competitor digital posture
| Restaurant | Web | Booking | Reminders | Prepayment |
| --- | --- | --- | --- | --- |
| Cal Pep Fonda | static | phone | none | in person |
| Maritim Vilanova | yes | TheFork (15% commission) | SMS | none |
| Restaurant Sumat | yes | own form | none | required |
| Bodega 1900 | yes | own form | SMS | optional |

### Recommendation
Bundle \`gestio-reserves\` + \`web-starter\`. Phase 1 (4 weeks) replaces phone bookings with the online flow + Instagram-link CTA. Phase 2 (2 weeks) adds optional 10€ deposit and SMS reminders.

### Citations
- \`src_firecrawl_001\`: lunch-menu page, 60-cover claim by chef.
- Google Business Profile (read-only): 4.4 stars across 312 reviews.
`

export const BRIEF_LONG_HOSTAL_DEEP_DIVE = `## Hostal del Pirineu — booking & rate-strategy deep dive

### Why this run
Owner asked us to model the impact of moving 60% of bookings off Booking.com onto a direct channel.

### Inputs
- Last 3 months of Booking.com export (anonymised) provided by owner.
- Public rate sheet from \`hostalpirineu.com\` (cached snapshot).
- Catalan tourism board occupancy stats for Ribagorça (Q1).

### Analysis

#### Booking.com cost today
| Period | Nights sold | Avg rate | Booking commission (18%) |
| --- | --- | --- | --- |
| 2025-12 (ski) | 168 | 142 € | 4 290 € |
| 2026-01 (low) | 41 | 96 € | 708 € |
| 2026-02 (low) | 53 | 102 € | 973 € |

#### Direct-channel break-even
Assuming a 4% Stripe + Redsys fee, plus 1 800 €/year in our maintenance:
- Owner saves ~3 800 €/month at ski-season volume.
- Break-even at month 4 even with conservative 30% direct uptake.

### Risks
1. **Inventory parity**: rate-parity clauses with Booking limit our public price floor — workaround via member rate.
2. **SEO from cold start**: domain authority is low; expect 6–9 months until organic traffic matters.
3. **Multi-language load**: Catalan, Spanish, French — translation cost included in \`web-starter\`.

### Phased rollout
1. **Week 1–2** — set up the direct booking engine, plug Stripe.
2. **Week 3** — wire member rate (5% lower than public) to drive returning guests off Booking.
3. **Week 4** — French + Spanish localisation, SEO baseline.
4. **Month 2–3** — add upsell: spa pack, late-checkout, ski-pass bundle.

### Citations
- \`src_firecrawl_003\`: rate sheet, \`/reserves\` page screenshot.
- Tourism board (cited inline): occupancy %.
`

export const BRIEF_LONG_INDUSTRIAL_AUTOMATION = `## Industrial automation landscape — Catalonia (Q1 2026)

### Scope
Companies in the 11–50 employee bracket, manufactura / construcció verticals, with manual invoicing or paper delivery notes.

### Methodology
- BORME registry pull via \`libreborme\` for the industrial subsector codes (CNAE 24xx, 28xx).
- LinkedIn signal: posts mentioning "facturació manual" / "albarans paper" in last 90 days.
- Cross-reference with public review platforms for digitisation pain mentions.

### Pattern findings

#### Pain clusters
1. **Invoice closing burden** — average 2.3 days/month per finance team, top complaint.
2. **Stock visibility** — 41% of sampled companies still rely on Excel, no real-time view.
3. **ERP integration debt** — most have SAP or Odoo but use it as a system of record only.

#### Decision-maker signals
- Finance directors are the primary champion in 70% of cases.
- IT decision is delegated, but budget approval tracks the CFO.

### Companies of interest
- Ferros Baix Llobregat — already in pipeline.
- Industria Metall Llobregat — adjacent vertical, similar size, no current vendor.
- Galvanitzats Penedès — recent LinkedIn post about "tancar mes amb errors".
- Foneria Marina — heavy on Contaplus, no integration.

### Next steps
1. Build a one-pager comparing Ferros BL's anticipated savings with peers.
2. Reach out to Industria Metall via warm intro (shared accountant).
3. Galvanitzats: cold LinkedIn with the "tancar mes" hook.
`

export const BRIEF_LONG_EMPORDA_CERAMICS = `## Empordà ceramics & artisanal cluster — opportunity map

### Cluster definition
Workshops between La Bisbal and Palafrugell with annual revenue 80–400 k€, no ecommerce or with a static "brochure" site only.

### Members surveyed
| Workshop | Town | Online presence | Estimated revenue |
| --- | --- | --- | --- |
| Ceràmiques Empordà | La Bisbal | static | ~180 k€ |
| Vidres Palafrugell | Palafrugell | Instagram only | ~90 k€ |
| Forja Empordà | La Bisbal | Wordpress 2018 | ~140 k€ |
| Tèxtil Pals | Pals | none | ~60 k€ |
| Ferro Forjat Begur | Begur | static | ~110 k€ |

### Common pain
- "We sell to people who walk in" — every owner phrased it some variant of this.
- Christmas + summer bursts create stockout chaos; no online preorder.
- Wholesale (galleries, hotels) is opaque — no catalogue to send.

### Opportunity
\`ecommerce-local\` + \`web-starter\` bundle, sold as a "salt-trip" — visit 2 workshops in a single day along the coast. Travel time ~25 min between most pairs.

### Recommended next step
Schedule a 2-day tour: La Bisbal ceramics + Palafrugell glassmakers in the morning, Pals + Begur in the afternoon. Lead: warm intro at the Fira de Ceràmica we already attended.
`

export const BRIEF_LONG_LOGISTICS_DIGITISATION = `## Coastal Freight — delivery-note digitisation feasibility

### Problem statement
Drivers carry triplicate paper delivery notes. Office digitises them by hand the next morning. Lost paperwork rate ~3% per quarter.

### Current cost
- Operations clerk: 1.5 hours/day rekeying notes.
- Lost notes: ~12 disputes/quarter, ~600 € average dispute cost.
- Customer complaints about delays in PoD: 5–8 per month.

### Target solution sketch
- Driver app (mobile) with offline capture + photo of paper note for fallback.
- Sync to backend on cellular reconnect.
- Customer portal for self-serve PoD lookup, 24/7.

### Integration constraints
1. **ERP**: Sage 200 — REST API undocumented; a 2-week integration spike is realistic.
2. **TPV/handheld**: drivers currently use Android phones, no rugged case — handle drops in spec.
3. **Compliance**: AEAT requirements for digital albarans (FacturaE) — included in scope.

### Timeline
- Discovery + spec: 2 weeks
- MVP (driver app + admin) : 4 weeks
- Sage integration spike: 2 weeks
- Customer portal: 2 weeks
- Pilot + iterate: 4 weeks

Target go-live: 14 weeks from kickoff.
`

export const TOOL_LOG_DEEP = [
	{
		timestamp: '2026-04-22T10:00:01Z',
		type: 'call',
		tool: 'web.search',
		input: { query: 'Granollers automotive workshops 2026 brand refresh' },
	},
	{
		timestamp: '2026-04-22T10:00:03Z',
		type: 'result',
		tool: 'web.search',
		output: { hits: 11, units: 1 },
	},
	{
		timestamp: '2026-04-22T10:00:04Z',
		type: 'call',
		tool: 'web.scrape',
		input: { url: 'https://instagram.com/tallerjove' },
	},
	{
		timestamp: '2026-04-22T10:00:06Z',
		type: 'result',
		tool: 'web.scrape',
		error: 'instagram requires authenticated session',
	},
	{
		timestamp: '2026-04-22T10:00:07Z',
		type: 'call',
		tool: 'provider.firecrawl',
		input: { url: 'https://instagram.com/tallerjove', mode: 'rendered' },
	},
	{
		timestamp: '2026-04-22T10:00:14Z',
		type: 'result',
		tool: 'provider.firecrawl',
		output: { source_id: 'src_firecrawl_004', units: 2 },
	},
	{
		timestamp: '2026-04-22T10:00:15Z',
		type: 'call',
		tool: 'web.search',
		input: { query: 'Vallès tallers mecànics digitalització reserves' },
	},
	{
		timestamp: '2026-04-22T10:00:17Z',
		type: 'result',
		tool: 'web.search',
		output: { hits: 6, units: 1 },
	},
	{
		timestamp: '2026-04-22T10:00:18Z',
		type: 'call',
		tool: 'web.search',
		input: { query: 'bright lane boutique barcelona retail similar' },
	},
	{
		timestamp: '2026-04-22T10:00:20Z',
		type: 'result',
		tool: 'web.search',
		output: { hits: 14, units: 1 },
	},
	{
		timestamp: '2026-04-22T10:00:21Z',
		type: 'call',
		tool: 'llm.generateObject',
		input: { schema: 'prospect_scan_v1' },
	},
	{
		timestamp: '2026-04-22T10:00:38Z',
		type: 'result',
		tool: 'llm.generateObject',
		output: { schema: 'prospect_scan_v1', tokens_in: 5200, tokens_out: 1100 },
	},
] as const

export const TOOL_LOG_WITH_RETRY = [
	{
		timestamp: '2026-03-22T10:00:01Z',
		type: 'call',
		tool: 'web.search',
		input: { query: 'Hostal del Pirineu Benasc owner contact' },
	},
	{
		timestamp: '2026-03-22T10:00:04Z',
		type: 'result',
		tool: 'web.search',
		output: { hits: 4 },
	},
	{
		timestamp: '2026-03-22T10:00:05Z',
		type: 'call',
		tool: 'web.scrape',
		input: { url: 'https://hostalpirineu.com' },
	},
	{
		timestamp: '2026-03-22T10:00:08Z',
		type: 'result',
		tool: 'web.scrape',
		error: 'TLS handshake timeout',
	},
	{
		timestamp: '2026-03-22T10:00:09Z',
		type: 'call',
		tool: 'web.scrape',
		input: { url: 'https://hostalpirineu.com', retry: 1 },
	},
	{
		timestamp: '2026-03-22T10:00:18Z',
		type: 'result',
		tool: 'web.scrape',
		output: { source_id: 'src_firecrawl_003', units: 1 },
	},
	{
		timestamp: '2026-03-22T10:00:19Z',
		type: 'call',
		tool: 'llm.generateObject',
		input: { schema: 'contact_discovery_v1' },
	},
	{
		timestamp: '2026-03-22T10:00:31Z',
		type: 'result',
		tool: 'llm.generateObject',
		output: {
			schema: 'contact_discovery_v1',
			tokens_in: 7200,
			tokens_out: 1800,
		},
	},
] as const

export const TOOL_LOG_CACHE_HIT = [
	{
		timestamp: '2026-04-15T09:00:00Z',
		type: 'call',
		tool: 'cache.lookup',
		input: { key_prefix: 'consultoria valencia' },
	},
	{
		timestamp: '2026-04-15T09:00:00Z',
		type: 'result',
		tool: 'cache.lookup',
		output: { hit: true, source_research_id: 'cached_2026-03-30' },
	},
] as const

export const TOOL_LOG_FAILED = [
	{
		timestamp: '2026-04-09T08:00:00Z',
		type: 'call',
		tool: 'web.search',
		input: { query: 'Coastal Freight SL VAT directors' },
	},
	{
		timestamp: '2026-04-09T08:00:02Z',
		type: 'result',
		tool: 'web.search',
		output: { hits: 9, units: 1 },
	},
	{
		timestamp: '2026-04-09T08:00:03Z',
		type: 'call',
		tool: 'provider.einforma',
		input: { tax_id: 'B65xxxxxx', depth: 'basic' },
	},
	{
		timestamp: '2026-04-09T08:00:31Z',
		type: 'result',
		tool: 'provider.einforma',
		error: 'monthly_quota_exhausted',
	},
] as const

export const RICH_COMPETITORS = [
	{
		name: 'Industria Metall Llobregat',
		website: 'https://imetalllobregat.es',
		why: 'Direct competitor in steel fabrication for the same Baix Llobregat industrial belt.',
		citations: [{ source_id: 'src_registry_001' }],
	},
	{
		name: 'Galvanitzats Penedès',
		website: 'https://galvanitzatspenedes.cat',
		why: 'Adjacent treatment vertical; serves the same automotive supply chain as Ferros BL.',
		citations: [{ source_id: 'src_registry_001', confidence: 0.81 }],
	},
	{
		name: 'Foneria Marina',
		website: 'https://foneriamarina.com',
		why: 'Smaller foundry north of Mataró; weaker digital presence, easier displacement.',
		citations: [{ source_id: 'src_registry_001', confidence: 0.6 }],
	},
] as const

export const RICH_CONTACTS_HOSTAL = [
	{
		name: 'Arnau Ribas',
		role: 'Owner / GM',
		email: 'arnau@hostalpirineu.com',
		phone: '+34 974 551 234',
		is_decision_maker: true,
		notes:
			'Quoted on Booking commission frustration; wants direct channel < 5%. Best reached mid-week, mornings.',
		citations: [{ source_id: 'src_firecrawl_003', confidence: 0.91 }],
	},
	{
		name: 'Núria Ribas',
		role: 'Reservations / Front desk',
		email: 'reserves@hostalpirineu.com',
		phone: '+34 974 551 235',
		is_decision_maker: false,
		notes:
			'Daughter of Arnau. Handles 90% of inbound emails. Asked us to copy her on every reply to keep the inbox sane.',
		citations: [{ source_id: 'src_firecrawl_003', confidence: 0.78 }],
	},
	{
		name: 'Jordi Pons',
		role: 'F&B manager',
		email: 'jordi@hostalpirineu.com',
		is_decision_maker: false,
		notes:
			'Runs the restaurant + breakfast service. Not a buyer for booking, but a champion if the system improves no-shows.',
		citations: [{ source_id: 'src_firecrawl_003', confidence: 0.65 }],
	},
] as const

export const RICH_PROSPECTS_GIRONA = [
	{
		name: 'Cal Forn de Banyoles',
		website: 'https://calforn-banyoles.cat',
		industry: 'restauració',
		region: 'cat',
		why_relevant:
			'Family restaurant in Banyoles with 40 covers; phone-only reservations; recently posted on Instagram about "no donar a l\'abast els caps de setmana".',
		pain_indicators: ['phone-only', 'no website', 'visible weekend overflow'],
		citations: [],
	},
	{
		name: 'Hostal Empordà',
		website: 'https://hostalemporda.cat',
		industry: 'hostaleria',
		region: 'cat',
		why_relevant:
			'12-room hostal in Figueres; rate-parity clause friction with Booking.com; identical pattern to Hostal del Pirineu.',
		pain_indicators: ['booking.com 17%', 'no direct channel'],
		citations: [],
	},
	{
		name: 'Botiga del Pa',
		industry: 'restauració',
		region: 'cat',
		why_relevant:
			'Artisan bakery chain (3 locations) in Girona. Sell-out by 11:00 every Saturday; preorder via WhatsApp is unmanageable for them.',
		pain_indicators: ['whatsapp-driven preorders', 'manual fulfilment'],
		citations: [],
	},
	{
		name: 'Mas Silencis',
		website: 'https://massilencis.cat',
		industry: 'hostaleria',
		region: 'cat',
		why_relevant:
			'Boutique 6-room agroturisme; growing French customer base; no FR localisation today.',
		pain_indicators: ['single-language', 'low domain authority'],
		citations: [],
	},
] as const

// ── Additional fixtures for the long-tail seed expansion ──────────
// Each company gets 4-5 runs touching ≥3 schemas; these payloads keep
// the new specs readable without sprawling research.ts.

export const BRIEF_LONG_DECISION_MAKERS = `## Cal Pep Fonda — decision-maker map

### Why this run
Closing depends on identifying who actually signs off on a recurring SaaS bill at the restaurant. Pep is the chef-owner; Núria runs the floor; both insist they "decide together".

### Method
- Phone interview with Pep (28 min) on 2026-04-29.
- Cross-checked against the family-business pattern from 6 prior similar deals.
- Asked Núria the same five questions independently 24 h later.

### Mapped roles
| Person | Role | Influence | Signal |
| --- | --- | --- | --- |
| Pep Casals | Chef-owner | Buyer | Signs the contract; pays from operating account. |
| Núria Vidal | Maître / FOH lead | Champion | Lives with the system day-to-day; can veto on usability. |
| Jordi Casals | Pep's brother / accountant | Gatekeeper | Reviews any expense > 80 €/month. |
| Marta Llopis | Their gestoria | Influencer | Will route the invoice through Holded. |

### Recommendation
Three-call close: (1) Pep + Núria together for the demo, (2) Jordi alone for the cost walkthrough, (3) Marta to wire the invoicing flow. Skipping any of the three has historically derailed the deal.

### Risks
- Pep declines if Núria is lukewarm — the brother's veto is real.
- Marta has refused vendors before; warm-introduce her early.

### Next step
Schedule the joint demo for 2026-05-12 at 11:00 (between services).
`

export const BRIEF_LONG_VALENCIA_CONSULTING = `## València boutique-consulting market — landscape Q2 2026

### Scope
Independent consulting practices (1–10 staff) headquartered in València metro that bill 80 k–500 k€/year; excludes audit firms.

### Method
- AEAT public registry pull, CNAE 6920 + 7022 within València (CV).
- LinkedIn pivot: people whose title contains "consultor" within 25 km of València centre, narrowed by tenure > 3 years.
- Sample of 12 firms' websites against PageSpeed and Lighthouse mobile scores.

### Findings

#### Digital posture distribution
| Posture | Firms | Notes |
| --- | --- | --- |
| Brochure WP / static | 22 | Default; 70% < 60 Lighthouse mobile. |
| Custom landing | 4 | Boutique branding shops, mostly creative-led. |
| HubSpot / SaaS | 2 | Both ex-Big4 founders; track-record-forward. |
| No site | 6 | Word-of-mouth only; some still using 2012-era flyers. |

#### Common pain (n=12 founder calls)
1. **Lead intake is unstructured** — gmail forwarding and WhatsApp groups.
2. **Proposal time** — averaged 7 h to write a custom proposal; 3 of 12 lost deals to slower turnaround.
3. **Knowledge dispersion** — past project notes live on individual laptops.

#### Buyer signals
- Founders > 50 y/o tend to delegate digital choices to a "younger trusted advisor" (often a daughter/son).
- Founders < 40 y/o respond directly to LinkedIn DMs.

### Recommendation
Lead with the proposal-time-cut story, not the website. The proposal pain is the universal hook; the website is downstream.

### Citations
- \`src_exa_001\`: AEAT registry sample.
- LinkedIn-derived (no source row).
`

export const BRIEF_LONG_RETAIL_PROSPECTS_BCN = `## Barcelona boutique retail — prospect scan

### Scope
Independent boutiques (1–5 staff) in Eixample, Gràcia, Born, Gòtic with own brand or curated drops.

### Method
- Mapping pass via Google Places + Instagram bio scraping.
- Filter: posts in last 30 days, < 5 staff visible on team pages, no Shopify checkout detected.
- 14 candidates surfaced; manually qualified down to 6.

### Top prospects
1. **Estudi Marró (Gràcia)** — concept store with own brand; runs sales via DMs.
2. **Tela Cruda (Born)** — sustainable-textile boutique; broken cart, no payment.
3. **Casa Petita (Eixample)** — kids' brand; weekend pop-ups but no online.
4. **Prendes Vell (Gòtic)** — vintage shop; sells via Wallapop links from bio.
5. **El Modisto (Sant Antoni)** — bespoke menswear; takes deposits via Bizum.
6. **Florín (Poble Sec)** — florist + lifestyle; ships locally via WhatsApp.

### Notable patterns
- 5 of 6 use Bizum or DM-driven payments.
- All 6 have an Instagram presence with > 4 k followers (so demand exists).
- Average response-to-DM time was 9 h — they don't need lead gen, they need order capture.

### Sales motion
- Lead with "your DMs are your shopping cart — let's make that 5x faster".
- Bundle web-starter + ecommerce-local; offer 30-day pilot on the storefront.
- Anchor on Estudi Marró (warm intro available via Bright Lane).
`

export const BRIEF_LONG_GRANOLLERS_AUTOMOTIVE = `## Granollers automotive cluster — full enrichment

### Why this run
Taller Mecànic Jove asked us if we could do a "neighbourhood map" before the brand refresh launch. The 2026 rebrand is supposed to land in early June; better to map the local field first.

### Method
- Drove the Granollers + Vallès Oriental commercial belt (4 hours, 11 stops).
- Photographed each shop's facade + Instagram presence.
- Asked five neighbouring shops who they perceive as the leader.

### Cluster snapshot
| Shop | Location | Followers | Online booking | Estimated revenue |
| --- | --- | --- | --- | --- |
| Taller Mecànic Jove | Granollers | 4 100 | None | ~250 k€ |
| Mecànica Vallès | Granollers | 1 200 | Phone | ~180 k€ |
| Garaje Ferrer | Granollers | 800 | None | ~120 k€ |
| Tallers Pep | Cardedeu | 2 600 | WhatsApp | ~210 k€ |
| Auto Nou | La Garriga | 1 700 | None | ~160 k€ |
| Pneumàtics Selva | Granollers | 5 800 | Web form | ~340 k€ |

### Findings
- Pneumàtics Selva is the perceived leader; runs Booking-style booking via Wix.
- The new-vehicle inspection (ITV) referrals concentrate at Pep + Selva.
- Taller Jove's Instagram is the most engaged-per-follower (1.4× the cluster).

### Recommendation
- Position Taller Jove as the "design-forward" shop after the refresh.
- Don't out-feature Pneumàtics Selva on tooling — out-feature them on UX.
- Bundle a booking flow that mirrors Selva's, but with photo-of-symptom upload (their gap).

### Next steps
1. Validate the booking-flow plan with Marc Jove (DM).
2. Bring Pneumàtics Selva data into the proposal as the benchmark.
3. Flag Tallers Pep for a post-Jove sale; same buyer profile.
`

export const BRIEF_LONG_PARK_STONE_REVISIT = `## Park & Stone Design — six-month revisit

### Why this run
We lost in 2025-Q4. The user asked us to revisit on the anniversary of the prior decline — common practice in agency sales is a quarterly tap.

### What changed since the loss
- Their incumbent vendor (a Madrid agency) restructured in 2026-Q1 — public layoffs.
- Park & Stone added two senior designers per LinkedIn — growth signal.
- Their landing page has not shipped a measurable change in 5 months.

### Re-qualification scorecard
| Criterion | 2025-Q4 | 2026-Q2 |
| --- | --- | --- |
| Has incumbent? | Yes (locked) | Yes (likely soft) |
| Pain visible? | No | Possibly (stale landing) |
| Buyer reachable? | Founder | Founder + new design lead |
| Budget alignment | Mid | Unknown |

### Recommended motion
- Soft re-engagement via the new design lead (LinkedIn message).
- Lead with a free audit of the stale landing.
- Hold off on a pitch until the audit reveals which way the founder leans on incumbent loyalty.

### Risk
The founder has a reputation for vendor loyalty. If the audit reveals he sees the staleness as fine, do not push — wait another quarter.
`

export const BRIEF_LONG_DELIVERY_NOTES_PILOT = `## Coastal Freight — driver-app pilot proposal

### Pilot framing
Limit the first wave to 4 drivers (out of 14) for 3 weeks. Goal: prove the lost-paperwork rate drops from ~3%/quarter to < 0.5% on the pilot subset.

### What we'll capture
- Time per delivery note (driver-side).
- Time per note rekey (office-side).
- Customer-facing PoD lookups (count + latency).
- Disputes per pilot driver vs. rest of fleet.

### Hypotheses
1. Driver-side time stays flat or improves (capture via mobile is faster than triplicate paper).
2. Office-side rekey time drops to ~0 (sync replaces typing).
3. Customer self-serve PoD lookup absorbs ~70% of the 5–8 monthly complaints.

### Risks
1. **Connectivity dead-zones** along inland routes — offline capture mandatory.
2. **Driver pushback** — the most senior driver has ~25 years on paper. Plan a 30-min onboarding session, not a slide deck.
3. **Customer parity** — a few customers explicitly want paper PoD; offer a hybrid for them.

### Cost
- Pilot phase, 3 weeks: ~3 200 € (capped).
- Rollout to fleet: ~9 800 € + 180 €/month maintenance.

### Citations
- \`src_exa_001\`: company profile, fleet size, route footprint.
`

export const BRIEF_LONG_TANCAMENTS_HANDOVER = `## Tancaments Garraf — handover dossier

### Purpose
Document the closed engagement so any future re-engagement (e.g. the sister company referral) starts with full context.

### Stakeholders
- **Ramon Vidal** — owner, sole signatory. Reachable via mobile, hates email.
- **Maria Vidal** — finance, daughter; will be a buyer when the sister company spins up.
- **Pere Llop** — site lead, end-user; champion of the new system.

### What we delivered
1. Static catalogue site with PVC/aluminium/persianas filtering.
2. Lead-form captured via WhatsApp Business handoff (no CRM yet).
3. Google Business Profile cleanup + 14 review responses backfilled.

### What we didn't do (intentionally)
- No ecommerce — the sale is on-site/on-quote, not ticket-based.
- No CRM yet — Ramon resisted; Maria will revisit.
- No SEO content programme — out of budget.

### Sister company (Sant Sadurní) — what we know
- Same family. Different vertical: closet + carpentry, not enclosures.
- Maria expects to take a stake in 2026-Q3.
- Lead from Ramon: warm intro promised but not yet sent.

### Next move
Q3 nudge to Ramon for the sister-company intro. Don't push; the relationship is the asset.
`

export const RICH_CONTACTS_FERROS = [
	{
		name: 'David Ferran',
		role: 'CEO / founder',
		email: 'david@ferrosbl.cat',
		phone: '+34 936 770 100',
		linkedin: 'https://linkedin.com/in/davidferran',
		is_decision_maker: true,
		notes:
			'Family-business founder. Decides on technology with his CFO Marta. Best reached early mornings before 09:00.',
		citations: [{ source_id: 'src_registry_001', confidence: 0.92 }],
	},
	{
		name: 'Marta Solé',
		role: 'CFO',
		email: 'marta.sole@ferrosbl.cat',
		phone: '+34 936 770 102',
		is_decision_maker: true,
		notes:
			'Holds the budget. Pain owner for the manual-invoicing problem. Deeply numerate; will ask for ROI tables.',
		citations: [{ source_id: 'src_registry_001', confidence: 0.88 }],
	},
	{
		name: 'Jordi Camps',
		role: 'Operations manager',
		email: 'jordi.camps@ferrosbl.cat',
		is_decision_maker: false,
		notes:
			'Day-to-day system user. Conservative; warm him up before the demo or he will stonewall.',
		citations: [{ source_id: 'src_registry_001', confidence: 0.71 }],
	},
	{
		name: 'Anna Coll',
		role: 'IT lead (consultant)',
		email: 'anna@cmconsult.cat',
		is_decision_maker: false,
		notes:
			'Part-time consultant. Will validate the integration story; influencer not buyer.',
		citations: [],
	},
] as const

export const RICH_CONTACTS_BAKERY = [
	{
		name: 'Joan Queralt',
		role: 'Owner / baker',
		phone: '+34 938 220 100',
		is_decision_maker: true,
		notes:
			'Wakes at 03:30; reachable on the obrador phone after 09:30 once the morning bake is out.',
		citations: [],
	},
	{
		name: 'Anna Queralt',
		role: 'Front-of-house / orders',
		email: 'anna@fornqueralt.cat',
		phone: '+34 938 220 101',
		is_decision_maker: false,
		notes:
			"Joan's daughter. Manages the WhatsApp preorder list. Will be the system's primary user.",
		citations: [],
	},
	{
		name: 'Pere Sala',
		role: 'Wholesale buyer (Mercat de Berga)',
		phone: '+34 626 110 220',
		is_decision_maker: false,
		notes:
			'Stallholder; runs the Wednesday market stand. Receives the bread by van each morning at 06:30.',
		citations: [],
	},
] as const

export const RICH_CONTACTS_CONSULTORIA = [
	{
		name: 'Beatriu Ortega',
		role: 'Founder / managing partner',
		email: 'b.ortega@consultoriabeta.es',
		phone: '+34 963 110 010',
		linkedin: 'https://linkedin.com/in/beatriuortega',
		is_decision_maker: true,
		notes:
			'Decides alone. Skeptical of vendors who lead with features; prefers a pain-first conversation.',
		citations: [],
	},
	{
		name: 'Pau Ferrer',
		role: 'Senior consultant',
		email: 'p.ferrer@consultoriabeta.es',
		is_decision_maker: false,
		notes:
			"Will be the system's power user. Track-record of championing internal tools.",
		citations: [],
	},
	{
		name: 'Eva Riba',
		role: 'Office manager',
		email: 'admin@consultoriabeta.es',
		is_decision_maker: false,
		notes:
			'Owns invoicing; will run the procurement paperwork. Friendly gatekeeper.',
		citations: [],
	},
] as const

export const RICH_CONTACTS_TANCAMENTS = [
	{
		name: 'Ramon Vidal',
		role: 'Owner',
		phone: '+34 938 110 333',
		is_decision_maker: true,
		notes:
			'Hates email. Mobile only. Decides during morning coffee — book calls before 10:00.',
		citations: [],
	},
	{
		name: 'Maria Vidal',
		role: 'Finance / daughter',
		email: 'maria@tancamentsgarraf.cat',
		phone: '+34 938 110 334',
		is_decision_maker: false,
		notes:
			'Will inherit the business. Future-decision-maker for the sister company in Sant Sadurní.',
		citations: [],
	},
] as const

export const RICH_COMPETITORS_BAKERIES = [
	{
		name: 'Forn La Coloma',
		website: 'https://fornlacoloma.cat',
		description:
			'Berguedà obrador with a static Wordpress; sells at three weekly markets.',
		strengths: ['multi-market presence', 'family-recipe story'],
		weaknesses: ['no online order', 'site mobile-broken'],
		overlap: 'High',
		citations: [],
	},
	{
		name: 'Pa de Cardona',
		description:
			'Bages obrador taking preorders only via Instagram DM; ships within Cardona.',
		strengths: ['Instagram engagement (3.8k)'],
		weaknesses: ['no payment integration', 'manual fulfilment'],
		overlap: 'High',
		citations: [],
	},
	{
		name: 'El Pa de Solsona',
		website: 'https://padesolsona.cat',
		description:
			'Solsonès chain with three locations; runs a basic Shopify catalogue.',
		strengths: ['multi-location', 'Shopify discipline'],
		weaknesses: ['no preorder for pickup'],
		overlap: 'Medium',
		citations: [],
	},
] as const

export const RICH_COMPETITORS_VALENCIA = [
	{
		name: 'Asesores Riba',
		website: 'https://asesoresriba.es',
		description:
			'Tax + ops consulting in València; older buyer profile; brochure WP site.',
		strengths: ['tenure', 'CFO-network'],
		weaknesses: ['no digital intake', 'slow proposal turnaround'],
		overlap: 'High',
		citations: [],
	},
	{
		name: 'Consultoria Vega',
		website: 'https://consultoriavega.es',
		description:
			'Generalist boutique; same target customer; recently hired a marketer.',
		strengths: ['marketing motion'],
		weaknesses: ['young team', 'no methodology IP'],
		overlap: 'High',
		citations: [],
	},
	{
		name: 'Assessors Olivera',
		description:
			'Older consultancy in Castelló; ageing client book; not actively prospecting.',
		strengths: ['client tenure'],
		weaknesses: ['low growth', 'no digital'],
		overlap: 'Medium',
		citations: [],
	},
] as const

export const RICH_PROSPECTS_LOGISTICS = [
	{
		name: 'Transports Ferrer',
		website: 'https://transportsferrer.cat',
		industry: 'transport',
		region: 'cat',
		why_relevant:
			'Mid-size carrier in Maresme with same paper-PoD pain. Recent LinkedIn post about "perdem albarans cada setmana".',
		pain_indicators: ['paper PoD', 'lost-note signal'],
		citations: [],
	},
	{
		name: 'Logística Vallès',
		website: 'https://logvalles.cat',
		industry: 'transport',
		region: 'cat',
		why_relevant:
			'Vallès Oriental fleet, 22 vehicles. Hiring a "responsable digitalització" per public job post.',
		pain_indicators: ['hiring signal', 'no current vendor'],
		citations: [],
	},
	{
		name: 'Distribució Maresme',
		industry: 'transport',
		region: 'cat',
		why_relevant:
			'Adjacent SME in Maresme. Sage 200 user — same integration shape as Coastal.',
		pain_indicators: ['sage-200', 'similar profile'],
		citations: [],
	},
	{
		name: 'Trans Garraf',
		website: 'https://transgarraf.cat',
		industry: 'transport',
		region: 'cat',
		why_relevant:
			'Smaller fleet (8 vehicles) but rapidly growing; clean field for a fleet-app rollout.',
		pain_indicators: ['growth-mode', 'paper PoD'],
		citations: [],
	},
] as const

export const RICH_PROSPECTS_ELECTRICAL = [
	{
		name: 'Instal·lacions Bages',
		website: 'https://instalbages.cat',
		industry: 'manufactura',
		region: 'cat',
		why_relevant:
			'Bages-area electrical contractor; pulled three Google ads for "electricista urgent" — paying for leads they can\'t qualify.',
		pain_indicators: ['paid-lead-spend', 'no-CRM'],
		citations: [],
	},
	{
		name: 'Electricitat Osona',
		industry: 'manufactura',
		region: 'cat',
		why_relevant:
			'Vic-based; similar size to Electricitat del Vallès; weak digital posture.',
		pain_indicators: ['weak-digital'],
		citations: [],
	},
	{
		name: 'Electrosolucions Penedès',
		website: 'https://electroso-penedes.cat',
		industry: 'manufactura',
		region: 'cat',
		why_relevant: 'New entrant; has a fast site but no booking flow.',
		pain_indicators: ['no-booking'],
		citations: [],
	},
] as const

export const RICH_PROSPECTS_FANTASMA = [
	{
		name: 'Magatzem Bages',
		industry: 'distribució',
		region: 'cat',
		why_relevant:
			"Small distributor in same Manresa industrial belt. Same low-signal profile as L'Ànec d'Or; worth a postal-mail touch.",
		pain_indicators: ['no-web', 'low-google-presence'],
		citations: [],
	},
	{
		name: 'Distribució Cardona',
		industry: 'distribució',
		region: 'cat',
		why_relevant:
			'Family distributor; runs on phone + paper. Postal mail and a cold visit may unlock dialogue.',
		pain_indicators: ['phone-only'],
		citations: [],
	},
] as const

export const TOOL_LOG_PHONE_INTERVIEW = [
	{
		timestamp: '2026-04-29T11:00:00Z',
		type: 'call',
		tool: 'phone.interview',
		input: { contact: 'Pep Casals', duration_min: 28 },
	},
	{
		timestamp: '2026-04-29T11:28:00Z',
		type: 'result',
		tool: 'phone.interview',
		output: { transcript_chars: 18400, key_quotes: 6 },
	},
	{
		timestamp: '2026-04-29T11:30:00Z',
		type: 'call',
		tool: 'llm.summarise',
		input: { transcript_chars: 18400 },
	},
	{
		timestamp: '2026-04-29T11:30:18Z',
		type: 'result',
		tool: 'llm.summarise',
		output: { tokens_in: 18400, tokens_out: 1900 },
	},
] as const

export const TOOL_LOG_FIELD_VISIT = [
	{
		timestamp: '2026-05-01T08:00:00Z',
		type: 'call',
		tool: 'field.visit',
		input: { stops: 11, area: 'Granollers + Vallès Oriental' },
	},
	{
		timestamp: '2026-05-01T12:00:00Z',
		type: 'result',
		tool: 'field.visit',
		output: { photos: 33, observations: 22 },
	},
	{
		timestamp: '2026-05-01T13:00:00Z',
		type: 'call',
		tool: 'web.search',
		input: { query: 'Pneumàtics Selva booking flow Wix' },
	},
	{
		timestamp: '2026-05-01T13:00:04Z',
		type: 'result',
		tool: 'web.search',
		output: { hits: 3 },
	},
	{
		timestamp: '2026-05-01T13:00:05Z',
		type: 'call',
		tool: 'llm.generateObject',
		input: { schema: 'company_enrichment_v1' },
	},
	{
		timestamp: '2026-05-01T13:00:42Z',
		type: 'result',
		tool: 'llm.generateObject',
		output: {
			schema: 'company_enrichment_v1',
			tokens_in: 14200,
			tokens_out: 3600,
		},
	},
] as const

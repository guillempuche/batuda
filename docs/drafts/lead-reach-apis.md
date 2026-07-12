# Lead & Contact Data-Sourcing Strategy for Batuda

*Internal analysis — how Batuda sources company and decision-maker data, and which external providers fill which gap. Supersedes the initial vendor survey; grounded in the pipeline as built.*

> Status: decision-ready. The pipeline and provider seams described here already exist in `packages/research`; the recommendations are about which vendors to slot into those seams, and in what order.

---

## 1. Summary

Batuda already runs the four-stage sourcing pipeline this document originally proposed to build — registry lookup → contact enrichment → email pattern-guess → MX gate + verify → rank — inside `packages/research`, with every external capability behind a vendor-swappable port. So the question is not "which single vendor" or "what pipeline," but which provider to slot into each existing seam, ranked by the real coverage gap.

The ranked conclusion:

- **Registries (company identity + officers):** Spain (libreBORME) and UK (Companies House) are live. The cleanest additions are **Colombia** (`datos.gov.co`, free, returns the legal representative) and the **United States** (Cobalt Intelligence, self-serve, 51 states). Netherlands, Singapore, and Australia have no self-serve officer API — cover them with one self-serve global aggregator (**Zephira**) rather than three brittle PDF parsers. Mexico is a paid per-company report (**Dato Capital**). Paraguay has no self-serve officer source at all.
- **Contact enrichment (email/phone for a named person):** Hunter is live. Add **FullEnrich** as its fallback for the misses — best independently-measured coverage, audited compliance, EU-hosted — after fixing the fallback to trigger on a miss, not only on an error. Hold Pipe0.
- **Email verification:** already handled in-pipeline (free MX pre-gate → Hunter verify, assert-only-if-confirmed). A separate verifier (ZeroBounce) is not needed at research time; add one at send time in the CRM pipeline only if measured bounce rates demand it.
- **Candidate search (People Data Labs):** deferred — US-centric, weak for Batuda's actual markets (Spanish SMBs, LATAM).
- **The decision instrument** is a contact-finding eval, mirroring the existing research eval harness: it measures recall, deliverability precision, and cost-per-verified-contact per region, so the FullEnrich / Zephira / Pipe0 spend decisions rest on Batuda's own numbers rather than vendor benchmarks.

Every hit-rate figure below is from a vendor-run benchmark (the sponsor always wins) and is used only for the relative picture. Coverage for Netherlands, Singapore, Australia, and all of LATAM outside Colombia is essentially unbenchmarked — pilot before committing.

---

## 2. The pipeline already exists

The initial survey read as if Batuda needed to design a sourcing pipeline from scratch. It does not. `packages/research` already exposes each external capability as a port, selected at boot by a `RESEARCH_PROVIDER_*` env var, with a comma-list fallback chain.

| Capability (port)                    | Job                                         | Live vendor(s)                        |
| ------------------------------------ | ------------------------------------------- | ------------------------------------- |
| `SearchProvider`                     | web search                                  | Firecrawl, Brave                      |
| `ScrapeProvider` / `ExtractProvider` | fetch + structure a page                    | Firecrawl                             |
| `EnrichmentProvider`                 | decision-maker name + email discovery       | **Hunter**                            |
| `EmailVerifier`                      | email deliverability                        | **Hunter**                            |
| `MxResolver`                         | free DNS MX pre-gate                        | built-in                              |
| `RegistryRouter`                     | company identity + officers, country-routed | libreBORME (ES), Companies House (GB) |
| `ReportRouter`                       | paid deep report, country-routed            | einforma (ES, not yet wired)          |

The contact-discovery flow already chains these: where a national registry exists it takes the officers from there (free, authoritative); otherwise it calls the enrichment provider (paid). For each person it takes the vendor's email or generates ordered pattern guesses, gates them through the free MX check, verifies deliverability, and returns only sendable addresses ranked by verdict. A guessed address is asserted only when the verifier positively confirms it; a vendor-provided address is kept unless it verifies as undeliverable.

Adding a vendor is therefore a new adapter plus one entry in the capability's vendor table — not new architecture. That is the lens for everything below.

---

## 3. What Batuda is sourcing, and for where

Batuda serves customers anywhere. The concrete target markets are **Spain, United Kingdom, Netherlands, Singapore, United States, LATAM (Paraguay, Argentina, Colombia, Mexico), and Australia**. The sourcing job has two halves, and they degrade differently by region:

- **Company identity + officers** — reliable wherever a national registry or a good aggregator exists.
- **A specific person's work email/phone** — meaningfully weaker outside the US and Western Europe, and the part that most often falls back to guess-and-verify.

The selection criteria for any new provider: documented REST API, self-serve signup (an API key without a sales call — the reason Verifik was dropped), credit or pay-per-result billing rather than seat contracts, a defensible GDPR posture, and — decisively — whether it returns **officers/administrators**, since those names are what the contact pipeline turns into emails.

---

## 4. Contact enrichment & verification

### 4.1 The vendors

|                                  | Hunter (live)                                       | FullEnrich                                               | Pipe0                                                                        |
| -------------------------------- | --------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Model                            | single-source DB + pattern                          | waterfall, 20+ providers                                 | composable waterfall, bring-your-own providers                               |
| Coverage (independent, EU-heavy) | ~58%                                                | **~87% — best of 15 tested**, best on hard/rare contacts | unbenchmarked (equals the providers enabled)                                 |
| Cost / found email               | ~2–3¢                                               | ~5–6¢ (pay-on-success)                                   | ~1.5–2.5¢                                                                    |
| Returns                          | email + score, verify status; little phone/LinkedIn | work/personal email + status, mobile, full profile       | email (+opt-in validation), phone, LinkedIn, numeric confidence + provenance |
| Verification                     | score + status (~9% false-positive in test)         | categorical status (~4% false-positive)                  | opt-in / compose your own (built-in ZeroBounce/MillionVerifier steps)        |
| Integration                      | sync REST                                           | **async webhook**, 30–90s/contact, 100/batch             | sync (<10 records) + async poll, 15k/batch, sandbox                          |
| Compliance                       | GDPR/DPA                                            | **SOC 2 Type II (audited)**, EU-hosted, SCCs             | German entity, GDPR jurisdiction, **no audit found**                         |

### 4.2 Recommendation: FullEnrich as Hunter's fallback

FullEnrich is the single most defensible addition: the best independently-measured coverage in Western Europe (and best on the hardest-to-find contacts), and audited SOC 2 + EU hosting that fit Batuda's compliance posture. It is a 20+-provider waterfall in its own right (Hunter is one of its sources), so it catches what Hunter misses. Pipe0 is cheaper and more flexible (per-region provider tuning, bring-your-own keys) but is a small vendor with no audited compliance — hold it until its DPA gap is closed, and only for cost-sensitive, high-volume, non-regulated runs.

Two integration facts change how FullEnrich is wired:

- **The current fallback fires on error, not on a miss.** The provider fallback cascades to the next vendor only on a `ProviderError`; a Hunter result of "found nobody" is an empty success, so it does not cascade. For search that is correct — a genuine zero-result search should not triple its cost across providers. For an enrichment *waterfall* it is the opposite of what is wanted: the whole point is to try the next provider when the first finds nothing. So enrichment needs **miss-fallback**, cleanly expressed by chaining the providers in the contact-discovery orchestration (which already sequences registry → enrichment) rather than by changing the shared search fallback.
- **FullEnrich is async.** It returns results by webhook or poll, 30–90 seconds per contact, whereas the enrichment port returns synchronously inside the run fiber. Research fibers are long-lived and heartbeated, so in-fiber polling is tolerable, but the adapter is heavier than Hunter's single synchronous call. Pipe0's sync endpoint maps more directly but caps at ten records.

### 4.3 Email verification: no new vendor at research time

Independent testing says no finder is safe to send from unchecked — Hunter showed ~9% and FullEnrich ~4% false positives, both above the ~2% cold-email-safe line, and roughly a third of B2B domains are catch-all, which ordinary verification cannot confirm. A final deliverability pass is therefore still worth having for cold outreach. But Batuda already has that pass at discovery time (MX gate → Hunter verify → assert-only-if-confirmed, with catch-all a distinct verdict), so a separate ZeroBounce contract is redundant here. Two moves use what is built:

- **Tighten the assert threshold.** A guessed address is currently asserted on a `deliverable` *or* `risky` verdict; dropping `risky` (assert deliverable-only) is exactly the "deliverable-only" filter the research recommends — a one-line change, no vendor.
- **Verify at send time, not research time.** Deliverability matters right before the send, which is a CRM-pipeline step. If the eval shows Hunter's verifier is the weak link, add ZeroBounce there as a second `EmailVerifier` slot (its EU endpoint for data residency), gated on measured bounce rate.

---

## 5. Company registries & firmographic identity

### 5.1 The three shapes of officer data

Worldwide officer data comes in three shapes, and Batuda already has a seam for each: a live registry (`RegistryRouter`) — free like Companies House, or cheaply metered like libreBORME (~€0.29/lookup) — a paid per-company report (`ReportRouter`, budget-gated), and — where neither exists — the enrichment fallback. Populating those seams, not new architecture, is the whole task.

### 5.2 The coverage map

| Market            | Best self-serve officer source                                  | Seam                     | Cost                  | Status                                 |
| ----------------- | --------------------------------------------------------------- | ------------------------ | --------------------- | -------------------------------------- |
| 🇪🇸 Spain          | libreBORME                                                      | registry (metered)       | ~€0.29/lookup         | live                                   |
| 🇬🇧 United Kingdom | Companies House                                                 | free registry            | free                  | live                                   |
| 🇨🇴 Colombia       | `datos.gov.co` dataset `c82u-588k` (RUES)                       | free registry            | free                  | clean — build first                    |
| 🇺🇸 United States  | Cobalt Intelligence (51 states, live from Secretaries of State) | registry                 | ~$300–500/mo          | clean (per-state officer depth varies) |
| 🇲🇽 Mexico         | Dato Capital "Director Report"                                  | paid report              | ~$54/report           | self-serve, paid                       |
| 🇦🇷 Argentina      | IGJ open data (`datos.jus.gob.ar`)                              | registry                 | free                  | CABA-only + monthly-ZIP self-host      |
| 🇳🇱 Netherlands    | Zephira (or KVK Uittreksel PDF)                                 | aggregator / paid report | agg or ~€2.65/company | no native officer API                  |
| 🇸🇬 Singapore      | Zephira (or ACRA Business Profile PDF)                          | aggregator / paid report | agg or S$5.50/company | native API foreign-gated               |
| 🇦🇺 Australia      | Zephira (or ASIC extract PDF)                                   | aggregator / paid report | agg or A$10/company   | no native officer API                  |
| 🇵🇾 Paraguay       | — none —                                                        | enrichment fallback      | enrichment            | registry dead-end                      |
| 🌐 rest of world  | —                                                               | enrichment fallback      | —                     | default                                |

Colombia, Argentina, and Mexico are the Verifik alternatives specifically requested. Colombia is the clean replacement — free, no-auth, returns the legal representative (`representante_legal`) by NIT or by name. Two notes on it: the data is a monthly snapshot (not real-time), and it exposes the person's cédula — under Colombia's Ley 1581 (Habeas Data) the adapter should return the name only and drop the ID. Argentina's complete officer corpus is a monthly bulk ZIP (its live API is capped to a 1,000-row, CABA-only sample), so a real adapter is a self-hosted lookup table, not a passthrough — a different shape than the two live registries. Mexico's Dato Capital is a paid per-company report, so it belongs on `ReportRouter` (gated exactly as einforma was designed to be), not the free registry seam. Paraguay has no self-serve officer source, so its contact discovery correctly falls through to enrichment — which is why FullEnrich matters most exactly where registries cannot help.

### 5.3 One aggregator vs many adapters

Netherlands, Singapore, and Australia have no self-serve officer API — the alternatives are brittle per-company PDF parsers (KVK / ACRA / ASIC) or a single global aggregator. **Zephira** is the lever: self-serve (Stripe checkout, free test searches), returns directors across 150+ countries, $99–499/mo — one `RegistryRouter` adapter covering NL/SG/AU/US (and Colombia as redundancy) instead of three fragile integrations. It is newer and unproven, so validate per-country officer depth on its free trial before committing. OpenCorporates is ruled out (£2,250+/yr and zero officers for SG/AU/LATAM); GLEIF is free but entity/ownership-hierarchy only, useful for company identity but not for contacts.

The `RegistryRouter` vendor table already supports a per-country fallback chain, so a country can be configured free-official-first, aggregator-second (for example `[datos-gov, zephira]` for Colombia). That only works if a registry *miss* raises `ProviderError` rather than returning an empty record — the same miss-vs-error decision noted for enrichment (§4.2). Settle it once for both registry and enrichment: is "company not found" an error that cascades, or an empty success that stops?

Note: the Netherlands / Singapore / United States / Australia rows were verified from each provider's own documentation, not from live API calls (only Colombia and Argentina were call-verified). Treat the depth claims as directional and pilot before wiring.

---

## 6. Candidate search (People Data Labs) — deferred

People Data Labs offers the one genuinely new capability — a structured boolean search over a person/company dataset to *generate* a candidate list ("operations managers at agribusiness companies in Paraguay"), where Batuda's prospect discovery today is web-search-based. But it is the weakest fit for the actual markets: PDL is US-centric with poor coverage of Spanish SMBs and cooperatives and thin LATAM data, by both the original survey's own note and the vendor research. If prospect discovery is missing leads, the cheaper fix is improving the web-search discovery scan, not buying a US-centric dataset. Revisit only if a large built-in candidate database becomes a real need.

---

## 7. The decision instrument — a contact-finding eval

The vendor spend decisions in §4 and §5 (does FullEnrich earn its 5–6¢? does Zephira's depth hold per country?) should rest on Batuda's own numbers, not vendor benchmarks — especially since Singapore, Australia, and most of LATAM are unbenchmarked. The existing research eval harness already does this for enrichment fields (grounding, field precision/recall, wrong-company and empty rates, against a Latitude-backed golden set). Mirror it for contact-finding, as parallel `eval-contact-{golden,scoring,outcome}` pure modules and a `pnpm cli research eval-contacts` entry.

- **Golden set** — rows of `{ company name + domain + country, known decision-makers: [{ name, role, verified email }] }`.
- **Run** — drive `discover_contacts(company, domain, country)` and score the ranked contacts.
- **Metrics** — contact recall (known decision-makers found by name); email deliverability precision (asserted-deliverable emails that actually are — the direct measure of the 4%/9% false-positive risk); decision-maker precision; empty rate; and **cost per verified contact** (paid spend ÷ verified found), the number that settles the vendor question.
- **How it decides** — run the same golden set under `ENRICH=hunter`, `hunter+fullenrich (miss-fallback)`, and `+pipe0`, per region, and read the recall lift against the cost delta. Do the same for `RegistryRouter` with and without Zephira per country.

The main cost is curation — real known-good contacts per region. A small high-quality set beats a large noisy one; the harness already fails loudly on a malformed golden row, because a wrong "correct answer" silently poisons every number.

---

## 8. Recommended build order

Uses only existing seams; ordered by value and cost.

1. **Colombia** — free `RegistryRouter` adapter (drop the cédula). The direct Verifik replacement, cheapest possible.
2. **United States** — Cobalt Intelligence, the only clean self-serve US officer API.
3. **FullEnrich** — as Hunter's *miss*-fallback in contact-discovery (implement miss-fallback first). Carries Paraguay and every officer-less market.
4. **Contact-finding eval** — build alongside 3; it gates the spend decisions in 3, 5, and 6.
5. **Zephira pilot** — free trial to validate NL/SG/AU officer depth; if it holds, one adapter covers all three.
6. **Mexico** — Dato Capital on the paid `ReportRouter` seam, when MX demand justifies the per-report cost.

Pipe0, PDL, and a standalone send-time verifier stay deferred until the eval or measured bounce rates justify them.

---

## 9. Open questions & caveats

- **Miss-vs-error semantics** — decide once whether a registry/enrichment "not found" raises `ProviderError` (cascades to the next provider) or returns empty (stops). Both the enrichment waterfall and the per-country registry fallback depend on it.
- **Provider depth is unproven off-benchmark** — every hit-rate is vendor-sponsored; NL/SG/US/AU registry findings are doc-verified, not call-verified; SG/AU/LATAM enrichment coverage is unmeasured. The eval (§7) is how these become real numbers.
- **Compliance** — Colombia Ley 1581 (store the officer name, not the cédula); FullEnrich's non-EU sub-processors ride SCCs; Pipe0 has no published audit — get a signed DPA before any regulated use.
- **Phone data is weak everywhere** — roughly a quarter of B2B mobiles are high-confidence globally; treat phone as best-effort across all vendors.

---

## 10. Service reference

Concrete access details for every service evaluated — base endpoint, auth, pricing, and what it returns — so an adapter can be built without re-researching. Endpoints and pricing drift; confirm against the vendor's live docs at integration time. The **Verified** column records how each row was checked: **call** = a live API call succeeded, **docs** = read from the provider's own documentation, **prod** = already running in Batuda, **est.** = second-hand or estimated.

### 10.1 Company registries & identity (`RegistryRouter` / `ReportRouter`)

| Service                 | Scope          | Base endpoint                                                      | Auth                                     | Pricing                                          | Self-serve                 | Officers?                                                                     | Verified |
| ----------------------- | -------------- | ------------------------------------------------------------------ | ---------------------------------------- | ------------------------------------------------ | -------------------------- | ----------------------------------------------------------------------------- | -------- |
| **libreBORME**          | ES             | `librebor.me` (BORME API)                                          | API key                                  | ~€0.29/lookup                                    | yes                        | yes (administradores)                                                         | prod     |
| **Companies House**     | GB             | `api.company-information.service.gov.uk` → `/company/{n}/officers` | API key (HTTP basic)                     | free                                             | yes                        | yes                                                                           | prod     |
| **datos.gov.co** (RUES) | CO             | `www.datos.gov.co/resource/c82u-588k.json?nit={NIT}`               | none (optional Socrata app token)        | free                                             | yes                        | yes (`representante_legal` + cédula)                                          | call     |
| **Cobalt Intelligence** | US (51 states) | `api.cobaltintelligence.com`                                       | API key                                  | credit-based, ~$300–500/mo effective             | yes (free trial, no sales) | yes (officers + registered agent; per-state depth varies)                     | docs     |
| **Dato Capital**        | MX             | `api.datocapital.com` → `GET /v3/companies?q={name}&country=MX`    | Bearer                                   | ~$45–54/report (free-acct); plans €500/€3,500/mo | yes ("Sign Up Free")       | yes — "Director Report" returns names + titles                                | docs     |
| **IGJ open data**       | AR (CABA only) | `datos.jus.gob.ar` (Entidades + Autoridades)                       | none                                     | free                                             | yes                        | yes (`apellido_nombre`, `tipo_administrador`, DNI); full corpus = monthly ZIP | call     |
| **KVK**                 | NL             | `api.kvk.nl`                                                       | API key + eHerkenning + signed agreement | €6.40/mo + €0.02/call                            | **no** (approval-gated)    | no in JSON API; officers only via paid Uittreksel PDF (~€2.65)                | docs     |
| **ACRA / BizFile**      | SG             | `bizfile.gov.sg/apimarketplace`                                    | subscription key (Corppass)              | ~S$5.50/Business Profile                         | **no** (foreign-gated)     | yes via Marketplace; no in free `data.gov.sg`                                 | docs     |
| **ABR / ASIC**          | AU             | `abr.business.gov.au/abrxmlsearch` (ABN Lookup)                    | GUID (free)                              | ABN free; ASIC extract A$10–20                   | ABN yes, ASIC-API no       | ABN no; officers only via paid ASIC extract PDF                               | docs     |
| **TuRuc**               | PY             | `turuc.com.py/api`                                                 | none                                     | free                                             | yes                        | **no** (name/status only)                                                     | docs     |

### 10.2 Global aggregators & KYB (multi-country `RegistryRouter` fallback)

| Service             | Base endpoint                                                     | Auth                                | Pricing                                      | Self-serve                             | Officers?                                   | Verdict                                                         |
| ------------------- | ----------------------------------------------------------------- | ----------------------------------- | -------------------------------------------- | -------------------------------------- | ------------------------------------------- | --------------------------------------------------------------- |
| **Zephira**         | `zephira.ai/api` (KYB REST)                                       | API key                             | $99 / $199 / $499 per mo (200 / 600 / 3,000) | yes (Stripe, 3 free searches)          | yes (directors + UBO, 150+ countries)       | **primary fallback candidate for NL/SG/AU** — validate on trial |
| **Global Database** | `globaldatabase.com` (API)                                        | API key                             | from ~$19/report, 195 countries              | yes (credit-based)                     | yes (+ UBO)                                 | self-serve alternative to Zephira; less-verified                |
| **Sumsub**          | Sumsub KYB API                                                    | API token                           | $149/mo min + ~$1.35/verification            | yes-ish (14-day/50-check trial)        | yes (directors/reps/UBOs; AR/CO/MX, not PY) | pilot; confirm KYB is in the self-serve tier                    |
| **GLEIF LEI**       | `api.gleif.org/api/v1`                                            | none                                | free                                         | yes                                    | **no** (legal name/status + parent/child)   | free identity + ownership-hierarchy layer (not contacts)        |
| **OpenCorporates**  | `api.opencorporates.com/v0.4`                                     | `?api_token=`                       | £2,250 / £6,600 / £12,000 per **year**       | self-serve tier is "internal use" only | partial (0 for SG/AU & all 4 LATAM)         | **ruled out** — pricey + officer-patchy                         |
| **Verifik**         | `api.verifik.co/v2/{country}/company` (needs `POST /v2/projects`) | Bearer **or** `jwt` (docs disagree) | ~$0.20/query est. (unpublished)              | **no** (sales-gated)                   | yes (PY/AR/CO; MX thin)                     | **ruled out** — the gated signup that prompted this doc         |

### 10.3 Contact enrichment (`EnrichmentProvider`)

| Service           | Base endpoint                                                                         | Auth            | Pricing                                                                           | Self-serve | Returns                                                              | Compliance                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------- | --------------- | --------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **Hunter** (live) | `api.hunter.io/v2/domain-search`, `/email-finder`                                     | `api_key` param | ~$0.01–0.03/lookup; free 50/mo                                                    | yes        | people: email + score, seniority, LinkedIn, phone                    | GDPR/DPA — **prod**                                                                               |
| **FullEnrich**    | `api.fullenrich.com` → `POST /api/v2/contact/enrich/bulk` (async webhook, HMAC-SHA1)  | Bearer          | per found item: work email 1cr, personal 3, mobile 10 (~$0.05–0.06/cr); free 50cr | yes        | work/personal email + status, mobile, full profile                   | **SOC 2 Type II**, EU-hosted; OpenAPI published                                                   |
| **Pipe0**         | `api.pipe0.com` → `POST /v1/pipes/run/sync` (<10) or `/run` + `GET /pipes/check/{id}` | Bearer          | ~$0.029/cr; work-email waterfall from 0.25cr/found; free 20cr + sandbox           | yes        | email (+opt-in validation), phone, LinkedIn, confidence + provenance | German UG; **no audit**; built-in ZeroBounce/MillionVerifier pipes                                |
| **Findymail**     | `POST /api/search/name` (find), `POST /api/verify`                                    | Bearer          | $49/mo → 1,000 credits                                                            | yes        | finds + verifies email                                               | EU-hosted (FI), SOC 2 T2 — *already inside FullEnrich's waterfall, so not a separate integration* |

### 10.4 Email verification (`EmailVerifier`)

| Service           | Base endpoint                                                         | Auth            | Pricing                                 | Notes                                                                              |
| ----------------- | --------------------------------------------------------------------- | --------------- | --------------------------------------- | ---------------------------------------------------------------------------------- |
| **Hunter** (live) | `api.hunter.io/v2/email-verifier`                                     | `api_key` param | bundled with Hunter plan                | SMTP status + score + catch-all/MX flags — **prod**                                |
| **ZeroBounce**    | `api-eu.zerobounce.net/v2/validate` (EU-pinned; separate US endpoint) | `api_key` query | ~$0.01/email                            | GDPR/CCPA/HIPAA/SOC 2/ISO — broadest cert stack; EU endpoint for data residency    |
| **Bouncer**       | `GET /v1.1/email/verify`                                              | `x-api-key`     | credit-based, 100 free → ~$250/mo @ 50k | richest single response (toxicity, role/free/disposable, catch-all, DNS, provider) |

### 10.5 Candidate search — deferred

| Service              | Base endpoint                                                                      | Auth                           | Pricing                                                                              | Notes                                                                             |
| -------------------- | ---------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| **People Data Labs** | `/v5/person/search` (SQL-like), `/v5/person/enrich`, `/v5/company/{search,enrich}` | `X-Api-Key` or `api_key` param | ~$0.20–0.28/match (self-serve; reseller quotes $0.05); charged on match, free on 404 | ~3B persons / ~71M companies; **deferred** — US-centric, weak for ES SMBs + LATAM |

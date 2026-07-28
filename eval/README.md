# Research eval

Measure the research pipeline's quality against a fixed set of companies whose correct answer you already know (the "golden set"), so a change to grounding or extraction can be proven with a number instead of guessed.

This is a developer/CI tool. It never runs in production — it drives the same research pipeline the server runs, but from the CLI, on demand.

## Run it

```bash
# Which candidate models support the two features the tiers need (tool-calling + strict JSON schema)?
pnpm cli research probe --api-key <nebius-key>

# Score the golden set. Needs the research env configured (LLM + provider keys, DATABASE_URL) and an org/user to run as.
pnpm cli research eval --org <org-id> --user <user-id> --golden eval/golden.json --out report.json
```

`eval` prints the metrics — grounding accuracy, field precision, field recall, titled-contact recall, profile fullness, wrong-company rate, needs-review rate, empty rate — and writes a full per-run report with `--out`.

Add `--by-bucket` to also print those metrics broken out by the golden rows' size/reach `bucket` (big / small / niche) and by `country`, so a regression that only hits, say, niche companies or one country is visible instead of averaged into the whole-set numbers. The same per-bucket and per-country summaries are always written to the `--out` report as `byBucket` / `byCountry`, and each run's span carries `eval.bucket` / `eval.country` for grouping on the monitoring board.

Titled-contact recall answers a gap the four scalar fields miss: of the people a company is known to publish, how many the run returned **with a title**. Contacts sit outside the scored field set, so a run can pass every field yet hand back the decision-makers with no title — the exact symptom this metric watches. It only appears (else `n/a`) for rows that list expected `contacts`.

The scored fields are four of the profile's six, and the golden set has a right answer for even fewer. A run that returns those four and nothing else scores full marks, which is the opposite of what a rich profile means. Three counts sit beside them for that reason: **profile fields filled** (out of the shape's own total), **people named per run**, and **of those, titled**. They need no golden data — they are counted off what came back — and they are the numbers to watch when a change is meant to make a profile fuller rather than more correct.

Read them against the guard stages on the monitoring board, below. Fields filled rising while the guards drop no more than before is a real gain; fields filled and guard drops rising together is padding.

**Wrong and unwatched** counts the look-alike runs that finished clean — the most that could ever reach a record without a person seeing it. Read it as an upper bound, not as what would actually happen: writing anything unwatched also needs the organisation to have switched that on, the value to be a way of reaching somebody rather than a judgement like an industry, and that address to have come back reachable. None of those is visible from a golden set, so the real number is far lower and is usually zero. What the figure is good for is direction — it must never climb.

**Needs-review rate** is the share of runs that finished flagged for somebody to read, and it is the counterweight to the line above. A change can push "wrong and unwatched" down simply by flagging more runs, which buys the number with a person's time rather than with better research — so the two are only good news when they fall together.

## Reading a change that targets under-filling

A change meant to fix a near-empty profile or titleless contacts is judged by three numbers moving together, against two that must not. **Field recall** and **titled-contact recall** rise and the **empty rate** falls — more of the known answer came back — while **field precision** does not fall more than a few points and the **wrong-company rate** does not rise at all, so the extra fields are real rather than invented.

**Grounding accuracy is the control**: extraction reads pages the fetch log already recorded, so grounding cannot legitimately move; if it does, the before and after reached different evidence and the comparison is void — rerun before trusting any other number. One limit worth knowing: grounding counts the source rows a run recorded, not whether a page's text was stored, so it cannot tell a page that was opened from one a search merely quoted. It controls for a prompt or trigger change; it cannot control for a change to the shape of the evidence itself.

A single run is noise, so always take three — but take them as three separate `--runs 1` passes with the caches cleared between (`DELETE FROM search_cache; DELETE FROM llm_cache;`). Repeats inside one invocation are answered from those caches: they cost nothing, return the first run's answer, and so average away no noise at all.

Whether a recovery pass earned its cost — as opposed to the up-front extraction prompt carrying the whole lift — is read from the monitoring board, not the printed table. Each run's `research.phase2` span carries the profile's fill at three stages: `research.enrichment.filled_broad` (fields the model returned on its own), `research.enrichment.filled_rescued` (after the focused recovery passes), and `research.enrichment.filled_kept` (what survived the guards), against `research.enrichment.fields_total`. A `filled_broad` near zero means the model answered almost nothing, which only the extraction prompt can move — a recovery pass cannot recover what was never there. A rise from `filled_broad` to `filled_rescued` is the recovery passes earning their spend; a drop from `filled_rescued` to `filled_kept` is the guards removing what a pass recovered. Charting the three across a prompt or trigger change shows which stage a number actually moved at, so a flat overall result is not mistaken for "nothing worked" when a pass recovered fields a guard then dropped.

## Providing keys

The rest of Batuda runs on **stub providers with no secrets** — a fork can clone, `pnpm cli setup`, and develop without any keys. Only these two commands need real ones: `probe` needs a Nebius key; `eval` needs the three LLM tiers plus a search / scrape / registry provider.

**Forking or contributing** — put your own keys in `.env` and switch the providers on. `.env.example` documents every variable (see its commented "real providers" block): set `RESEARCH_LLM_<TIER>_PROVIDERS=custom` with `_BASE_URL` + `_MODEL` + `_API_KEY`, plus `RESEARCH_PROVIDER_SCRAPE=firecrawl` (`RESEARCH_API_KEY_SCRAPE`), a search provider, and `RESEARCH_PROVIDER_REGISTRY_ES=librebor` for Spanish companies. The rest of the app keeps working on stubs.

**Maintainers (Infisical)** — keys live in Infisical, so run through it. Put **only API-key secrets** in the environment you run with — never `DATABASE_URL` or `STORAGE_*`. Those are per-worktree local and must come from the worktree's own `.env`: the CLI's loader treats anything Infisical injects as authoritative and lets it outrank every file it reads (`apps/cli/src/lib/load-env.ts`), so a `DATABASE_URL` in Infisical would clobber the worktree's isolated database. Always name the environment explicitly with `--env=`; `.infisical.json` sets `defaultEnvironment` to `dev`, but relying on that default means one edit to a shared file silently repoints every unqualified run. With infra kept out of the Infisical env, a worktree run composes cleanly:

```bash
infisical run --env=<dev-env> -- pnpm cli research eval --org <org-id> --user <user-id> --golden eval/golden.json --out report.json
```

If an environment already carries a `DATABASE_URL`, pin it back to local with a leading `env DATABASE_URL="postgresql://batuda:batuda@localhost:5433/<local-db>"` before `pnpm`.

**Routing, not just keys.** The keys alone don't run anything — the pipeline also needs the *routing*: `RESEARCH_LLM_<TIER>_PROVIDERS` + `_MODEL` for each of the three tiers, and the `RESEARCH_PROVIDER_SEARCH` / `_SCRAPE` / `_REGISTRY_GB` selectors. If those are missing from the run environment every provider silently falls back to `stub` and the eval reports a 100% empty rate over canned data — the keys being present is not enough. Unlike `DATABASE_URL`/`STORAGE_*`, this routing is **not secret** and is the *same* across worktrees, so it belongs in the Infisical env right next to the keys (never pass a key inline on the command; a provider name or model id is fine to pass inline, a key is not). Named vendors (`groq`, `fireworks`, `nebius`) carry their own endpoint, so a tier needs only its `PROVIDERS` name + `MODEL`; only a `custom` vendor also needs `_BASE_URL`.

**Match prod's cascade when you measure.** Run each tier as the two-slot `custom,<fallback>` cascade production uses (`apps/server/config.production.json`: `custom,groq` for agent + writer, `custom,fireworks` for extract), not a single slot. A single-slot eval never exercises the fallback, so a transient primary 4xx under load fails the run outright — that is what depressed a prior concurrency-3 pass by ~20 points on titled-contact recall, a load artifact rather than a quality change. Keep eval concurrency at 1 regardless, so a measured delta is quality, not contention.

**Storage is local too.** Like the database, `STORAGE_*` must resolve to the worktree's own bucket (provisioned by `pnpm cli worktree up`), never the cloud one — a run has no business writing its scrape cache to prod. The dev Infisical env carries no `STORAGE_*`, so those come from the worktree automatically.

**`DATABASE_URL` is the one you must pin by hand.** The dev Infisical env *does* carry it, and anything the caller exports outranks every `.env` file (`apps/cli/src/lib/load-env.ts`), so the worktree's own value cannot win. Put it in front of the command yourself:

```bash
infisical run --env=dev -- env DATABASE_URL="postgresql://batuda:batuda@localhost:5433/<worktree-db>" pnpm cli research eval …
```

The eval refuses to start against a database that is not on this machine, so a forgotten pin stops the run rather than filling a shared database with a pass's runs, sources and cached answers — several of which point at page text held only in that process's memory, which the server would later fail to read and pay to fetch again.

**Validate one company before the billable pass.** The full set is ~$10–15 and a few hours of live scraping and LLM calls, so first run a one-row golden with `--runs 1` (a few cents). A wrong vendor/model, an expired key, or a network-blocked provider fails in seconds and shows up as a 100% empty rate — the cheap early signal that the routing is wrong before you spend on all 20 companies.

## The golden file

A JSON array of rows. Copy `golden.example.json` to your own `golden.json` and replace every row with a real, **verified** company — a wrong "correct answer" silently poisons every number the harness reports, so never invent field values.

```json
{
  "id": "short-stable-id",
  "query": "Company Name, City",
  "expectedOutput": {
    "officialDomain": "company.com",
    "altDomains": ["a-registry-profile.example"],
    "bucket": "small",
    "fields": { "industry": "…", "size_range": "…", "country": "…", "location": "…" },
    "contacts": ["Ada Lovelace", { "name": "Alan Turing" }]
  }
}
```

- `query` — what the pipeline is asked to research (add the city for a generic name).
- `officialDomain` — the company's own website host; the primary proof the run reached the target. **Required.**
- `altDomains` — other hosts that also prove the target was reached (a registry profile, a known subsidiary). Optional.
- `bucket` — the company's size/reach segment: `big` (a household name, easy to research), `small` (an SMB with a light web presence), or `niche` (a specialist with little third-party coverage, the hardest). Optional, but an unknown value is rejected loudly; drives the `--by-bucket` breakdown so a regression that hits only one segment is not averaged away.
- `fields` — the known-correct values. Only these four keys are scored, and a misspelled key is rejected loudly. All optional — score only the fields you can verify.
- `contacts` — people the company is known to publish, each a name string or a `{ "name": "…" }` object. They score titled-contact recall: how many came back with a title. Name matching folds accents and tolerates a middle name/initial, but it tokenizes on Latin letters — a name written only in a non-Latin script (CJK, Cyrillic, Greek, Arabic) won't match, so romanize it in the golden row. Optional; a fabricated name skews the metric exactly as a wrong field value does, so list only real, verifiable people. No `role` here — the metric checks that the run supplied *some* title, not which one.

### Allowed field values

Match the CRM's own vocabulary, or the value can never match what the pipeline extracts:

- `industry` — `restaurants` · `construction` · `retail` · `manufacturing` · `services` · `hospitality` · `distribution` · `transport` · `other`
- `size_range` — `1-5` · `6-10` · `11-25` · `26-50` · `51-200`
- `country` — ISO 3166-1 alpha-2 code (e.g. `GB` · `ES` · `US`)
- `location` — free text (matched by containment, so formatting differences are tolerated)

## Two kinds of row to include

- **Clean companies** — a company with its fields filled in (`country`, `location`, `industry`, and `size_range` where known). These score field precision and recall.
- **Generic / look-alike names** — a company whose name is common (many "Sunset Logistics" exist). Give the `query` a city and the real `officialDomain`; leave a field unset if you can't verify it. These catch the pipeline confidently returning a same-named *different* company (the wrong-company rate).

## Registries: UK is free, ES is paid

The `RegistryRouter` picks a registry by the company's country. **Companies House (UK)** is free — register a key at `developer.company-information.service.gov.uk` and set `RESEARCH_PROVIDER_REGISTRY_GB=companies-house`. **libreBORME (ES)** is ~€0.29/lookup — set `RESEARCH_PROVIDER_REGISTRY_ES=librebor` with `RESEARCH_API_KEY_REGISTRY_ES` (an `AccessId:AccessKey` pair).

**For a pass measuring quality, turn both off** — `RESEARCH_PROVIDER_REGISTRY_ES=none` and `RESEARCH_PROVIDER_REGISTRY_GB=none`. A registry returns a company's directors, who are named people with titles, so leaving it on feeds the contact numbers from a source the change under test has nothing to do with. It also costs money and does not fire on every pass, which makes two passes differ for a reason that is not the change.

Know what turning them off costs: a registry lookup that resolves the target by its legal name counts toward grounding, and for a small business with a thin web presence that is often the only proof the run reached the right legal entity. So keep one registries-on pass as the figure that represents production, and read the registries-off passes as the comparison between two versions of the code.

## Note

`golden.example.json` ships a mix of real, verified companies: UK ones (whose register, Companies House, is free) that exercise grounding and the wrong-company rate, and Spanish small businesses (whose register, libreBORME, is paid) that exercise `country` (`ES`) and `size_range` against a thin web presence. Replace them with your own targets in any country; for UK companies the pipeline extracts English industry terms, so `industry` precision there mostly measures the vocabulary gap, not grounding.

## Charting runs on the monitoring board

Each run's scores are also exported to the monitoring board (Honeycomb) as spans when `OTEL_EXPORTER_OTLP_ENDPOINT` (+ `OTEL_EXPORTER_OTLP_HEADERS` with `x-honeycomb-dataset`) is set — one span per run plus a batch-summary span, tagged with the agent/extract model, so you can chart grounding accuracy, field precision/recall, and the empty rate drifting across model and prompt changes instead of eyeballing two terminal outputs. Without those env vars the eval still prints its table and writes `--out`, just with no export.

## Contact-finding eval

A parallel harness for the other half of the pipeline: `discover_contacts` (a company → ranked, verified decision-maker contacts). It answers the vendor question the [lead-sourcing strategy](../docs/drafts/lead-reach-apis.md) leaves open — does adding **FullEnrich** as Hunter's miss-fallback (and running it in `union` mode) earn its ~5–6¢/lookup — on Batuda's own numbers rather than the vendor's.

```bash
# Score the same set under each enrich config and read the recall lift against the cost delta.
pnpm cli research eval-contacts --org <org-id> --user <user-id> --golden eval/golden-contacts.json --enrich hunter
pnpm cli research eval-contacts --org <org-id> --user <user-id> --golden eval/golden-contacts.json --enrich hunter,fullenrich --enrich-mode fallback
pnpm cli research eval-contacts --org <org-id> --user <user-id> --golden eval/golden-contacts.json --enrich hunter,fullenrich --enrich-mode union
```

It prints **contact recall**, **decision-maker recall**, **email precision**, **empty rate**, and **cost per verified contact**, and writes a full per-run report with `--out`. `--enrich` / `--enrich-mode` override `RESEARCH_PROVIDER_ENRICH` / `RESEARCH_ENRICH_MODE` for the run, so one golden set scores every config; leave them off to use the env.

### The contact golden file

A JSON array of companies with their known decision-makers. Copy `golden-contacts.example.json` to your own `golden-contacts.json` and replace every row with real, verified people — a fabricated "known contact" silently poisons recall and precision exactly as a wrong field value does.

```json
{
  "id": "short-stable-id",
  "companyName": "Company Name",
  "domain": "company.com",
  "country": "ES",
  "expectedContacts": [{ "name": "Ada Lovelace", "role": "CEO", "email": "ada@company.com" }]
}
```

- `domain` — the company domain `discover_contacts` searches on. **Required.**
- `expectedContacts` — the known decision-makers. Each needs a `name` (recall matches on it, accent- and middle-name-tolerant); `role` marks decision-makers (scored by decision-maker recall); `email` is the verified sendable address (scored by email precision). **Email is optional** — a name-only row is a valid recall target, and email precision is judged only over rows that carry a verified address.

The shipped example seeds real, durably-public founders/leaders (UK, Spain, LATAM) as name-only recall targets. Two curation steps make the numbers decision-grade: **add verified emails** (so email precision means something), and — since FullEnrich matters most exactly where registries and Hunter come up empty — **add real LATAM SMBs** (Paraguay and the officer-less long tail), the case the FullEnrich spend decision actually turns on. `country` routes the registry (§ *Registries* above), so a Spanish row with the register on confirms officers cheaply.

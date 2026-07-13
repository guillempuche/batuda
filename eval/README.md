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

`eval` prints the metrics — grounding accuracy, field precision, field recall, titled-contact recall, wrong-company rate, empty rate — and writes a full per-run report with `--out`.

Titled-contact recall answers a gap the four scalar fields miss: of the people a company is known to publish, how many the run returned **with a title**. Contacts sit outside the scored field set, so a run can pass every field yet hand back the decision-makers with no title — the exact symptom this metric watches. It only appears (else `n/a`) for rows that list expected `contacts`.

## Providing keys

The rest of Batuda runs on **stub providers with no secrets** — a fork can clone, `pnpm cli setup`, and develop without any keys. Only these two commands need real ones: `probe` needs a Nebius key; `eval` needs the three LLM tiers plus a search / scrape / registry provider.

**Forking or contributing** — put your own keys in `.env` and switch the providers on. `.env.example` documents every variable (see its commented "real providers" block): set `RESEARCH_LLM_<TIER>_PROVIDERS=custom` with `_BASE_URL` + `_MODEL` + `_API_KEY`, plus `RESEARCH_PROVIDER_SCRAPE=firecrawl` (`RESEARCH_API_KEY_SCRAPE`), a search provider, and `RESEARCH_PROVIDER_REGISTRY_ES=librebor` for Spanish companies. The rest of the app keeps working on stubs.

**Maintainers (Infisical)** — keys live in Infisical, so run through it. Put **only API-key secrets** in the environment you run with — never `DATABASE_URL` or `STORAGE_*`. Those are per-worktree local and must come from the worktree's own `.env`: the CLI's loader treats anything Infisical injects as authoritative and skips the matching `.env` line (`apps/cli/src/lib/load-env.ts`), so a `DATABASE_URL` in Infisical would override and clobber the worktree's isolated database — and `.infisical.json` defaults to the **prod** environment, i.e. the prod NeonDB. With infra kept out of the Infisical env, a worktree run composes cleanly:

```bash
infisical run --env=<dev-env> -- pnpm cli research eval --org <org-id> --user <user-id> --golden eval/golden.json --out report.json
```

If an environment already carries a `DATABASE_URL`, pin it back to local with a leading `env DATABASE_URL="postgresql://batuda:batuda@localhost:5433/<local-db>"` before `pnpm`.

## The golden file

A JSON array of rows. Copy `golden.example.json` to your own `golden.json` and replace every row with a real, **verified** company — a wrong "correct answer" silently poisons every number the harness reports, so never invent field values.

```json
{
  "id": "short-stable-id",
  "query": "Company Name, City",
  "expectedOutput": {
    "officialDomain": "company.com",
    "altDomains": ["a-registry-profile.example"],
    "fields": { "industry": "…", "size_range": "…", "country": "…", "location": "…" },
    "contacts": ["Ada Lovelace", { "name": "Alan Turing" }]
  }
}
```

- `query` — what the pipeline is asked to research (add the city for a generic name).
- `officialDomain` — the company's own website host; the primary proof the run reached the target. **Required.**
- `altDomains` — other hosts that also prove the target was reached (a registry profile, a known subsidiary). Optional.
- `fields` — the known-correct values. Only these four keys are scored, and a misspelled key is rejected loudly. All optional — score only the fields you can verify.
- `contacts` — people the company is known to publish, each a name string or a `{ "name": "…" }` object. They score titled-contact recall: how many came back with a title. Name matching folds accents and tolerates a middle name/initial, but it tokenizes on Latin letters — a name written only in a non-Latin script (CJK, Cyrillic, Greek, Arabic) won't match, so romanize it in the golden row. Optional; a fabricated name skews the metric exactly as a wrong field value does, so list only real, verifiable people. No `role` here — the metric checks that the run supplied *some* title, not which one.

### Allowed field values

Match the CRM's own vocabulary, or the value can never match what the pipeline extracts:

- `industry` — `restauració` · `construcció` · `retail` · `manufactura` · `serveis` · `hostaleria` · `distribució` · `transport` · `other`
- `size_range` — `1-5` · `6-10` · `11-25` · `26-50` · `51-200`
- `country` — ISO 3166-1 alpha-2 code (e.g. `GB` · `ES` · `US`)
- `location` — free text (matched by containment, so formatting differences are tolerated)

## Two kinds of row to include

- **Clean companies** — a company with its fields filled in (`country`, `location`, `industry`, and `size_range` where known). These score field precision and recall.
- **Generic / look-alike names** — a company whose name is common (many "Sunset Logistics" exist). Give the `query` a city and the real `officialDomain`; leave a field unset if you can't verify it. These catch the pipeline confidently returning a same-named *different* company (the wrong-company rate).

## Registries: UK is free, ES is paid

The `RegistryRouter` picks a registry by the company's country. **Companies House (UK)** is free — register a key at `developer.company-information.service.gov.uk` and set `RESEARCH_PROVIDER_REGISTRY_GB=companies-house`. **libreBORME (ES)** is ~€0.29/lookup — set `RESEARCH_PROVIDER_REGISTRY_ES=librebor` with `RESEARCH_API_KEY_REGISTRY_ES` (an `AccessId:AccessKey` pair). Turn both on for the Spanish set so the pipeline can confirm each company against its official register.

A registry lookup that resolves the target company by its legal name now counts toward grounding — it proves the run reached the right legal entity even when the company's own site was never scraped, which is common for small businesses with a thin web presence. So running the Spanish set with the registers on makes the "did it reach the company" number trustworthy in a way a keyless run cannot.

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

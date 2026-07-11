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

`eval` prints the five metrics — grounding accuracy, field precision, field recall, wrong-company rate, empty rate — and writes a full per-run report with `--out`.

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
    "fields": { "industry": "…", "size_range": "…", "region": "…", "location": "…", "address": "…" }
  }
}
```

- `query` — what the pipeline is asked to research (add the city for a generic name).
- `officialDomain` — the company's own website host; the primary proof the run reached the target. **Required.**
- `altDomains` — other hosts that also prove the target was reached (a registry profile, a known subsidiary). Optional.
- `fields` — the known-correct values. Only these five keys are scored, and a misspelled key is rejected loudly. All optional — score only the fields you can verify.

### Allowed field values

Match the CRM's own vocabulary, or the value can never match what the pipeline extracts:

- `industry` — `restauració` · `construcció` · `retail` · `manufactura` · `serveis` · `hostaleria` · `distribució` · `transport` · `other`
- `size_range` — `1-5` · `6-10` · `11-25` · `26-50` · `51-200`
- `region` — `cat` · `ara` · `cv`
- `location`, `address` — free text (matched by containment, so formatting differences are tolerated)

## Two kinds of row to include

- **Clean companies** — a company clearly in the CRM's region domain (`cat`/`ara`/`cv`), with the fields filled in. These score field precision and recall.
- **Generic / look-alike names** — a company whose name is common (many "Sunset Logistics" exist). Give the `query` a city and the real `officialDomain`; leave `region` unset if it's outside the domain. These catch the pipeline confidently returning a same-named *different* company (the wrong-company rate).

## Registries: UK is free, ES is paid

The `RegistryRouter` picks a registry by the company's country. **Companies House (UK)** is free — register a key at `developer.company-information.service.gov.uk` and set `RESEARCH_PROVIDER_REGISTRY_GB=companies-house`. **libreBORME (ES)** is ~€0.29/lookup — set `RESEARCH_PROVIDER_REGISTRY_ES=librebor` with `RESEARCH_API_KEY_REGISTRY_ES` (an `AccessId:AccessKey` pair). Turn both on for the Spanish set so the pipeline can confirm each company against its official register.

A registry lookup that resolves the target company by its legal name now counts toward grounding — it proves the run reached the right legal entity even when the company's own site was never scraped, which is common for small businesses with a thin web presence. So running the Spanish set with the registers on makes the "did it reach the company" number trustworthy in a way a keyless run cannot.

## Note

`golden.example.json` ships a mix of real, verified companies: UK ones (whose register, Companies House, is free) that exercise grounding and the wrong-company rate, and Catalan/Spanish small businesses that exercise `region` and `size_range` — the two fields that are Spain-SMB-only in the CRM (region codes `cat`/`ara`/`cv`, size brackets up to `51-200`). Replace them with your own targets; for UK companies the pipeline extracts English industry terms, so `industry` precision there mostly measures the vocabulary gap, not grounding.

## Charting runs on the monitoring board

Each run's scores are also exported to the monitoring board (Honeycomb) as spans when `OTEL_EXPORTER_OTLP_ENDPOINT` (+ `OTEL_EXPORTER_OTLP_HEADERS` with `x-honeycomb-dataset`) is set — one span per run plus a batch-summary span, tagged with the agent/extract model, so you can chart grounding accuracy, field precision/recall, and the empty rate drifting across model and prompt changes instead of eyeballing two terminal outputs. Without those env vars the eval still prints its table and writes `--out`, just with no export.

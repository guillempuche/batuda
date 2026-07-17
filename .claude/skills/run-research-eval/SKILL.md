---
name: run-research-eval
description: Run the research quality eval (packages/research golden set) against the live pipeline and read the numbers. Use when asked to "run the eval", benchmark research grounding/recall, or take a before/after on a research change. Encodes the routing, cost, and safety guardrails so a run is not misconfigured.
---

# Run the research eval

Drives every company in a golden-set JSON file through the **live** research pipeline (real scraping + LLM calls) and reports grounding accuracy, field precision/recall, titled-contact recall, wrong-company rate, and empty rate. It is a billable, multi-hour, developer/CI tool — never a production path.

Full reference: `eval/README.md`. This skill is the run procedure and the guardrails.

## Before you touch a command

1. **This spends real money and hours.** One pass of the shipped golden set (~20 companies × `--runs 3`) is roughly **$10–15** and **1–2.5h** of live API calls, billed to the org's Firecrawl/LLM accounts. Confirm the user actually wants to spend it, and confirm **scope**: the current branch only ("after"), or a before/after pair against `main` too (doubles it).
2. **Worktree must be up:** `pnpm cli worktree up` (own DB + bucket), `pnpm cli worktree doctor` to confirm Postgres is reachable.
3. **Org/user** are seeded with generated ids — resolve them from the local DB, don't hard-code:
   ```bash
   psql "postgresql://batuda:batuda@localhost:5433/<worktree-db>" -tAc "SELECT id FROM organization WHERE slug='taller';"
   psql "postgresql://batuda:batuda@localhost:5433/<worktree-db>" -tAc "SELECT id FROM \"user\" WHERE email='admin@taller.cat';"
   ```

## The one rule that trips every run: routing ≠ keys

The keys being present does **not** mean the eval will run. The pipeline also needs the **routing** — `RESEARCH_LLM_{AGENT,EXTRACT,WRITER}_PROVIDERS` + `_MODEL`, and `RESEARCH_PROVIDER_{SEARCH,SCRAPE,REGISTRY_GB}`. If any are missing from the run environment, that provider silently falls back to `stub` and the run reports **100% empty** over canned data.

- **Check the routing before spending.** Read the selector/model *values* from the env (these are not secret) — if they are absent or `stub`, the run will be worthless:
  ```bash
  infisical run --env=<env> -- sh -c 'for v in RESEARCH_LLM_AGENT_PROVIDERS RESEARCH_LLM_AGENT_MODEL RESEARCH_PROVIDER_SCRAPE; do eval "x=\$$v"; echo "$v=${x:-<ABSENT>}"; done'
  ```
- **Do NOT guess vendors/models.** They live in the Infisical env (or must be added there); prior-session memory drifts. If the env lacks routing, ask the user for `vendor` + `model` per tier, or have them add `RESEARCH_LLM_*_{PROVIDERS,MODEL}` to the env. Named vendors (`groq`, `fireworks`, `nebius`) carry their own endpoint — a tier needs only `PROVIDERS` + `MODEL`; only `custom` also needs `_BASE_URL`.
- **Run the two-slot cascade prod runs.** Production routes each tier `custom,<fallback>` (`apps/server/config.production.json`: `custom,groq` for agent/writer, `custom,fireworks` for extract). Measure with the same cascade so a vendor blip falls back instead of failing the run — a single-slot eval under load misreads a transient 4xx as a quality drop. Keep run concurrency at 1 regardless.
- **Never pass a key on the command line.** Keys inject from the Infisical env. A provider name or model id is fine to pass inline; an API key is not (`pnpm` echoes its argv — a key there leaks).

## Infra stays local, never cloud

`DATABASE_URL` and `STORAGE_*` must resolve to the worktree's own DB + bucket, never prod. The dev Infisical env carries neither, so a dev-env run gets both from the worktree `.env` automatically. If you run off an env that *does* carry them (e.g. prod), pin both back to local with a leading `env DATABASE_URL=… STORAGE_ENDPOINT=…` before `pnpm` (see `eval/README.md`).

## Validate one company first, then the full pass

Always shake out the config on a single row before the billable run — a wrong vendor/model, an expired key, or a network-blocked provider fails in seconds as a 100% empty rate.

```bash
# 1. one-row golden (pick one company from the set), --runs 1
infisical run --env=<env> -- sh -c '<inline routing if not in env> \
  pnpm cli research eval --org <org> --user <user> --golden <one-row>.json --runs 1 --out /tmp/one.json'
# grep the run log for "AuthenticationError" / "status: 40" — empty=100% + a 4xx means routing is wrong, fix before step 2.

# 2. full pass, --runs 3 (mandatory — the eval re-scrapes each run, a single run is noise)
infisical run --env=<env> -- pnpm cli research eval --org <org> --user <user> --golden eval/golden.example.json --runs 3 --out report.json
```

Run the full pass **in the background** (it outlives the 2-minute foreground limit); read `report.json` when it lands.

## Reading the result

`eval/README.md` §"Reading a change that targets under-filling" maps each number to the question it answers, and points at the `research.phase2` span's `research.enrichment.filled_{broad,rescued,kept}` attributes (on the monitoring board) that separate "the model returned nothing" from "a guard removed it". For a before/after, grounding accuracy is the **control** — if it moved, the two sides reached different evidence and the comparison is void; rerun.

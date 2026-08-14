---
name: run-research-eval
description: Run the research quality eval (packages/research golden set) against the live pipeline and read the numbers. Use when asked to "run the eval", benchmark research grounding/recall, or take a before/after on a research change. Encodes the routing, cost, and safety guardrails so a run is not misconfigured.
---

# Run the research eval

Drives every company in a golden-set JSON file through the **live** research pipeline (real scraping + LLM calls) and reports grounding accuracy, field precision/recall, titled-contact recall, wrong-company rate, and empty rate. It is a billable, multi-hour, developer/CI tool — never a production path.

Full reference: `eval/README.md`. This skill is the run procedure and the guardrails.

## Before you touch a command

1. **This spends real money and hours.** Three passes of the shipped golden set (~20 companies each) cost roughly **$10–15** and **1–2.5h** of live API calls, billed to the org's Firecrawl/LLM accounts. Confirm the user actually wants to spend it, and confirm **scope**: the current branch only ("after"), or a before/after pair against `main` too (doubles it). A before/after pair inside 24h must clear `search_cache` between the two sides — its rows live a day and a hit bills nothing, so the second side would otherwise be answered by the first and report near-zero credits.
2. **Worktree must be up:** `pnpm cli worktree up` (own DB + bucket), `pnpm cli worktree doctor` to confirm Postgres is reachable.
3. **Org/user** are seeded with generated ids — resolve them from the local DB, don't hard-code:
   ```bash
   psql "postgresql://batuda:batuda@localhost:5433/<worktree-db>" -tAc "SELECT id FROM organization WHERE slug='taller';"
   psql "postgresql://batuda:batuda@localhost:5433/<worktree-db>" -tAc "SELECT id FROM \"user\" WHERE email='admin@taller.cat';"
   ```

## The one rule that trips every run: routing ≠ keys

Two different things have to be present, and they come from two different places:

- **The routing** — which vendor and model each tier uses — is **not secret** and is **committed** in `apps/server/config.production.json`. It is not in Infisical. Do not go looking for it there, and do not ask the user for it.
- **The keys** come from Infisical and never appear on a command line.

If the routing is missing from the run environment, that provider silently falls back to `stub` and the run reports **100% empty** over canned data. So the run has to carry the committed routing in explicitly:

```bash
# Every RESEARCH_* setting except the keys, space-separated, as `NAME=value` arguments to `env`.
ROUTING=$(node -e 'const c=require("./apps/server/config.production.json");
  const out=[]; for (const [k, v] of Object.entries(c))
    if (k.startsWith("RESEARCH_") && !k.includes("API_KEY")) out.push(k + "=" + v);
  process.stdout.write(out.join(" "))')
```

Feed it after `infisical run` so it wins over anything the environment carries, together with the worktree's own database (a dev Infisical env ships its own `DATABASE_URL` and would otherwise win):

```bash
infisical run --env=<env> -- env $ROUTING DATABASE_URL="$DB" \
  RESEARCH_PROVIDER_REGISTRY_ES=none RESEARCH_PROVIDER_REGISTRY_GB=none \
  pnpm cli research eval …
```

This is the same trick `.github/workflows/model_capability.yml` uses to probe the models: committed routing plus injected keys.

**Expand `$ROUTING` in the shell that runs `env`, never in the one that writes the command.** It holds one `NAME=value` per line, so interpolating it into a double-quoted `sh -c "…"` embeds those newlines and `sh` reads them as command separators: the first line runs `env` with a single variable, the middle lines run as commands of their own, and the *last* line runs the eval — outside `infisical`, with no keys at all. Every provider then falls back to `stub` and the pass reports 100% empty over canned data, which reads as a total quality collapse rather than as a quoting mistake. Export it and single-quote the command so the inner shell does the splitting:

```bash
export ROUTING="$(node -e '…' )"   # space-separated
export DB="postgresql://batuda:batuda@localhost:5433/<worktree-db>"
nix develop --command sh -c 'infisical run --env=dev -- env $ROUTING DATABASE_URL="$DB" … pnpm cli research eval …'
```

**Turn off every tier the dev environment has no key for**, or config validation refuses to boot with a bare `ConfigError`. The committed routing points `enrich` at `hunter,fullenrich`, `map` at `firecrawl` and `verify` at a vendor, and `RESEARCH_API_KEY_ENRICH`, `_MAP` and `_VERIFY` are absent from dev. A scan uses the search, scrape and LLM tiers, so none of the three is needed:

```bash
RESEARCH_PROVIDER_ENRICH=none RESEARCH_PROVIDER_MAP=none RESEARCH_PROVIDER_VERIFY=none
```

**Turn the registries off for a pass that measures quality** — `RESEARCH_PROVIDER_REGISTRY_ES=none RESEARCH_PROVIDER_REGISTRY_GB=none`. A registry hands back a company's directors, who are named people with titles, so leaving it on feeds the contact numbers from a source the change under test has nothing to do with. It costs money and does not fire on every pass. Keep one registries-on pass separately as the figure that represents production.

**Never print a secret.** `infisical secrets` prints values in plain text — it has no redacted mode, and its `--json` output is preceded by the shell banner, so a naive parse returns nothing and tempts you into the plain form. If you need to know which keys exist, list names only:

```bash
infisical secrets --env=<env> | awk -F'│' 'NF>2 {print $2}'
```

Reading a key is never necessary: `infisical run` injects them into the child process.

**Run the two-slot cascade production runs.** Each tier routes `custom,<fallback>` — `custom,groq` for agent and writer, `custom,fireworks` for extract. Measure with the same cascade so a vendor blip falls back instead of failing the run; a single-slot eval under load misreads a transient 4xx as a quality drop. Keep run concurrency at 1 regardless.

**`infisical` lives in the nix shell**, not on the plain PATH. Prefix everything with `nix develop --command sh -c '…'`.

## Running ONE live query, not the eval

To watch a single research request go end to end — the usual way to check a change against a real run — the same routing-vs-keys rule applies, but the run happens inside the **server**, so the environment has to reach that process. Three things stop it, and each fails in a way that looks like something else:

1. **Turbo strips the injected secrets.** `infisical run --env=dev -- pnpm dev` hands them to Turbo, whose strict env mode drops anything not declared in `turbo.json`, so the server boots with no provider keys. Nothing errors — the run just finishes in under a second with `no_reliable_data` and "No pages were fetched", which reads exactly like a search that found nothing. Start the server directly instead of through Turbo.
2. **Infisical's shared values displace this worktree's.** Bypass Turbo and the dev environment's own `BETTER_AUTH_SECRET` (and `DATABASE_URL`) win over the worktree's, and the server refuses to boot on a `ConfigError`. Re-source the worktree's `.env` *inside* the Infisical child so local values land on top, then apply the committed routing last.
3. **The dev environment has no key for every tier.** `RESEARCH_API_KEY_ENRICH`, `_MAP` and `_VERIFY` are absent, and config validation refuses to boot without them. Set those providers to `none` — the search, scrape and LLM tiers are what a scan actually uses.

```bash
export ROOT=/path/to/worktree
cd "$ROOT"
export ROUTING=$(node -e 'const c=require("./apps/server/config.production.json");
  for (const [k, v] of Object.entries(c))
    if (k.startsWith("RESEARCH_") && !k.includes("API_KEY")) process.stdout.write(k + "=" + v + "\n")')
nix develop --command infisical run --env=dev -- sh -c '
  cd "$ROOT"; set -a; . ./.env; set +a
  cd "$ROOT/apps/server"
  exec env $ROUTING \
    RESEARCH_PROVIDER_REGISTRY_ES=none RESEARCH_PROVIDER_REGISTRY_GB=none \
    RESEARCH_PROVIDER_ENRICH=none RESEARCH_PROVIDER_MAP=none RESEARCH_PROVIDER_VERIFY=none \
    "$ROOT/node_modules/.bin/portless" run --name api.batuda node --watch --import tsx src/main.ts
'
```

Then start the run over MCP with an org-scoped API key (`pnpm cli auth create-key` does **not** set the org metadata the MCP endpoint requires — add `organizationId` + `createdByUserId` to the key's `metadata` in the dev database, or the handshake fails with "API key is not org-scoped"). Clear `research_cache` between runs of the same query, or the second one replays the first.

**Do not edit a source file while a run is in flight** — `node --watch` restarts the server and the run dies mid-flight, leaving its row stuck at `running`.

**A single run is billable**: the Spanish installations scan costs ~18¢ and takes ~20 minutes over ~300 sources.

## Infra stays local, never cloud

`DATABASE_URL` and `STORAGE_*` must resolve to the worktree's own DB + bucket, never prod.

**Pin `DATABASE_URL` on every eval command.** The dev env carries one, and anything the caller exports outranks every `.env` file (`apps/cli/src/lib/load-env.ts`), so the worktree's own value never wins on its own:

```bash
infisical run --env=dev -- env DATABASE_URL="postgresql://batuda:batuda@localhost:5433/<worktree-db>" pnpm cli research eval …
```

`STORAGE_*` is genuinely absent from the dev env and comes from the worktree by itself. The eval refuses to start against a non-local database, so a forgotten pin stops the run instead of writing a pass into a shared one.

## A whole-market pass needs the run deadline raised, or it measures a timeout

`RESEARCH_RUN_DEADLINE_SEC` is a hard wall-clock cap on one run, applied inside the pipeline. It defaults to **1200 (20 min)** and `.env.example` sets the same, which is *below* how long a search for a whole market takes — the Spanish installations scan runs 20–32 minutes over ~300 pages. Production sets 2400, but an eval builds the pipeline in-process, so a worktree pass gets the default.

Past that deadline the run is killed and marked `failed`, and a killed run is left out of the market figures rather than counted as a market with nothing in it. So the symptom is not a zero — it is the market's line reading `no run reached an answer`, or `By market` showing fewer runs than you asked for while the figures themselves look untroubled. Read the run count before the rates.

So pass it explicitly, above the longest run you expect, and keep it *below* the CLI's own poll ceiling (45 min) so the poll outlives the run and reads its answer:

```bash
… -- env $ROUTING DATABASE_URL="$DB" RESEARCH_RUN_DEADLINE_SEC=2400 \
  pnpm cli research eval --schema prospect_scan_v1 --golden eval/golden-markets.json …
```

`--schema prospect_scan_v1` is required for a market golden set — only a search shape answers with a list. The eval refuses to start without it rather than scoring every market at zero.

## Validate one company first, then the full pass

Always shake out the config on a single row before the billable run — a wrong vendor/model, an expired key, or a network-blocked provider fails in seconds as a 100% empty rate.

```bash
DB="postgresql://batuda:batuda@localhost:5433/<worktree-db>"
ROUTING=$(node -e 'const c=require("./apps/server/config.production.json");
  for (const [k, v] of Object.entries(c))
    if (k.startsWith("RESEARCH_") && !k.includes("API_KEY")) process.stdout.write(k + "=" + v + "\n")')

# 1. one row, one run — proves the routing is live before anything is spent.
nix develop --command sh -c "infisical run --env=<env> -- env $ROUTING DATABASE_URL='$DB' \
  RESEARCH_PROVIDER_REGISTRY_ES=none RESEARCH_PROVIDER_REGISTRY_GB=none \
  pnpm cli research eval --org <org> --user <user> --golden <one-row>.json --runs 1 --out /tmp/one.json"
# An empty rate of 100% means the routing did not arrive; a 4xx in the log means a
# key did not. Either way, stop — do not start step 2.

# 2. three full passes — a single one is noise. Clear the caches between them, or
#    passes 2 and 3 are answered from pass 1 and average away nothing.
for i in 1 2 3; do
  psql "$DB" -c 'DELETE FROM search_cache; DELETE FROM llm_cache;'
  nix develop --command sh -c "infisical run --env=<env> -- env $ROUTING DATABASE_URL='$DB' \
    RESEARCH_PROVIDER_REGISTRY_ES=none RESEARCH_PROVIDER_REGISTRY_GB=none \
    pnpm cli research eval --org <org> --user <user> \
    --golden eval/golden.example.json --runs 1 --by-bucket --out report-$i.json"
done
```

Run the passes **in the background** (they outlive the 2-minute foreground limit); read the reports when they land.

**Read credits from the per-run rows, not the summary.** A report's `runs[].usage.creditsUsed` is what a run actually consumed; the printed `Credits per run` averages over repeats, so any repeat served from cache drags it toward zero.

## Reading the result

`eval/README.md` §"Reading a change that targets under-filling" maps each number to the question it answers, and points at the `research.phase2` span's `research.enrichment.filled_{broad,rescued,kept}` attributes (on the monitoring board) that separate "the model returned nothing" from "a guard removed it". For a before/after, grounding accuracy is the **control** — if it moved, the two sides reached different evidence and the comparison is void; rerun.

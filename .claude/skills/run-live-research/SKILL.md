---
name: run-live-research
description: Run ONE live research query end to end against the local server, over MCP, with real providers. Use when asked to "watch a real run", check a research change against a live company or market, or reproduce a run's behaviour — not to benchmark quality, which is the run-research-eval skill.
---

# Run one live research query

Watching a single request go end to end is the usual way to check a research change against reality. It is a different task from the eval: the run happens inside the **server**, so the environment has to reach that process, and the request is started over MCP rather than from the CLI.

Same rule as everywhere else: **routing is not keys**. The routing — which vendor and model each tier uses — is committed in `apps/server/config.production.json` and is not secret. The keys come from Infisical. Both have to reach the server process, and each of the three things below fails in a way that looks like something else.

1. **Turbo strips the injected secrets.** `infisical run --env=dev -- pnpm dev` hands them to Turbo, whose strict env mode drops anything not declared in `turbo.json`, so the server boots with no provider keys. Nothing errors — the run finishes in under a second with `no_reliable_data` and "No pages were fetched", which reads exactly like a search that found nothing. Start the server directly instead of through Turbo.
2. **Infisical's shared values displace this worktree's.** Bypass Turbo and the dev environment's own `BETTER_AUTH_SECRET` and `DATABASE_URL` win over the worktree's, and the server refuses to boot on a `ConfigError`. Re-source the worktree's `.env` *inside* the Infisical child so the local values land on top, then apply the committed routing last.
3. **The dev environment holds no key for every tier.** `RESEARCH_API_KEY_ENRICH`, `_MAP` and `_VERIFY` are absent and config validation refuses to boot without them. Set those providers to `none` — a scan uses the search, scrape and LLM tiers, and none of the three.

## Starting the server

```bash
export ROOT=/path/to/worktree
cd "$ROOT"
export ROUTING=$(node -e 'const c = require("./apps/server/config.production.json");
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

`$ROUTING` must be expanded by the shell that runs `env`, not by the one writing the command — it is exported above and the command is single-quoted for that reason. A whole-market request also wants `RESEARCH_RUN_DEADLINE_SEC=2400`, above the 20-minute default it would otherwise be killed at.

## Starting the run

Start it over MCP with an **org-scoped** API key:

```bash
pnpm cli auth create-key --org <orgId>
```

`--org` is what sets the organisation metadata the MCP endpoint requires; without it the handshake fails with "API key is not org-scoped". Then call `start_research` over MCP and poll the handle it hands back.

Clear `research_cache` between runs of the same query, or the second one replays the first and tells you nothing about the change:

```bash
psql "$DATABASE_URL" -c 'DELETE FROM research_cache;'
```

## While a run is in flight

**Do not edit a source file.** `node --watch` restarts the server, the run dies mid-flight, and its row is left stuck at `running`. Make the change, then start the next run.

## What it costs

One run is billable: the Spanish installations scan costs about **18¢** and takes about **20 minutes** over ~300 sources. A single-company run is a few cents and a minute. That is cheap enough to be the first thing you reach for — quality benchmarking, which is not this, is the `run-research-eval` skill.

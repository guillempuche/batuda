---
name: run-research-eval
description: Run the research quality eval (packages/research golden set) against the live pipeline and read the numbers. Use when asked to "run the eval", benchmark research grounding/recall, or take a before/after on a research change. Encodes the routing, cost, and safety guardrails so a run is not misconfigured.
---

# Run the research eval

Drives every company in a golden-set JSON file through the **live** research pipeline (real scraping + LLM calls) and reports grounding accuracy, field precision/recall, titled-contact recall, wrong-company rate and empty rate. It is a billable developer/CI tool, never a production path.

Full reference: `eval/README.md`. This skill is the procedure and the guardrails.

## When to use it, and what it costs

Use it when a change could move research quality and you want a number instead of an impression. Do not use it to check that a change runs — a single live query does that for a fraction of the price (see the `run-live-research` skill).

On today's two-slot cascade one row costs about **3¢** and takes about **a minute**. The shipped golden set is ~20 rows, and `--runs 3` makes that **60 runs**: roughly **$2** and **an hour** at concurrency 1. A before/after is two of those. Say the figure to the user before spending it, and confirm the scope: the change alone, or a baseline beside it.

A market pass is a different animal — a whole-market run takes 20–32 minutes on its own, so cost and clock scale with the number of market rows, not with 3¢.

## The one command

```bash
scripts/research-eval.sh --env dev --golden eval/golden.json
```

It does everything a pass needs to get right:

- carries the **committed routing** from `apps/server/config.production.json` into the run (every `RESEARCH_*` setting bar the keys), passed as separate arguments so no second shell re-splits it;
- pins `DATABASE_URL` from this checkout's own `.env`;
- resolves `--org` / `--user` out of that database (`organization.slug='taller'`, `"user".email='admin@taller.cat'`);
- defaults to `--runs 3` and to the quality mode (`--quality`, registries and unkeyed tiers off) unless `--production`;
- runs the free `--dry-run` pre-flight first and stops if it fails, pricing it from `eval/reports/<golden-stem>` when that folder exists;
- prints where the report and the log went.

Flags: `--env <infisical-env> --golden <file> [--runs N] [--production] [--dry-run] [--baseline] [--schema <name>] [--out <file>] [--org <id>] [--user <id>] [--concurrency N] [--show-routing]`. A second mode, `--env <infisical-env> --kind-reask [--rows <file>] [--asks N]`, is described further down.

Run it in the background — a pass outlives the foreground limit — and read the report when it lands.

## Which environment, which database

These are two questions and they have two different answers.

**The database is always this worktree's own**, under every Infisical environment. The wrapper pins it from the worktree's `.env` and the CLI refuses a pass whose process `DATABASE_URL` differs from that file (`--database-from-env` overrides it, and wanting that flag is usually a sign something else is wrong). The clean fix is upstream: take `DATABASE_URL` and every `STORAGE_*` out of the Infisical dev environment altogether, which is what `eval/README.md`'s "infra stays local" rule has always asked for.

**`--env` only chooses which keys get injected.** Use `--env dev` for every comparison pass; its missing `ENRICH` / `MAP` / `VERIFY` keys are exactly why `--quality` switches those tiers off. Use `--env prod --production` only for the single registries-on pass that stands in for production — it spends the production allowances, and it is still pinned to the local database.

## Validate before you spend

```bash
scripts/research-eval.sh --env dev --golden eval/golden.json --dry-run
```

The pre-flight costs nothing and checks what actually goes wrong: the database is this machine's, no part of the pipeline would answer with canned data, every golden row parses (each rejected row printed with its reason), and this machine can reach each vendor. With a baselines folder present it also prices the pass from a real earlier report.

It cannot prove a key is still live — reaching a vendor's host is not being let in. If a key is in doubt, run **one row** (`--golden <one-row>.json --runs 1`, a few cents) and nothing more. That is the only thing a one-row billable run is for.

## Taking a before/after

```bash
# baseline, in a worktree on the base branch
scripts/research-eval.sh --env dev --golden eval/golden.json --baseline
# the change, in its own worktree
scripts/research-eval.sh --env dev --golden eval/golden.json
```

`--baseline` also files the report under `eval/reports/<golden-stem>/<date>-<time>-<sha>.json` and prints the path; the second run's pre-flight reads that folder for its price. Most of the time one pass per side is the whole job — `--runs 3` is what takes the noise out, not a second pass.

**Grounding accuracy is the control.** If it moved, the two sides reached different evidence and the comparison is void; rerun before trusting any other number.

## Reading the numbers

`eval/README.md` → "Reading a change that targets under-filling" maps each figure to the question it answers, and points at the `research.phase2` span attributes that separate "the model returned nothing" from "a guard removed it".

For a change to a guard, read the printed **Guard drops** section and the per-run `runs[].facts` in the report instead. That is where such a change shows up first, usually before any top-line rate moves.

Those are every number a run logs under a `research.` line, keyed `<line>.<field>` — the citation guard's `total`/`kept`, the contact rescue's `before`/`after`, the source-tier cap, the vocabulary mapping, the own-site verdict, and, on the runs where they fire, the drop counts of the scalar guard (`research.fields.ungrounded.dropped_*`), the website guard, the contact and value guards, and the prospect guards. Nothing is named in the eval's code, so a guard line added on the pipeline branch flows through once merged. The run's own closing `research.run` line is left out: its cost and tokens are already in `usage`. A guard whose counts only reach a span attribute does not appear at all — an absent line means "not logged", not "did not fire".

Read credits from the per-run rows (`runs[].usage.creditsUsed`), not from the printed average.

**A market pass has no grounding figure**, so its control is what the runs did: market runs lost (and how many of those to a reply cut off), rows per market, rounds per market and the guard drops. If those moved a long way between two sides, the sides did not meet the same web. Beside the kind and coverage figures it also prints what the list is worth to whoever works through it — rows with their own site, with a headcount, with a place narrower than the request's, and the known firms no run listed, by name. The last two need `placeWords` and `knownCompanies` on the golden row; `eval/README.md` → "What the list is worth to whoever works through it".

## A change to the company-of-this-kind check: re-ask, do not re-scan

The check that removes trade bodies, directories and portals from a scan's list is one model question about rows already written down. A market pass is the wrong tool for a change to it — half an hour a run, and more movement between two runs than most wordings produce. Re-ask stored rows instead:

```bash
scripts/research-eval.sh --env dev --kind-reask            # eval/kind-rows.json, three askings
scripts/research-eval.sh --env dev --kind-reask --rows eval/kind-rows.example.json --asks 2
```

It costs a few cents, takes about a minute per asking of a 200-row file (so run the default three in the background), goes past the model cache on purpose, and asks each run's list on its own in the pipeline's own batches. The procedure that keeps it honest:

1. **Unchanged code first, three askings.** The range it prints per count is the movement of the model alone; a change has shown something only when it moves a count outside that range.
2. **Read each sort of request on its own line** (`installers`, `makers`, `signal`…). A wording that keeps the makers is one careless word from keeping suppliers on an installers' list, and the `all` line shows the two cancelling out.
3. **Tune on two thirds of the runs, read the held-out third once.**
4. **Then one real run.** The re-ask cannot show what a wrong removal costs the rounds after it.

`eval/kind-rows.json` is built by hand from `get_research` dumps (kept rows from `prospects`, with `why_relevant`, `description` and `industry` joined by " · " (a middle dot with a space either side) as the check reads them; removed ones from `quality.not_companies`, stored that way already) and labelled by a person who opened the firm's site. It names real firms, so it is git-ignored and never pasted into a PR, an issue or a commit message. A batch the model failed on reads as "remove nobody"; the command counts those and says so at the end — a run that ends with that line is not a score — and when every batch failed it prints no table and exits with an error.

## Guardrails that survive

- **Never print a secret.** `infisical secrets` prints values in plain text and has no redacted mode. List names only, and never echo the run environment; the wrapper's `--show-routing` prints setting names alone.
- **`infisical` lives in the nix shell**, not on the plain PATH. The wrapper already prefixes `nix develop --command`.
- **Keep concurrency at 1.** Runs competing for the same providers time each other out, and a timeout scores as empty — a quality drop no change caused. If you raise it, say so beside the result.
- **A whole-market pass needs `--schema prospect_scan_v1`** and the run deadline at 2400 seconds (the wrapper sets it with that schema). The 20-minute default kills a market run, and a killed run leaves the market out of the figures rather than scoring it zero, so read the run count before the rates.
- **Registries off for a comparison** (what `--quality` does), one registries-on `--production` pass as the figure that represents production.

## Why this is a script and not a recipe

The old procedure spent three paragraphs on quoting a routing string inside `sh -c`, and got it wrong in a way that reported 100% empty — a setup mistake wearing a quality collapse's clothes. Beyond that, some sessions run under a worktree command guard that refuses a `node -e` one-liner, and even the bare word this harness is named after, inside a shell command. A script call clears both: the quoting lives in one reviewed file, and the caller types one line.

# Filed baselines

One folder per golden set, named after the file it measured: `eval/golden.json` files its passes under `golden/`.
Inside, one report per pass, named after the day and time it was taken and the commit it was taken on — `2026-09-13-1507-a1b2c3d.json`, or `2026-09-13-1507-nogit.json` where the commit could not be read. The time is in the name so a second pass on the same commit gets its own file rather than overwriting the first.

A copy lands here whenever a pass is run with `--baseline`, alongside whatever `--out` asked for, and the path is printed when it is written.

These files are committed. Two things read them.
The free pre-flight prices the next pass from the newest report in the folder (`--price-from eval/reports/golden`, which `scripts/research-eval.sh` passes on its own when the folder exists), so a quoted price comes from what a pass really cost rather than a guess.
And a later pass is read against them.

## What a filed copy holds

- `summary`, `byBucket`, `byCountry` and `byMarket` — the rates, whole. `byMarket` is keyed by the golden set's own market names.
- Per run: its golden id, bucket and country; the verdict flags and counts (grounded, wrong company, empty, fields expected/scored/correct, contacts expected/found); `usage` (cost, tokens, credits, calls per model); `facts` (the guard counts the run logged); and the `profile`, `people` and `market` count blocks.
- Not the `fields` list. That is the one place a run's score carries a value read off a company's own pages — what the run filled a field with — and it is dropped before the copy is written. Everything above is a count, a verdict or a name from the golden file itself, so no page-read value survives into a committed file.

What a run found stays in the `--out` report, which is not committed.

Take the before side on the base branch's worktree, before the change exists; grounding accuracy is the control, and a pass whose grounding moved reached different evidence and cannot be compared.

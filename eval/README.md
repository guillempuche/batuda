# Research eval

Measure the research pipeline's quality against a fixed set of companies whose correct answer you already know (the "golden set"), so a change to grounding or extraction can be proven with a number instead of guessed.

This is a developer/CI tool. It never runs in production — it drives the same research pipeline the server runs, but from the CLI, on demand.

## What this harness is

The pipeline is what changes; the companies are what stay still. A benchmark for a model does the reverse — it holds the code still and swaps the model — and that one flip decides the rest of the shape: a row is data rather than code, an answer is a rate rather than a verdict, and a pass over the set costs real money because nothing about it is staged.

**A row is data, so adding one is typing rather than programming.** One scorer reads every row, so a new company is a few lines of JSON and no code. What you pay for that: the harness has no way of knowing whether a "correct answer" is correct. A mistyped registration number is not a failing test — it is a wrong number in every report from then on, quietly, and only somebody re-checking the company will ever find it.

**The answers are rates, not pass or fail.** A pass does not come back "passed"; it comes back as shares — how much of what was known came back, and how much of what came back was right. A share moves in small steps, which is what lets it show a drift that a yes/no would round away, and equally what makes any single pass unreadable on its own; see [Reading a change that targets under-filling](#reading-a-change-that-targets-under-filling).

**Nothing is staged, so a pass is billable, slow, and noisy.** A real company either publishes that mailbox or it does not, which is what makes these numbers mean something outside this folder — and also what makes a pass cost ~$10–15 and a few hours, fail for reasons that have nothing to do with the change (a rate-limited provider, a site that blocked the scraper that morning), and differ from itself when run twice. Cost and noise are behind most of the rules in this file: why you validate one row before the billable pass, why a reading is three passes rather than one, why the registries go off for a comparison.

## Run it

```bash
# Which candidate models support the two features the tiers need (tool-calling + strict JSON schema)?
pnpm cli research probe --api-key <nebius-key>

# Score the golden set. Needs the research env configured (LLM + provider keys, DATABASE_URL) and an org/user to run as.
pnpm cli research eval --org <org-id> --user <user-id> --golden eval/golden.json --out report.json

# Score a set of whole-market requests instead. Same command, a scan schema, and a golden file of market rows.
# RESEARCH_RUN_DEADLINE_SEC must be raised: it defaults to 20 minutes, and a market search runs longer.
RESEARCH_RUN_DEADLINE_SEC=2400 pnpm cli research eval --org <org-id> --user <user-id> --schema prospect_scan_v1 --golden eval/golden-markets.json --out markets.json
```

`eval` prints the metrics — grounding accuracy, field precision, field recall, titled-contact recall, profile fullness, wrong-company rate, needs-review rate, empty rate — and writes a full per-run report with `--out`. A pass of whole-market requests is graded on a different set of numbers; see [Market rows](#market-rows-grading-a-search-for-a-whole-market).

Add `--by-bucket` to also print those metrics broken out by the golden rows' size/reach `bucket` (big / small / niche) and by `country`, so a regression that only hits, say, niche companies or one country is visible instead of averaged into the whole-set numbers. The same per-bucket and per-country summaries are always written to the `--out` report as `byBucket` / `byCountry`, and each run's span carries `eval.bucket` / `eval.country` for grouping on the monitoring board.

Titled-contact recall answers a gap the scalar fields miss: of the people a company is known to publish, how many the run returned **with a title**. Contacts sit outside the scored field set, so a run can pass every field yet hand back the decision-makers with no title — the exact symptom this metric watches. It only appears (else `n/a`) for rows that list expected `contacts`.

The scored fields are seven of the profile's ten, and the golden set has a right answer for even fewer. A run that returns those seven and nothing else scores full marks, which is the opposite of what a rich profile means. Three counts sit beside them for that reason: **profile fields filled** (out of the shape's own total), **people named per run**, and **of those, titled**. They need no golden data — they are counted off what came back — and they are the numbers to watch when a change is meant to make a profile fuller rather than more correct.

### Which fields are scored, and why

Scored: `industry`, `size_range`, `country`, `location`, `email`, `phone`, `tax_id`. Each has exactly one right answer that can be written down and checked.

The company's own `email`, `phone` and `tax_id` were added when the profile gained them. Adding a field to the scored list costs nothing in **field precision** or **field recall**: a row that states no expected value for a field is skipped for that field in both counts, so a historic row's numbers cannot move. It does change the **empty rate**, deliberately — a run whose only real find was the role mailbox printed on the company's contact page used to be filed alongside the runs that found nothing at all.

Not scored: `website`, `current_tools`, `tags`. The website is already what grounding is measured on (a row's `officialDomain`), so scoring it here would report the same success twice and make a change to grounding look twice as large. Tools and tags are free text with no single correct value.

Matching is per field: `location` by containment either way; `industry` by the same rule the CRM uses to decide two spellings are one trade, plus a shared word stem so an ending (“fusteria” against “fusteries”) is not counted as a miss; `phone` on its digits, last nine only, so spacing and a country code cannot fail a correct number; `tax_id` on its letters and digits alone, so `B-12345678` and `b12345678` are one number; `email`, `country` and `size_range` exactly, since the pipeline is meant to emit those verbatim.

### When the profile shape changes, take a baseline first

**Profile fullness** divides by the extraction schema's own field count, so adding a field to the schema moves the denominator and drops the ratio on identical output. It went from 6 to 10 when the company's contact details and registration number were added, which is a third off the ratio for output that did not change. Any comparison across such a change is meaningless unless the before-pass was taken on the old shape — so take the baseline *before* editing the schema, and say in the write-up which shape each side was measured on.

Read them against the guard stages on the monitoring board, below. Fields filled rising while the guards drop no more than before is a real gain; fields filled and guard drops rising together is padding.

**Wrong and unwatched** counts the look-alike runs that finished clean — the most that could ever reach a record without a person seeing it. Read it as an upper bound, not as what would actually happen: writing anything unwatched also needs the organisation to have switched that on, the value to be a way of reaching somebody rather than a judgement like an industry, and that address to have come back reachable. None of those is visible from a golden set, so the real number is far lower and is usually zero. What the figure is good for is direction — it must never climb.

**Needs-review rate** is the share of runs that finished flagged for somebody to read, and it is the counterweight to the line above. A change can push "wrong and unwatched" down simply by flagging more runs, which buys the number with a person's time rather than with better research — so the two are only good news when they fall together.

## Reading a change that targets under-filling

A change meant to fix a near-empty profile or titleless contacts is judged by three numbers moving together, against two that must not. **Field recall** and **titled-contact recall** rise and the **empty rate** falls — more of the known answer came back — while **field precision** does not fall more than a few points and the **wrong-company rate** does not rise at all, so the extra fields are real rather than invented.

**Grounding accuracy is the control**: extraction reads pages the fetch log already recorded, so grounding cannot legitimately move; if it does, the before and after reached different evidence and the comparison is void — rerun before trusting any other number. One limit worth knowing: grounding counts the source rows a run recorded, not whether a page's text was stored, so it cannot tell a page that was opened from one a search merely quoted. It controls for a prompt or trigger change; it cannot control for a change to the shape of the evidence itself.

A single run is noise, so always take three — `--runs 3`. That runs the whole set three times over, one round after another, and every round asks the providers again instead of reading the round before it, so the three answers are three readings rather than one answer counted three times. It costs about three times a single pass, which is the price of the noise going away; a pass that asks for one run is unchanged and still reads whatever an earlier pass left behind.

Clearing the caches by hand (`DELETE FROM search_cache; DELETE FROM llm_cache;`) is no longer part of the recipe, and would not have been enough on its own: a copy of each answer also sits in the running process's own memory, and the pages a run opened are kept in `sources` rather than in either of those tables.

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

**Match prod's cascade when you measure.** Run each tier as the two-slot `custom,<fallback>` cascade production uses (`apps/server/config.production.json`: `custom,groq` for agent + writer, `custom,fireworks` for extract), not a single slot. A single-slot eval never exercises the fallback, so a transient primary 4xx under load fails the run outright — that is what depressed a prior concurrency-3 pass by ~20 points on titled-contact recall, a load artifact rather than a quality change. `--concurrency` is 1 by default on `eval`, `eval-contacts` and `eval-invariance` for that reason, so a measured delta is quality rather than contention. Raising it makes a pass finish sooner and its numbers worth less; if you do raise it, say so beside the result, because the drop it causes looks exactly like a change that made the research worse.

**Storage is local too.** Like the database, `STORAGE_*` must resolve to the worktree's own bucket (provisioned by `pnpm cli worktree up`), never the cloud one — a run has no business writing its scrape cache to prod. The dev Infisical env carries no `STORAGE_*`, so those come from the worktree automatically.

**`DATABASE_URL` is the one you must pin by hand.** The dev Infisical env *does* carry it, and anything the caller exports outranks every `.env` file (`apps/cli/src/lib/load-env.ts`), so the worktree's own value cannot win. Put it in front of the command yourself:

```bash
infisical run --env=dev -- env DATABASE_URL="postgresql://batuda:batuda@localhost:5433/<worktree-db>" pnpm cli research eval …
```

The eval refuses to start against a database that is not on this machine, so a forgotten pin stops the run rather than filling a shared database with a pass's runs, sources and cached answers — several of which point at page text held only in that process's memory, which the server would later fail to read and pay to fetch again.

**Check before the billable pass — it costs nothing.**

```bash
pnpm cli research eval --org <org-id> --user <user-id> --golden eval/golden.json --dry-run --price-from report.json
```

`--dry-run` spends nothing and runs every pre-flight a real pass runs: the database is this machine's, no part of the pipeline would answer with canned data, and every golden row parses — each rejected row printed with its reason. It then says how many runs would execute, and with `--price-from <report.json>` prices them from what an earlier pass actually cost per run rather than from a guess. Without that flag it prints the count alone; no earlier pass, no price.

The pass refuses outright if a part it measures through would answer with canned data (a stub), so a mistyped vendor stops in seconds instead of running for hours and reporting a 100% empty rate. A part set to `none` is not refused — that is switched off, which is a deliberate setting and reads honestly in the result.

Even so, run a one-row golden with `--runs 1` (a few cents) before the full set: the guards prove the routing resolves, not that a key is live or that a provider will answer from this network.

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
    "fields": { "industry": "…", "size_range": "…", "country": "…", "location": "…", "email": "…", "phone": "…", "tax_id": "…" },
    "contacts": ["Ada Lovelace", { "name": "Alan Turing" }]
  }
}
```

- `query` — what the pipeline is asked to research (add the city for a generic name).
- `officialDomain` — the company's own website host; the primary proof the run reached the target. Required **unless** the company has no website of its own, in which case leave it out and give `altDomains` instead.
- `altDomains` — other hosts that also prove the target was reached (a registry profile, a known subsidiary). Optional when there is an `officialDomain`; required when there is not. A row naming neither is rejected — nothing could ever prove the run reached the right company.
- `bucket` — the company's size/reach segment: `big` (a household name, easy to research), `small` (an SMB with a light web presence), or `niche` (a specialist with little third-party coverage, the hardest). Optional, but an unknown value is rejected loudly; drives the `--by-bucket` breakdown so a regression that hits only one segment is not averaged away.
- `fields` — the known-correct values. Only the scored keys listed below are accepted, and a misspelled or unscored key is rejected loudly. All optional — score only the fields you can verify.
- `contacts` — people the company is known to publish, each a name string or a `{ "name": "…" }` object. They score titled-contact recall: how many came back with a title. Name matching folds accents and tolerates a middle name/initial, but it tokenizes on Latin letters — a name written only in a non-Latin script (CJK, Cyrillic, Greek, Arabic) won't match, so romanize it in the golden row. Optional; a fabricated name skews the metric exactly as a wrong field value does, so list only real, verifiable people. No `role` here — the metric checks that the run supplied *some* title, not which one.

### Allowed field values

Two of these are fixed sets, and the value has to be one of them or it can never match what the pipeline extracts:

- `industry` — free text: the trade in the words somebody who had read the site would write down (`Bicycle manufacturing`, `Freight forwarding`). There is no list to pick from — an organisation's trades are whatever its people call them — so write the wording you would expect, not a category
- `size_range` — `1-10` · `11-50` · `51-200` · `201-500` · `501-1000` · `1001-5000` · `5001-25000` · `25001-100000` · `100001+`
- `country` — ISO 3166-1 alpha-2 code (e.g. `GB` · `ES` · `US`)
- `location` — free text (matched by containment, so formatting differences are tolerated)
- `email` — the company's own published mailbox, exactly as printed (`info@…`, `hola@…`). Not a named person's address; those belong in `contacts`.
- `phone` — the company's own published number, in any format (matched on digits)
- `tax_id` — the registration number, in any format (matched on letters and digits)

## Market rows: grading a search for a whole market

A row can ask for a whole market instead of one company — "installation companies in Spain: electrical, plumbing, solar, fire protection, lifts". That is what a discovery scan answers, and none of the figures above apply to it: there is no one company for the run to have reached, and no profile of its own to have filled.

Counting how many companies came back is not the grade either. A run on 13 August returned 62 rows, of which 23 were trade bodies and 10 were the same company written twice, and four of the five trades asked for were missing entirely — a healthy-looking count over a list nobody could use. A market row is graded on those faults instead.

Copy `golden-markets.example.json` and give the row a `market` block in place of the domains:

```json
{
  "id": "es-installations",
  "query": "Empresas instaladoras en España: instalaciones eléctricas, fontanería…",
  "expectedOutput": {
    "market": {
      "name": "ES",
      "parts": [
        { "id": "electrical", "terms": ["instalacion electrica", "electricidad"] },
        { "id": "lifts", "terms": ["ascensor", "elevador"] }
      ],
      "notCompanies": ["FENIE", "Federación Nacional de Empresarios de Instalaciones de España"]
    }
  }
}
```

- `name` — what the market is called, and the key the `By market` breakdown groups on. Use whatever tells two markets apart for you; a country code is the obvious choice.
- `parts` — the things the request asks for, each with the wordings that place a returned row in it. **Request coverage** is how many parts came back with at least one row of the right kind of organisation, so a trade body cannot answer for the trade it represents.

Write the terms accent-free and lower-case. A term of five letters or more also matches words that *begin* with it, so `instalacion electrica` finds "instalaciones eléctricas"; a shorter one must match a whole word, so `gas` never matches "gasto".

That reach only runs downward, which is the thing to remember: `fontaneria` does not find "fontanero", because the term is not the start of the row's word. List the shortest stem, then the other forms a trade is named by — the agent noun ("instalador", "instaladora", "electricista"), the other language a market answers in, and the everyday phrasing ("placas solares" beside "fotovoltaic"). Words must also be adjacent: `contra incendios` does not find "protección activa y pasiva contra el fuego".

Terms match loosely and coverage is a "≥ 1 row" figure, so a single unrelated row can carry a whole part — "alquiler de elevadores para obra" answers lifts, "correduría de seguros contra incendios" answers fire protection. Prefer terms that name the trade rather than its subject matter, and avoid one that is an ordinary word in another field (`pci` is a fire-protection term in Spain and a payments standard everywhere else).

- `notCompanies` — the organisations known **not** to be the kind asked for: the trade bodies, federations, guilds and system operators a search for a trade runs straight through on its way to the members. **Organisation-kind precision** is the share of returned rows that are none of them. Required, and an empty array is a legitimate answer that has to be typed out — a market whose bodies nobody has listed scores a perfect 100%, and that reading must be a stated "none known" rather than something a forgotten key produced.

A row counts as one of them when the listed name appears in the row's name as those words, in that order, next to each other. Whole words, not a run of letters — a body is usually known by its initials, and three letters land inside an unrelated name by accident (`RTE` sits inside "No**rte** Instalaciones").

Three rules follow, and each of them bites:

- **List the name the body is actually known by, in full.** Matching runs one way only: the listed name has to fit inside the row's, never the reverse. A golden entry reading "Federación Nacional de Empresarios de Instalaciones **de España**" misses a row that stops at "…Instalaciones", and one extra word inside the row's name ("Asociación **Provincial** de Instaladores…") defeats an entry written without it.
- **List the initials as an entry of their own**, where the body is known by them. An acronym shares no words with what it stands for, so the spelled-out entry will never catch a row that gives only the initials.
- **A one-word entry matches only a row whose whole name is that word.** `FENIE` catches a row called `FENIE`, and deliberately not the retailer `FENIE Energía` — likewise `UNEF` against `Grupo Unef Solar`, or `RTE` against `RTE Ascenseurs`. Counting a real company as a trade body overstates the very problem the figure exists to measure.

What no rule about names can settle: a company genuinely trading under a body's initials reads as the body. Asking the model what an organisation is would settle it; a name cannot.

Three figures ride along beside those. **Duplicate rate** is how many rows are another row's company again, folded on the same identity the pipeline itself uses — the name with its legal form off the end, a shared website host, a branch office (a row whose name is another row's name and then the very town this row says it sits in, carrying no site of its own), or a note written after a name the list already holds plainly, like `KBE Energy (Annuaire Tecsol entry)` beside `KBE Energy`. It reads zero while that fold holds, which makes it a guard on the fold rather than a second opinion about it.

Read it as "no repeats of the kind those keys can tell", not as "no repeats". The branch route exists because a live French market search returned one company under its own name and four more times as that name plus the town of a branch office, none of the four carrying a website — no shared name key, no shared host — and the figure read 0% over a list that plainly repeated one company five times.

**Possible duplicate rate** is the figure that answers what that one cannot. It reads the same list far more loosely than any fold may act on: every word of one name somewhere in the other, allowing a word to meet the same word ending differently, so `SNEF` meets `Groupe SNEF` and `PPVS – Facilities Management` meets `PPVS – Facility Management France`. It counts every pair the strict figure counts and more, so it can never sit below it, and **the gap between the two is the reading** — rows repeating a company that no rule could safely join.

It is allowed to be loose because of what the two figures cost when wrong. This one also counts `Terre Solaire` beside a genuinely different `Terre Solaire Energie`, and that is the correct behaviour: as rows on a list those two are the same shape, with the same fields, as the `SNEF` pair that really is one company — a name, that name plus words, nothing else to read. Separating them needs to know that "Groupe" adds nothing where "Energie" adds something, which is a list of words per language and is ruled out. So the fold leaves both alone and the figure counts both: a count that overstates costs a reader a look, where a fold that overstates takes a real company off the list with nothing said.

**Location fill** is how many rows say where the company is. The field is asked for a town or a province, but any stated place counts, so a row answering with the country alone still counts as filled.

The **rows per market** count is still reported, as the scale those figures read against rather than as a grade. It is also what checking that every row is a real company would cost, so it needs a reading of its own before such a check exists.

### What this measures, and what it does not

Organisation-kind precision only counts the bodies your golden set names. A trade body nobody has listed passes through unmeasured, exactly as an unlisted expected field value is not scored — a golden set measures what it knows.

That limit is the point of the **`By market`** breakdown, which prints whenever the pass held a market row and is written to the `--out` report as `byMarket`. The shipped check that reads what kind of organisation a row is works off word lists in Spanish, Catalan and English: measured against fifteen European trade bodies it recognised four. So a Spanish market scores near 100% while a French or German one scores far lower, and the two averaged together hide the fact worth watching. Keep at least one market in a language that check does not read.

### The model settles what a name cannot

Every returned row the golden file says nothing about is put to a model, which is asked whether the row is an organisation that does the work of the trade or one that represents, regulates, supplies or lists the ones that do. That is what closes the gap above: a model reads every language a market answers in, and a body describes itself as one on its own page.

Three rules keep it honest, and the printed table shows which of them settled what:

- **A row the golden file names is a body whatever the model says.** A person checked that one; a model has no standing to overrule them.
- **A model that errors, or cannot tell, leaves the row a company** — the reading the figure had before any model was involved. An outage must never read as a list full of trade bodies.
- **Every row records which of the three decided it**, printed as `model ruled on` and `already listed` beneath the percentage. A pass where the model answered for every row and one where it fell over halfway both come out as a single percentage, and without the mix beside it the second reads as the first.

**It moves two figures, not one.** Organisation-kind precision is the obvious one. Request coverage is the other: a part of the request counts as answered only when a row of the right kind answers it, so a row the model reclassifies as a trade body stops answering for its trade. Read them together after a change to the judge.

The wording put to the model is the eval's own, deliberately not the one the pipeline's check uses. An instrument that asked the question exactly as the thing it measures does could never catch that thing being wrong — which is the whole reason this sits in the eval rather than reading the pipeline's verdict.

## Four kinds of row to include

- **Clean companies** — a company with its fields filled in (`country`, `location`, `industry`, and `size_range` where known). These score field precision and recall.
- **Generic / look-alike names** — a company whose name is common (many "Sunset Logistics" exist). Give the `query` a city and the real `officialDomain`; leave a field unset if you can't verify it. These catch the pipeline confidently returning a same-named *different* company (the wrong-company rate).
- **Reachable only by a role mailbox** — a small company that names nobody on its site but prints `info@` or `hola@` on its contact page. Put that address in `fields.email`. These are what proves the role-mailbox harvest works end to end: without such a row the harvest is unmeasured, and the run reads as empty.

  ```json
  {
    "id": "example-role-mailbox-only",
    "query": "Company Name, City",
    "expectedOutput": {
      "officialDomain": "company.example",
      "bucket": "small",
      "fields": { "country": "ES", "email": "info@company.example" }
    }
  }
  ```

- **No website at all** — a market stall, a family workshop, a jobbing builder. Omit `officialDomain` and give the register or directory page that proves the company exists as `altDomains`. These exercise the path where nothing can be guessed from a domain and the register is the only source of people.

  ```json
  {
    "id": "example-no-website",
    "query": "Company Name, City",
    "expectedOutput": {
      "altDomains": ["librebor.es"],
      "bucket": "niche",
      "fields": { "country": "ES", "tax_id": "B12345678" }
    }
  }
  ```

Both blocks above are **templates, not data** — the ids say so. Replace every value with a company you have actually checked. A made-up address or registration number poisons the numbers exactly as a made-up industry does, and these two fields are easier to get wrong because they look precise.

## What keeps a row in the set

Every row is paid for on every pass, so a row has to be worth paying for. A company that has scored every field on the last few passes is confirming something already known and charging full price to do it. That is the one to move out — not because it is wrong, but because a set of them is an expensive way to be told nothing changed.

Move it rather than delete it. `--golden` takes any file, so a second set costs only the run: keep the retired rows in one of their own and put it through when a change could plausibly have broken them.

**A fix deserves a row, and that row belongs in a file of its own.** When a fault is found and fixed — a listing page whose links were read the wrong way, a branch office folded onto its parent — the company that showed it is the only thing that will catch it coming back. The main set is the wrong place for it: the top-line figures are shares over whatever rows the file holds, so editing the file changes what they are measured over, and a before/after taken across that edit is comparing two different sets. Keep those rows in something like `golden-regressions.json`, run it as its own pass, and the main set's history stays comparable.

A row cannot say why it is there. There is no field for it and JSON has nowhere to put a note, so the `id` is the only place the reason survives — name a regression row after the fault it holds (`branch-office-fold`, `listing-page-links`) rather than after the company, and it still reads six months later.

## Registries: UK is free, ES is paid

The `RegistryRouter` picks a registry by the company's country. **Companies House (UK)** is free — register a key at `developer.company-information.service.gov.uk` and set `RESEARCH_PROVIDER_REGISTRY_GB=companies-house`. **libreBORME (ES)** is ~€0.29/lookup — set `RESEARCH_PROVIDER_REGISTRY_ES=librebor` with `RESEARCH_API_KEY_REGISTRY_ES` (an `AccessId:AccessKey` pair).

**For a pass measuring quality, turn both off** — `RESEARCH_PROVIDER_REGISTRY_ES=none` and `RESEARCH_PROVIDER_REGISTRY_GB=none`. A registry returns a company's directors, who are named people with titles, so leaving it on feeds the contact numbers from a source the change under test has nothing to do with. It also costs money and does not fire on every pass, which makes two passes differ for a reason that is not the change.

Know what turning them off costs: a registry lookup that resolves the target by its legal name counts toward grounding, and for a small business with a thin web presence that is often the only proof the run reached the right legal entity. So keep one registries-on pass as the figure that represents production, and read the registries-off passes as the comparison between two versions of the code.

## Note

`golden.example.json` ships a mix of real, verified companies: UK ones (whose register, Companies House, is free) that exercise grounding and the wrong-company rate, and Spanish small businesses (whose register, libreBORME, is paid) that exercise `country` (`ES`) and `size_range` against a thin web presence. Replace them with your own targets in any country. `industry` is scored against the wording you write in the golden, so keep it to the trade rather than a judgement about the sector — a run that read the site and wrote the same trade in its own words is a hit, and one that guessed from the company name is not.

## What a pass cannot tell you

Each of these is explained where it comes up above. Collected, they are what a number has to be read against.

- **A golden set measures what it knows.** A field with no expected value is not scored, and a trade body nobody listed passes as a company. Every figure is a statement about the rows and values somebody wrote down, never about the whole set of things that could be wrong.
- **Grounding counts the source rows a run recorded, not the page text it stored** — so it cannot tell a page the run opened from one a search merely quoted.
- **"Wrong and unwatched" is an upper bound, not a forecast.** Read its direction; the value itself is far above what would really reach a record.
- **Profile fullness divides by the extraction schema's own field count**, so it drops on identical output whenever the shape gains a field. It is only comparable across such a change if the before-pass was taken on the old shape.
- **The shipped check for what kind of organisation a row is reads three languages.** It recognised four of fifteen European trade bodies, so a Spanish market scores near 100% on organisation-kind precision and a French one far lower, for a reason that is not quality.
- **Duplicate rate is a guard on the fold, not a second opinion about it.** It reads zero exactly when the fold holds, so it can never surface a kind of repeat the fold has not been taught. Read **possible duplicate rate** for that, and read the two together: the first says whether the fold is working, the gap to the second says what the fold cannot reach. Neither says a pair really is one company — the loose figure counts near-identical names that are two companies too, on purpose.
- **Possible duplicate rate answers "how much of this list is worth a second look"**, not "how many companies came twice". Three live re-runs of the French market row read 13%, 3% and 2% against a strict figure of 0% every time: one genuine repeat in each, plus — in the first — a row called `D'ASCENSEURS`, a cut-off fragment rather than a company name, whose two words sit inside every lift company on the list. A pass carrying junk rows reads higher here, and the row a reader then looks at is worth striking out either way.
- **Nothing checks that a returned row is a real company.** Rows per market is the scale the other market figures read against, not a grade of its own.
- **The never-looked-for figures are taken over the runs that stored a reckoning, which is not every run.** A scan that comes back with nobody, and one that fetched no page at all, both store one now — those used to end before it was written, which left the figures blind to the runs that covered least. A run whose pages turn out not to be about the company it was pinned to still does not: it stops earlier still, before the search had worked through what it was asked for. It counts as a market everywhere else, so `scans that reckoned` is printed beside the share and is the number that says how much of the pass the share actually saw.
- **The never-looked-for share does not say why, and the stop reason cannot tell you.** A trade lost between a run's two readings and one the clock stopped it reaching both land in that share, and `stopped_because` describes the whole run — one run can hold both cases, so it would misattribute either. `thought it had them` is the figure that separates them: it counts only the trades a run finished believing it had found, so nought means no run's two readings disagreed. Read the share for how much of a shortfall went unlooked-for, and that count for whether the disagreement this measures has come back.

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

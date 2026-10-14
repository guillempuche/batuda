# Per-org attributes — design note, v2

Status: draft v2, replacing the 2026-09-05 draft after its pressure test ([attribute-layer-review.md](attribute-layer-review.md)). Nothing here is scheduled; the first three steps of the sequencing stand on their own and are worth doing whether or not the rest is ever built.

For system context see [architecture.md](architecture.md); for the MCP surface see [backend.md](backend.md). This note assumes the intelligence-locus split: the external MCP client is the brain, Batuda is the structured memory it reads and appends to.

---

## What changed from v1

The v1 draft was reviewed claim by claim against `main` and production, and its one untested assumption was measured against the extract model. Seven things change as a result.

1. Attributes belong to an instruction stack, not to the organisation. The demand is per campaign, and the org already runs eight research stacks, one per campaign.
2. No user-written prose reaches the extraction prompt. A fenced, capped description steered the fit verdict in 10 of 15 enrichment runs and rewrote the headcount and place on 90% of scan rows, so the "main risk" section of v1 is not a risk to argue about but a door to keep shut.
3. Values land on scan rows and travel through `create_companies`, the way a prospect's people do since v2026.9.12. The apply path stays for enrichment and stays unproven.
4. Values live in their own column, never under `metadata`, because the client's `update_company` writes `metadata` as one object and would erase them.
5. The bag is an array of closed structs, never a record. A record decoded on 0 of 4 attempts on the live route; the array decoded on 90 of 90.
6. Every research-written value carries a quote, and numbers are checked against it. Today a fabricated number passes every deterministic guard.
7. `painPoints` is out of scope. It is a note a person writes; only `currentTools` was ever the thing v1 described.

---

## The problem, restated

Two things vary per campaign. Qualification exists and is disconnected: instruction stacks are per campaign and server-enforced, and `fit_verdict`, `fit_checks` and `disqualifiers` carry the output, but the extraction prompt never sees the rules it is told to judge by, and no company in production carries a verdict.

Attributes do not exist as a thing, so the org keeps them in three places by hand. Under `metadata` on 367 of 472 companies, with 35 keys and drifting types (`employeeEstimate` is null or string, `sizeEstimate` object or string, `inTargetBand` boolean or null). As tags, over a hundred of them, including `2-locations`, `4-locations`, `10-locations`, `fmcsa-verified`, `single-location-confirmed`, `sole-prop-flag` and `podcast:tier:1` to `:3`. And as `painPoints` prose repeating what the tag already says. The one column research can fill, `currentTools`, carries the freight vocabulary of one campaign inside a prompt every organisation's runs use.

The sector overlays say what an attribute is for this org: loads per day and authority date for freight brokers, RFQs per week and jobs per month for fabricators, locations and invoices per month for repair groups, branches and tickets per month for dealers, active projects and change orders per month for trades. Each is a number or a short enum, each is per campaign, and none has a field.

---

## Before and after

### Before (today)

A person who wants "how many locations" on every auto-repair lead writes it three ways: a tag, a `metadata` key of their own naming, and a sentence in `painPoints`. Nothing validates the value, nothing filters on it except an exact string match against `metadata`, nothing renders it in the web app, and research cannot fill it because no field holds it. The next person writes it a fourth way.

### After (this note, fully built)

The stack the campaign runs under declares `site_count` as a number with a label. The client writes it on `create_companies` and `update_company` under `attributes`, and the server rejects a key the stack does not declare or a value of the wrong kind. `search_companies` filters it as a number. The web app renders it in the company's About section. When research fills it, the value carries the page and the quote it was read from, or it is dropped.

### What this note does not promise

Research-filled attributes (channel B below) are the second half, gated on the first half being used by two stacks and on the two guard holes being closed. A migration of the existing `metadata` keys and tags is not designed here; it is a one-time import a person can run once the keys exist.

---

## Design

### 1. Declarations belong to a stack

```
research_attributes
  id               uuid
  organization_id  text        RLS: = current_setting('app.current_org_id')
  stack_id         uuid        the instruction stack this attribute applies to
  key              text        slug, unique per stack — site_count
  label            text        shown in the UI and in prompts — "Locations"
  kind             text        text · number · enum · boolean · date
  enum_values      text[]      null unless kind = 'enum'
  unit             text        null unless it has one — "per month"
  description      text        what to look for; reaches phase 1 only, fenced
  is_active        boolean     soft disable without losing stored values
  created_by       text
  created_at / updated_at
```

A run uses exactly one stack (composition `replace`), so the attributes in force for a run are the ones its stack declares; an attribute wanted on every campaign is declared on every stack, and a later "applies to all stacks" flag is a one-column change if that becomes tedious.

Validation lives in code, per project convention; the unique index on `(organization_id, stack_id, key)` is a race guard only. `manage_instructions` grows `list_attributes`, `create_attribute`, `update_attribute` and `delete_attribute`, scoped like stack edits.

A stack declares at most eight active attributes in v2. The prompt side is cheap (the spike's block added 850 characters against a 180,000-character page budget); the output side is not (a sourced value is 40 to 60 tokens per row, and the vendor's default completion cap already cut 13 of 30 unmodified scan extractions in the spike).

### 2. Values live in their own column

```
companies.attributes jsonb   { "<key>": { "value": …, "source_id"?: …, "quote"?: …, "as_of"?: …, "research_id"?: …, "set_by": "client" | "research" } }
```

Every write is a merge, `COALESCE(attributes, '{}'::jsonb) || $1::jsonb`, the pattern `field_provenance` already uses; a client that resends the object cannot erase what research wrote, and an `update_company` that passes `attributes` merges keys rather than replacing the column. A value the stack does not declare, or of the wrong kind, is refused at the boundary with the key named, the way a stage the model invented is refused today.

`search_companies` takes `attribute_key`, `attribute_op` and `attribute_value`, with the operator set decided by the declared kind: equality and `in` for enum and boolean, ranges for number and date, contains for text. No index at 472 companies; a GIN index on the column is one migration when a count says so.

The web app renders declared attributes in the company's About section from the stack's labels, with the source page linked when there is one. A value under an undeclared key is shown under "Other" so a retired attribute's data stays visible.

### 3. Channel A first: the client fills them

`create_companies` and `update_company` accept `attributes` per company, the same road the people took in v2026.9.12. The client reads answers off the brief and the findings and writes them, with `source_id` and `quote` when it has them and `set_by: "client"` otherwise. This needs no change to the research pipeline, matches how every value reaches the CRM today, and is the whole of v2's first cut.

Two independent fixes make the brief good enough to read answers off: `buildBriefPrompt` is told the request and the stack's attribute labels, and asked to say plainly when the evidence did not answer one; and the client passes the size band and place as hints rather than prose, which is a tool-description change.

### 4. Channel B later: research fills them

Gated on channel A being used by two stacks, and on the three hardening issues below being closed.

Phase 1 receives the labels and descriptions as one more fenced segment, below the invariants, in the format standing instructions already use; this is the only place the prose goes.

Phase 2 receives one server-composed line per attribute, `site_count (number, "Locations")`, `quoting_software (text, "Quoting software")`, `fleet_type (enum: asset | non-asset, "Fleet")`, under a two-sentence instruction to fill `attributes` with one entry per declared key the evidence supports and to leave the rest out. No user-written sentence is in that prompt. The schema gains `attributes: Array<{ key, value, source_id, quote }>` under `enrichment` for a profile and on each row for a scan; the base schemas stay closed, static and versioned as today.

The guards then run: a key the stack does not declare is dropped; a value with no `source_id` or no quote is dropped; a text value must be supported by its quote (the page-literal check); a number, date, enum or boolean must appear in its quote; the critic sees every attribute because every one carries a quote. The stack's attribute fingerprint joins `computeResearchCacheKey` beside the template fingerprint. The gap rounds take the declared keys as targets alongside the four hardcoded fields, and the fold keeps an attribute a later round finds.

A scan's attribute values ride the row into `create_companies` with their citations, `set_by: "research"`. An enrichment's go through the apply path as proposals once the run was pinned to a subject, which has happened twice in production and produced nothing yet.

### 5. What is deliberately not here

No description in the extraction prompt, no record-shaped bag, no dynamic per-org schemas, no attribute on the organisation without a stack, no write to `metadata`, and no `painPoints` migration.

---

## Sequencing

1. Give the brief the request and the attribute labels. Under 100 lines with tests; useful on its own today.
2. Make the client pass hints. Tool-description change; makes the size and place filters real for the customer running scans now.
3. Close the hardening issues #644, #645 and #646: numbers checked against their quote, job titles held to their quote, the request fenced and capped in the extraction prompt. #647, the extract reply cut off mid-JSON, is needed before channel B adds rows to the output.
4. Channel A: table, column, merge write, `manage_instructions` actions, `create_companies` and `update_company` fields, typed filter, About-section rendering.
5. Retire `currentTools` into a `quoting_software` attribute on the metal-fabrication stack, and delete the freight sentence from the two prompts. `painPoints` stays.
6. Channel B, behind a per-stack switch, with output tokens and parse failures measured before the eight-attribute cap is raised.

---

## Evidence

The review and spike are in [attribute-layer-review.md](attribute-layer-review.md): 137 extraction calls on the live extract model, about 46 cents, with the harness beside it. The production reads are from 2026-09-12 against 226 runs and 472 companies.

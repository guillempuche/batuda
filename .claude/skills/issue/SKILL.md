---
name: issue
description: This skill should be used when the user asks to "create an issue", "open an issue", "file an issue", "raise an issue", "log a bug", "track this as an issue", "make a GitHub issue", or describes a bug / feature / task to capture in the tracker. Interviews the user, researches the repo for real references and duplicates, drafts a type-aware (bug / feature / task) issue in Batuda's conventions, shows it for approval, then creates it via gh.
allowed-tools: Bash(gh:*) Bash(git:*) Bash(rg:*) Bash(grep:*) Bash(mktemp:*) Bash(rm:*) Read Grep Glob Write AskUserQuestion
---

# Create GitHub Issue

Turn a rough ask into a well-formed GitHub issue, following this repo's conventions. The flow is **interview → research → draft → approve → create**. One issue per run, in the current repo (`guillempuche/batuda`), unassigned, written in first person singular ("I"), English, never with AI attribution.

## Conventions (apply these exactly)

| Aspect         | Rule                                                                                                                                                                                                                                                                                                            |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Type           | Auto-detect `bug` / `feature` / `task`; confirm in the draft.                                                                                                                                                                                                                                                   |
| Title          | `[area] <plain imperative>`. Area(s) auto-derived from the touched paths (see map). **Stack brackets** when work genuinely spans subsystems: `[email][mcp] …`. Non-code → `[meta]` or `[docs]`. No type/colon prefix.                                                                                           |
| Type label     | `bug` → `bug`; `feature` → `enhancement`; `task` → `chore`; docs-only → `documentation`.                                                                                                                                                                                                                        |
| Priority label | Every issue gets `priority:high` \| `priority:normal` \| `priority:low`. Infer it, confirm in the draft. Area is **not** a label (it lives in the title).                                                                                                                                                       |
| References     | A `## References` list of `path:line` when the issue concerns specific code.                                                                                                                                                                                                                                    |
| Acceptance     | A checkbox task list. Each task carries a size (`S`/`M`/`L` or `~time`).                                                                                                                                                                                                                                        |
| Verbosity      | Match the ask — small ask → tight issue, big ask → fuller sections. No padding, no truncation.                                                                                                                                                                                                                  |
| Line wrapping  | **One line per paragraph; never hard-wrap prose mid-sentence.** GitHub renders every newline in an issue/PR/comment body as a `<br>`, so a paragraph wrapped at ~80 cols shows as ragged broken lines. Let prose reflow; only lists break per line (one item per line is correct). Same rule as `docs/` guides. |
| Scope          | One issue per run — never split into epics/sub-issues. Current repo only. Unassigned, no milestone, no project.                                                                                                                                                                                                 |
| Voice          | First person singular, English. No "Generated with…" / Co-Authored-By lines.                                                                                                                                                                                                                                    |

## Workflow

### 1. Understand the ask, interview for gaps

Classify the work as `bug`, `feature`, or `task`. Ask clarifying questions (AskUserQuestion or free-form) for anything material that's missing before drafting — e.g. repro steps + expected/actual for a bug, motivation + acceptance for a feature, definition-of-done for a task. Don't invent details; ask.

### 2. Research the repo (grounding)

Use Grep/Glob/Read to find the code the issue concerns and collect `file:line` references. Derive the area(s) from the touched paths via the map below.

For **bugs**, also auto-gather repro evidence and show it for trimming before it lands in the body:

- recent matching errors in `apps/server/server.log` (grep for `http.status` / `event` / `cause` near the symptom),
- any failing-test output the user pointed at.
  Keep snippets short (a few lines), redact secrets/full emails/bodies (`docs/observability.md` "Don't Log This").

### 3. Check for duplicates

`gh issue list --search "<keywords>" --state open` (then `--state all` if nothing). If a likely match exists, **stop** and show it; ask: proceed anyway / link as `Related: #N` / cancel.

### 4. Infer priority

From urgency cues: prod-down, blocker, data-loss, or security → `high`; cosmetic or nice-to-have → `low`; otherwise `normal`. Surface the pick in the draft so the user can override.

### 5. Draft the issue

Pick the template for the type (below). Title is `[area] imperative` (stack brackets when it spans). Show the **full draft inline** plus the proposed **type, priority, labels, title**. Then confirm or adjust.

### 6. Ensure labels exist

Compute the label set: type label + `priority:<level>`. For any label that doesn't exist yet (`chore`, the `priority:*` set), **ask once**, then create with `gh label create`:

- `priority:high` → color `b60205`
- `priority:normal` → color `fbca04`
- `priority:low` → color `0e8a16`
- `chore` → color `c5def5`

### 7. Create

Write the body to a temp file (`mktemp`), then:

```bash
gh issue create --title "<title>" --body-file <tmp> --label "<type>" --label "priority:<level>"
```

Current repo, no `--assignee`/`--milestone`/`--project`. Remove the temp file after.

### 8. Report

Print the issue URL plus a one-line recap: **title · type · priority · area(s) · labels** (and the linked duplicate, if any).

## Path → area map

Derive area(s) from the files the issue actually touches:

| Area       | Paths / signals                                                                          |
| ---------- | ---------------------------------------------------------------------------------------- |
| `email`    | `apps/mail-worker`, `packages/email`, `apps/server/src/services/email*`, inbox/IMAP/SMTP |
| `research` | `packages/research`, `research_*` tables, research engine                                |
| `mcp`      | `apps/server/src/mcp`, MCP tools/resources, OAuth-for-MCP                                |
| `calendar` | `packages/calendar`, `calendar_*` tables, cal.com                                        |
| `auth`     | `packages/auth`, Better Auth, `oauth*`, `apikey`, sessions                               |
| `crm`      | companies / contacts / interactions / proposals / pipeline                               |
| `db`       | `apps/server/src/db`, migrations, RLS                                                    |
| `ui`       | `apps/internal` (web app)                                                                |
| `infra`    | `Kraftfile`, `Dockerfile`, `.github/workflows`, deploy, env                              |
| `docs`     | `docs/` only → title `[docs]`                                                            |
| `meta`     | repo-wide / process / no single area → title `[meta]`                                    |

Area lives in the **title bracket**, so no area label is created.

## Type templates

### bug → labels: `bug`, `priority:<level>`

```
[area] <imperative>

<one-line summary of the wrong behavior>

## Steps to reproduce
1. …

## Expected
…

## Actual
…

## Environment
- Where: prod (api.batuda.co) | local
- Version / SHA: <if known>

## Evidence
<short server.log / test snippets, if gathered — redacted>

## References
- path/to/file.ts:line
```

### feature → labels: `enhancement`, `priority:<level>`

```
[area] <imperative>

## Summary
…

## Motivation
<why this matters / what it unblocks>

## Acceptance
- [ ] … (S/M/L)

## Tasks
- [ ] … (S/M/L)

## References
- path/to/file.ts:line
```

### task → labels: `chore` (or `documentation` if docs-only), `priority:<level>`

```
[area] <imperative>

## Summary
…

## Definition of done
- [ ] …

## Tasks
- [ ] … (S/M/L)

## References
- path/to/file.ts:line
```

## Guardrails

- One issue per run — never auto-split into epics/sub-issues.
- Current repo only; unassigned; no milestone/project.
- Confirm before creating any brand-new label.
- On a likely duplicate, stop and ask first.
- Never add AI attribution or Co-Authored-By lines; write as "I", in English.

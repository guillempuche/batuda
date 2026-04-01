---
name: commits
description: Generates consistent git commit messages following project conventions. Use when committing changes, creating PRs, or when asked to write commit messages. Also validates if proposed messages follow project format.
---

# Git Commit Messages

Generate well-formatted commit messages following project conventions.

## Workflow

1. Run `git status` and `git diff --staged` (or `git diff` if nothing staged)
2. Analyze which files changed, what was added/removed/modified
3. Determine the correct type and scope (use the Path → Scope table)
4. If changes should be split into multiple commits, group files logically
5. Draft each commit message
6. Run the **Validation Checklist** on every message before returning
7. Return a **preview** for each proposed commit

## Output Format

For each commit, return:

```
### Commit N

**Files:**
- path/to/file1.ts
- path/to/file2.ts

**Message:**
type(scope): subject

- Body bullet.
```

**Rules for previews:**

- List ALL staged files that belong to each commit
- If suggesting multiple commits, clearly indicate which files go in each
- Never execute the commit — only return the preview
- Group related files together (same feature, same scope)

## Message Format

```
type(scope): subject in imperative mood

- Body bullet in past tense with period.
- Another change description.
```

## Types

| Type       | When to Use                                                                                                                                  |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `feat`     | Added new functionality or new capabilities                                                                                                  |
| `fix`      | Fixed a bug                                                                                                                                  |
| `refactor` | Restructured code, no behavior change, no new capabilities                                                                                   |
| `chore`    | Dev-time: dependencies, tooling, local configs                                                                                               |
| `docs`     | Documentation                                                                                                                                |
| `test`     | Tests                                                                                                                                        |
| `cicd`     | Ship-time: CI/CD, releases, deployment, containers, git hooks (e.g., `Dockerfile`, `Kraftfile`, `lefthook.yml`, `.github/`, `.release-it.*`) |
| `revert`   | Reverted a previous commit                                                                                                                   |
| `ai`       | AI configurations (see AI scope below)                                                                                                       |

**`chore` vs `cicd`:** If it affects how code **gets to production** (build, CI, release, deploy) → `cicd`. If it affects how developers **work locally** (deps, formatting, linting, editor) → `chore`.

## Scope

Scope is derived from context and varies by type:

| Type                      | Scope Convention                                    | Examples                                   |
| ------------------------- | --------------------------------------------------- | ------------------------------------------ |
| `feat`, `fix`, `refactor` | **Path-based**: derived from package path           | `feat(server):`, `fix(domain):`            |
| `chore`, `docs`           | **Path-based** or omit if mixed                     | `chore(web):`, `docs:`                     |
| `cicd`                    | **Functional**: `release`, `deploy`, or omit        | `cicd(release):`, `cicd(deploy):`, `cicd:` |
| `test`                    | **Path-based**: same scope as the code being tested | `test(domain):`, `test(server):`           |
| `ai`                      | **Component**: `skills`, `mcp`, or omit             | `ai(skills):`, `ai(mcp):`, `ai:`           |
| `revert`                  | **Match the original commit's scope**               | `revert(web):`                             |

When changes span multiple scopes, omit the scope entirely.

### Path → Scope derivation

Derive scope from the **deepest meaningful package directory**:

| File path prefix      | Scope    |
| --------------------- | -------- |
| `apps/server/`        | `server` |
| `apps/web/`           | `web`    |
| `packages/domain/`    | `domain` |
| `docs/`, root configs | omit     |

Files outside `apps/` and `packages/` (e.g., `docs/`, root configs) have **no package scope** — omit it.

## AI Scope

The `ai` type covers anything that **directly configures, instructs, or extends AI capabilities**:

| Category             | Examples                                                            |
| -------------------- | ------------------------------------------------------------------- |
| **Agent configs**    | `.claude/`, `.cursor/`, `.github/copilot/`, `.aider/`, `.continue/` |
| **MCP servers**      | `.mcp.json`, MCP server implementations                             |
| **Skills & prompts** | Skills, system prompts, prompt templates                            |
| **AI rules**         | `CLAUDE.md`, `AGENTS.md`, `COPILOT.md`, AI coding guidelines        |
| **Model configs**    | Model selection, temperature, context window settings               |
| **AI tooling**       | Repomix configs, AI-specific linting rules                          |

**Excludes** (use other types instead):

- Code that *calls* AI APIs → `feat`/`fix`
- AI library dependencies → `chore`
- Documentation *about* AI features → `docs`

## File → Type Quick Lookup

Before choosing a type, check if the changed files match these patterns:

| File Pattern                                         | Type   | Scope    |
| ---------------------------------------------------- | ------ | -------- |
| `.mcp.json`                                          | `ai`   | `mcp`    |
| `.claude/skills/**`                                  | `ai`   | `skills` |
| `.claude/**`, `CLAUDE.md`, `AGENTS.md`, `COPILOT.md` | `ai`   | —        |
| `.cursor/**`, `.github/copilot/**`                   | `ai`   | —        |
| `Dockerfile`, `Kraftfile`, `.github/workflows/**`    | `cicd` | —        |
| `lefthook.yml`, `.release-it.*`                      | `cicd` | —        |

If ALL changed files match `ai` patterns → use `ai` type. If mixed with non-AI files, split into separate commits.

## Rules

1. **Subject**: Imperative mood, lowercase after colon, no period, max 72 chars
2. **Body**: Past tense, capital start, period at end
3. **No attribution**: Never include "Co-Authored-By", "Generated with", or any AI/author attribution
4. **AI-only changes**: When changes are exclusively AI-related (see AI Scope), always use `ai` type
5. **No mechanical cleanup**: Don't mention consequences obvious from the primary change (removed unused imports, unwrapped single-child fragments, updated indentation). Focus on intent
6. **No tautology**: The subject must not repeat the type as a verb. The type already conveys the action — e.g., `fix: fix the login` → `fix: resolve login failure`, `refactor: refactor auth` → `refactor: simplify auth flow`

## Validation Checklist

Run this checklist on every message **before** returning the preview:

1. **Length**: Count the subject line — reject if >72 chars
2. **Scope**: Look up the file paths in the Path → Scope table — confirm the scope matches (or is omitted for root/mixed files)
3. **Tautology**: Verify the subject does not repeat the type word (fix/fix, refactor/refactor, feat/feat, docs/docs, etc.)
4. **Mood**: Subject uses imperative ("add", "fix", "migrate") — not past tense ("added", "fixed")
5. **Body**: Every bullet starts with a capital letter, uses past tense, ends with a period

## Examples

```
feat(server): add health check endpoint
```

```
feat(server): add company search with filters

- Added search_companies route with status, region, industry filters.
- Returned summary projections to minimize payload size.
```

```
refactor(domain): migrate interactions to timestamptz columns

- Replaced date columns with timestamp for timezone awareness.
- Replaced date columns with timestamptz for timezone awareness.
```

```
chore: update workspaces and dependencies

- Bumped @biomejs/biome to 2.4.10.
- Synced Effect packages to ^3.21.0.
```

```
cicd(deploy): add workspace package build chain to server Dockerfile

- Built domain package before server so imports resolve.
- Pinned pnpm version in corepack to match lockfile.
```

```
ai(skills): update commit message conventions for batuda
```

```
ai(mcp): add batuda CRM server
```

```
feat(web): add pipeline dashboard with status counts

- Added pipeline overview route with company counts by status.
- Displayed overdue tasks and companies needing next action.
```

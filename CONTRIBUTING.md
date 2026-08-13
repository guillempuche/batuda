# Contributing to Batuda

Thanks for looking. Batuda is MIT and contributions are welcome.

**Open an issue before writing code.** Things move quickly here, and an issue first saves you from building against something I'm about to change. For a typo or a one-line fix, skip straight to the pull request.

## Good places to start

The architecture is built so that several useful contributions are small and self-contained.

- **Add a provider.** Every external capability — `search`, `scrape`, `registry`, `enrich`, `verify`, `report` — is a port with a fallback chain, living in `packages/research`. Adding Exa, SerpAPI, Tavily, or a national company registry means writing one adapter against an interface that already exists; the agent loop doesn't change. Registries are the widest gap: only Spain (libreBORME) and the UK (Companies House) are wired, and every other country is open.
- **Add a result schema.** The five in `packages/research/src/application/schemas/` are Effect Schemas. A new research mode is mostly a new schema plus the guards that validate what comes back.
- **Improve grounding.** Run [the eval harness](docs/architecture.md#quality--the-eval-harness) against the golden set, find where it loses, and fix that. Wins and regressions both show up as numbers.
- **Add a locale.** The web app runs on Lingui with `en` and `ca` today.

## Getting set up

[docs/getting-started.md](docs/getting-started.md) covers first-run setup, and the [quick start](README.md#quick-start) is the short version. You don't need provider keys — every research capability has a zero-cost stub.

## Where everything is documented

Read [AGENTS.md](AGENTS.md) before your first change. It's written for AI assistants, but it's the same set of rules a human needs: file naming, env var grammar, backend and frontend patterns, schema changes, and the build and lint commands.

Then reach for whichever of these your change touches.

| Read this                                                         | When you're…                                                                     |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| [architecture.md](docs/architecture.md)                           | Getting oriented — system design, bounded contexts, data flow, deployment        |
| [architecture.md → Research](docs/architecture.md#research)       | Touching the agent loop, capability ports, citations, or budget policy           |
| [backend.md](docs/backend.md)                                     | Working in `apps/server` — Effect patterns, routes, MCP tools                    |
| [frontend.md](docs/frontend.md)                                   | Working in `apps/internal` or `packages/ui` — design tokens, MD3, BaseUI         |
| [observability.md](docs/observability.md)                         | Adding logs, metrics, traces, or webhook events                                  |
| [runbooks.md](docs/runbooks.md)                                   | Changing anything an operator has to run or recover                              |
| [brand-voice.md](docs/brand-voice.md)                             | Writing any user-facing copy — voice rules, forbidden words, per-locale guidance |
| [brand-visual.md](docs/brand-visual.md)                           | Changing the look — colours, typography, the workshop metaphor applied to UI     |
| [crm-competitor-analysis.md](docs/crm-competitor-analysis.md)     | Arguing for or against a feature, and want to know what others ship              |
| [agency-workforce-platform.md](docs/agency-workforce-platform.md) | Curious where a larger version of this could go (deferred design note)           |

Two things that save time and aren't obvious: [`docs/repos/`](docs/repos) vendors the source of the dependencies this repo leans on hardest — Effect, Base UI, TanStack Router, Tiptap, Better Auth — so read there rather than in `node_modules`. And [`docs/drafts/`](docs/drafts) holds thinking that hasn't been built; useful context, not a spec.

## Tests and commits

**Tests** live next to what they test as `*.test.ts` (never `*.spec.*`), and go in the same commit as the code they cover.

**Commits** follow `type(scope): subject`:

```
feat(research): add Tavily search adapter

- Added the adapter behind the existing SearchProvider port.
- Wired the provider into the RESEARCH_PROVIDER_SEARCH fallback chain.
```

The subject is imperative and the body bullets are past tense. Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore` (local dev tooling), `cicd` (anything affecting how code reaches production), `revert`. The scope is the package or app the change lives in — `server`, `research`, `internal`, `domain`, `ui` — and can be dropped when a change spans several.

## Before you open a pull request

Run these from the repo root, in this order, and make sure each passes:

```bash
pnpm install
pnpm check-types
pnpm test
pnpm build
```

Then, in the pull request: say what changed and why, and include a screenshot or a short recording for anything that alters the UI. If your change touches research behaviour, eval numbers before and after are the most persuasive thing you can show.

Git hooks (lefthook) run on commit and push, so some of this catches itself.

## License

By contributing you agree that your work ships under the [MIT license](LICENSE).

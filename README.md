# Batuda

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**An open-source CRM with a built-in research agent. Find people, email them, follow up, and remember the trail.**

I built Batuda for the cases where a CRM that just *stores the row* isn't enough. I wanted the same tool to go look the row up — read a company's site, find the right contact, summarise the competitor — and hand me a structured result I could act on, on my own search + LLM keys, on a budget I set per user.

## Contents

- [The motion, end-to-end](#the-motion-end-to-end)
- [Who I built it for](#who-i-built-it-for)
- [What's in it today](#whats-in-it-today)
- [How Batuda compares](#how-batuda-compares)
- [Tech stack](#tech-stack)
- [Quick start](#quick-start) · [Detailed walkthrough →](docs/getting-started.md)
- [Scripts](#scripts)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [License](#license)

## The motion, end-to-end

1. **Find.** Launch a research job against your own search and LLM providers. Pick a mode (`prospect_scan`, `company_enrichment`, `contact_discovery`, `competitor_scan`) or go freeform. Each run lands as a structured record on a company, with per-user budgets, monthly caps, and explicit approval over the auto-approve threshold. Caching at every layer (search, scrape, extract, LLM) so re-runs don't re-spend.
2. **Contact.** Email from your own inbox. Any IMAP/SMTP provider — Infomaniak, Fastmail, M365, Gmail, anything. Outbound goes from your address. Inbound threads back onto the contact.
3. **Follow up.** Tasks and meetings carry the next step. Cal.com webhooks pull meeting state straight onto the contact.
4. **Remember.** An immutable interaction log captures every touch. Documents, proposals, and call notes hang off the same company. Multi-tenant Postgres, RLS-isolated workspaces, your data.

## Who I built it for

The same job — find someone, contact them, remember what happened — shows up in dozens of shapes. The ones I had in mind:

- A two-person agency tracking 80 local restaurants through proposals and follow-ups.
- A solo founder running a seed round across 120 angels and partners.
- A freelance designer staying in touch with 30 past clients without a paid CRM seat.
- A recruiter shortlisting candidates for a specific role.
- A journalist tracking sources, calls, and quotes for a long-form piece.
- A podcaster or author booking guests across a launch.
- An academic mapping potential collaborators for a paper or grant.
- A nonprofit development team tracking donors and funders.
- A community or event organiser keeping speakers and sponsors in one place.
- A consultant juggling 12 active proposals across past and future clients.
- A job seeker tracking applications, recruiters, and follow-ups.
- An open-source maintainer reaching out for sponsorships.

One instance, many workspaces. Run it alone, run it for a team, or host several workspaces under one roof.

## What's in it today

- **Research as a first-class capability.** Pluggable `SearchProvider`, `ScrapeProvider`, `ExtractProvider`, `DiscoverProvider`, plus three language-model roles (`AgentLanguageModel`, `ExtractLanguageModel`, `WriterLanguageModel`). Brave wired today. Per-user policy in `user_research_policy`, clamped against a system hard ceiling. Hierarchical parent/child runs. Streaming SSE events you can watch live.
- **Five typed result schemas** — `CompanyEnrichmentV1`, `CompetitorScanV1`, `ContactDiscoveryV1`, `ProspectScanV1`, `Freeform`. The agent returns a record, not prose.
- **Email through your own inbox.** IMAP IDLE in a separate `mail-worker` process. Credentials AES-256-GCM-encrypted per inbox. Outbound via SMTP, footer injection, draft staging.
- **Pipeline you can read at a glance.** Companies and contacts with status, priority, next action, last-contacted-at. Company-first, not deal-first.
- **MCP-first agent surface.** First-party MCP server with OAuth 2.1, intent-level typed tools (`search_companies`, `log_interaction`, `create_research`, `send_email`, …), slug-completion resources, and guided prompts. Claude, ChatGPT, and n8n use the same surface you do.
- **Multilingual page publishing** (Tiptap JSON blocks, `ca`/`es`/`en`) when you want a public landing for a workspace.
- **MIT, multi-tenant, your Postgres.** RLS-isolated workspaces, Better Auth, app-user / app-service roles.

## How Batuda compares

| Project         | Web research                              | Open source | Provider choice     | Budget control            | First-party MCP    |
| --------------- | ----------------------------------------- | ----------- | ------------------- | ------------------------- | ------------------ |
| **Batuda**      | First-class service + 5 typed schemas     | **MIT**     | **Pluggable ports** | **Per-user policy + cap** | **Yes**            |
| Attio           | Workflow block on a record                | Closed      | Their stack         | AI credits                | Yes                |
| Folk            | "Research Assistant"                      | Closed      | Their stack         | Per-plan                  | Community wrappers |
| Lightfield      | Code execution over interaction memory    | Closed      | Their stack         | Per-seat                  | Listed             |
| Reevo           | Bundled prospect DB, light "research"     | Closed      | Their stack         | Seat + credits            | None mentioned     |
| Twenty          | None as first-class (workflow `ai-agent`) | Custom OSS  | Vercel AI SDK       | None                      | Yes                |
| Atomic CRM      | None                                      | MIT         | n/a                 | n/a                       | OAuth + RLS proxy  |
| EspoCRM / Suite | None                                      | AGPL        | n/a                 | n/a                       | None               |

The combination no one else ships in one tool: **MIT + your provider keys + per-user budget caps + typed research schemas + intent-level MCP**. Full surface-by-surface comparison: [`docs/crm-competitor-analysis.md`](docs/crm-competitor-analysis.md).

> **Status.** Pre-1.0. Schema rewrites happen in a single `0001_initial.ts` migration; expect breaking changes between releases until I cut a stable version.

## Tech stack

| Layer           | Technology                                          |
| --------------- | --------------------------------------------------- |
| Monorepo        | pnpm workspaces + Turborepo                         |
| Dev environment | Nix flake (Node 24 + pnpm + kraft)                  |
| Shared schema   | `packages/domain` — Effect Schema                   |
| CLI             | `apps/cli` — Effect CLI + @clack/prompts TUI        |
| Backend         | `apps/server` — Effect HTTP + MCP server            |
| Web app         | `apps/internal` — TanStack Start                    |
| Shared UI       | `packages/ui` — MD3 design tokens + BaseUI + Tiptap |
| Database        | Postgres (NeonDB)                                   |
| Deploy          | Unikraft via kraft CLI                              |
| Code quality    | Biome (lint + format) + dprint (markdown)           |

## Quick start

**Requires:** Node 24, pnpm 10, Docker + Docker Compose. If you use [Nix](https://nixos.org), `nix develop` drops you into a shell with Node + pnpm already pinned.

```bash
nix develop                 # or: install Node 24 + pnpm manually
pnpm install                # install dependencies
pnpm cli setup              # copy .env files from .env.example
pnpm cli services up        # start Postgres + MinIO via Docker
pnpm cli db migrate         # create CRM + auth tables
pnpm cli auth bootstrap     # create first admin (interactive)
pnpm cli doctor             # verify everything is healthy
# in 2 terminals:
pnpm dev:server             # API + MCP server
pnpm dev:internal           # Batuda web app
```

First time? See the [detailed walkthrough](docs/getting-started.md) for explanations of each step, env var guidance, and troubleshooting.

## Scripts

```bash
# CLI
pnpm cli setup         # copy .env files from examples
pnpm cli doctor        # check environment health
pnpm cli seed          # insert sample data (Taller fictitious tenant)
pnpm cli db migrate    # run database migrations
pnpm cli db reset      # drop schema + re-migrate (chain `pnpm cli seed` for sample data)
pnpm cli services up   # start Docker services
pnpm cli:tui           # interactive TUI menu

# Development
pnpm dev:server        # start API + MCP server
pnpm dev:internal      # start Batuda web app

# Build & lint
pnpm build             # build all packages
pnpm lint              # lint + format
pnpm check             # lint + format (CI mode)
```

## Documentation

**Run it**

- [Getting started](docs/getting-started.md) — first-run setup, auth bootstrap, troubleshooting.

**Understand the architecture**

- [Architecture](docs/architecture.md) — system design, data flow, deployment.
- [Backend](docs/backend.md) — Effect patterns, routes, MCP tools.
- [Backend — research](docs/backend-research.md) — the agent loop, pluggable capability providers, citations, budget policy. Start here for the research surface.
- [Frontend](docs/frontend.md) — design tokens, MD3, BaseUI, components.

**Strategic context**

- [CRM competitor analysis](docs/crm-competitor-analysis.md) — surface-by-surface comparison against Attio, Folk, Twenty, Atomic CRM, EspoCRM, and more. Source for the table above.
- [Agency workforce platform](docs/agency-workforce-platform.md) — deferred design note on what it would take to grow Batuda into a small-agency platform where AI and human workers share a queue.

**Operate it**

- [Observability](docs/observability.md) — logs, metrics, traces.
- [Runbooks](docs/runbooks.md) — operational procedures (auth secret rotation, etc.).

**Contribute**

- [AGENTS.md](AGENTS.md) — rules and patterns for AI coding assistants working in this repo.

## Contributing

Contributions are welcome. Please open an issue first to discuss what you'd like to change.

## License

[MIT](LICENSE)

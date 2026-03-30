# TODO — Backend

Ordered implementation checklist for `apps/server` and `packages/domain`.
See [backend.md](backend.md) for patterns. See [architecture.md](architecture.md) for context.

---

## Phase 1 — Repo foundation

- [ ] Init git repo, pnpm-workspace.yaml, root package.json
- [ ] Add `.gitignore`, `.env.example`
- [ ] Add `tsconfig.base.json` at root — `moduleResolution: bundler`, strict, `verbatimModuleSyntax`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`
- [ ] Add `biome.json` at root — run `pnpm add -D @biomejs/biome@latest`, then `biome init` and customise: spaces/2, lineWidth 100, single quotes, noUnusedImports error
- [ ] Add `@biomejs/biome` devDependency to root `package.json` (pin to installed version)
- [ ] Add root scripts: `lint`, `format`, `check` (all via `biome`)
- [ ] Write `flake.nix` (Node 24 + pnpm + kraft) — fill kraft binary hash after nix-prefetch
- [ ] Run `nix develop` and verify environment

## Phase 2 — packages/domain

- [ ] Create `packages/domain/package.json`
- [ ] Create `packages/domain/tsconfig.json` extending `../../tsconfig.base.json`, lib ES2022 only (no DOM)
- [ ] Write Drizzle schema: `companies.ts`
- [ ] Write Drizzle schema: `contacts.ts`
- [ ] Write Drizzle schema: `interactions.ts`
- [ ] Write Drizzle schema: `tasks.ts`
- [ ] Write Drizzle schema: `products.ts`
- [ ] Write Drizzle schema: `proposals.ts`
- [ ] Write Drizzle schema: `documents.ts`
- [ ] Write Drizzle schema: `api-keys.ts`
- [ ] Write Drizzle schema: `webhook-endpoints.ts`
- [ ] Write `schema/index.ts` re-exporting all tables
- [ ] Write `drizzle.config.ts`
- [ ] Create NeonDB project at neon.tech, copy `DATABASE_URL` to `.env`
- [ ] Run `pnpm db:generate` — verify migration file created
- [ ] Run `pnpm db:migrate` — verify tables created in NeonDB
- [ ] Open `pnpm db:studio` and confirm all 9 tables visible

## Phase 3 — apps/server setup

- [ ] Create `apps/server/package.json`
- [ ] Create `apps/server/tsconfig.json` extending `../../tsconfig.base.json`, lib ES2022 only (no DOM)
- [ ] Install Effect v4 dependencies — verify package names/versions on npm
- [ ] Implement `src/db/client.ts` (Drizzle + NeonDB + Effect Layer)
- [ ] Implement `src/main.ts` skeleton (Effect HTTP server, no routes yet)
- [ ] Verify server starts with `pnpm dev:server`

## Phase 4 — API key middleware

- [ ] Implement `src/middleware/api-key.ts`
  - Read `x-api-key` header
  - SHA-256 hash and query `api_keys` table
  - Check `is_active`, check `expires_at`
  - Fire-and-forget update of `last_used_at`
  - Return 401 on failure with no detail
- [ ] Seed one API key in DB manually for testing
- [ ] Test middleware rejects missing/wrong key, accepts correct key

## Phase 5 — HTTP routes

Implement one entity at a time. For each:
1. Define Effect Schema validators for input/output
2. Implement service (business logic + Drizzle queries)
3. Implement HttpApiGroup with handlers
4. Register in main.ts

- [ ] `routes/companies.ts` — GET /companies (with filters), GET /companies/:slug, POST, PATCH /:id
- [ ] `routes/contacts.ts` — GET /contacts?company_id=, POST, PATCH /:id, DELETE /:id
- [ ] `routes/interactions.ts` — GET /interactions?company_id=, POST (+ auto-update last_contacted_at)
- [ ] `routes/tasks.ts` — GET /tasks?company_id= + GET /tasks?due_before=, POST, PATCH /:id (complete)
- [ ] `routes/documents.ts` — GET /documents?company_id=&type= (list, no content), GET /:id (with content), POST, PATCH /:id
- [ ] `routes/products.ts` — GET /products, POST, PATCH /:id
- [ ] `routes/proposals.ts` — GET /proposals?company_id=, POST, PATCH /:id
- [ ] `routes/webhooks.ts` — GET /webhook-endpoints, POST, PATCH /:id, DELETE /:id, POST /:id/test

## Phase 6 — Services

- [ ] `services/companies.ts` — search (filters + pagination), findBySlug, create, update, updateStatus
- [ ] `services/webhooks.ts` — fireWebhooks(event, payload) fire-and-forget fan-out
- [ ] `services/pipeline.ts` — getCounts(), getOverdue(), getNextSteps(limit)
- [ ] Wire webhook firing into: company status change, interaction created, proposal status change, task completed

## Phase 7 — MCP server

- [ ] Verify `@effect/experimental` exports `McpServer` in v4 (may be `@effect/mcp`)
- [ ] Create `src/mcp/server.ts` — McpServer definition
- [ ] Implement tool: `search_companies`
- [ ] Implement tool: `get_company` (company + contacts + last 5 interactions, no documents)
- [ ] Implement tool: `create_company`
- [ ] Implement tool: `update_company`
- [ ] Implement tool: `log_interaction` (creates interaction + updates company last_contacted_at + next_action)
- [ ] Implement tool: `get_documents` (list only, no content)
- [ ] Implement tool: `get_document` (full content)
- [ ] Implement tool: `create_document`
- [ ] Implement tool: `update_document`
- [ ] Implement tool: `create_task`
- [ ] Implement tool: `complete_task`
- [ ] Implement tool: `get_pipeline`
- [ ] Implement tool: `get_next_steps`
- [ ] Implement resource: `batuda://company/{slug}`
- [ ] Implement resource: `batuda://pipeline`

## Phase 8 — MCP transports

- [ ] Implement `src/mcp-stdio.ts` — stdio transport for Claude Code
- [ ] Write `.mcp.json` pointing to `mcp-stdio.ts`
- [ ] Test: open Claude Code, run `/mcp`, verify batuda tools listed
- [ ] Implement HTTP/SSE transport on `/mcp` route — Bearer token from `MCP_SECRET`
- [ ] Test remote MCP with a tunneled URL (Cloudflare Tunnel or ngrok)

## Phase 9 — Unikraft deployment

- [ ] Write `apps/server/Kraftfile` — spec v0.6, `runtime: node:latest`, scale-to-zero labels, `rootfs: ./Dockerfile`, `cmd: ["/usr/bin/node", "/app/dist/main.js"]` (see PLAN.md § Kraftfile)
- [ ] Write `apps/server/Dockerfile` — two-stage Node 24 alpine build, `NODE_OPTIONS=--no-network-family-autoselection`, corepack pnpm, copy monorepo, build domain+server, runtime stage copies only dist/ (see PLAN.md § Dockerfile)
- [ ] Run `kraft build` locally and verify image builds
- [ ] Run `kraft run` locally and verify HTTP server responds
- [ ] Deploy to Unikraft Cloud and verify
- [ ] Point `server.batuda.guillempuche.com` to deployed instance

## Phase 10 — Seed data

- [ ] Create at least one `products` row: delivery notes automation
- [ ] Create one `api_keys` row for local n8n testing
- [ ] Create one `webhook_endpoints` row pointing to local n8n
- [ ] Test end-to-end: create company via MCP → verify webhook fires to n8n

---
name: crm
description: This skill should be used when the user asks to "add a company", "update a company", "log an interaction", "create a document", "check the pipeline", "get next steps", "check overdue tasks", "create a page", "publish a page", "research a company", or mentions CRM data, MCP tools, companies, interactions, documents, tasks, or pages.
---

# CRM Operations

Batuda CRM operations guide. Use MCP tools for all data access — never write raw SQL, read `.env` files, or call the HTTP API directly.

The MCP server is registered in `.mcp.json`. Run `/mcp` in Claude Code to verify tools are loaded.

## Context efficiency

Fetch only what is needed. Prefer summaries over full profiles.

| Tool                        | Returns                                               |
| --------------------------- | ----------------------------------------------------- |
| `search_companies(filters)` | Summaries only, no full profiles                      |
| `get_company(id_or_slug)`   | Full profile + last 5 interactions (no documents)     |
| `get_documents(company_id)` | List (id, type, title) — no content                   |
| `get_document(id)`          | Full markdown content                                 |
| `get_pipeline()`            | Counts only                                           |
| `get_next_steps(limit)`     | Due tasks + overdue `next_action_at`                  |
| `create_page(...)`          | Create a prospect sales page (draft) with Tiptap JSON |
| `update_page(...)`          | Update page content, title, or meta                   |
| `publish_page(id)`          | Publish a draft page                                  |
| `list_pages(filters)`       | List pages by company, status, or language            |
| `get_page(id_or_slug_lang)` | Full page content by id or slug+lang                  |

Always call `search_companies` before `get_company`. Fetch document content only when needed to read or rewrite it.

## Schema conventions

All IDs are UUIDs. All timestamps are UTC.

Text enum fields (status, industry, channel, etc.) are plain strings — not Postgres enums. Valid values are documented in `packages/domain/src/schema/`.

`metadata jsonb` columns accept any valid JSON object. Always merge, never replace:

```
update_company({ id, metadata: { ...existing, new_field: value } })
```

## Companies

Status moves forward only: `prospect → contacted → responded → meeting → proposal → client/closed/dead`. To re-engage dead/closed: set status back to `contacted`.

- **Slug**: kebab-case from name. If duplicate, append city: `can-joan-girona`
- **Priority**: 1 = hot (contact this week), 2 = medium, 3 = cold (backlog)
- **source**: always set when creating. Values: `firecrawl | exa | google_maps | referral | linkedin | instagram | manual`
- **metadata**: use for data that doesn't fit existing columns (fiscal data, employee names, social stats, competitor notes)

For detailed field values, status flow diagram, and examples, consult `references/companies.md`.

## Interactions

Always set `next_action` and `next_action_at` when known — this drives the daily task list.

After `log_interaction`, update the company's `next_action` and `next_action_at` if they changed.

Key fields:

- **channel**: email, phone, visit, linkedin, instagram, whatsapp, event
- **direction**: outbound, inbound
- **type**: cold, followup, meeting, demo, check-in
- **outcome**: no_response, responded, interested, not_interested, meeting_scheduled, proposal_requested

For the full `log_interaction` example and workflow, consult `references/interactions.md`.

## Documents

`documents.content` is full markdown. Write structured, scannable content — no AI filler phrases.

Types: `research`, `prenote`, `postnote`, `call_notes`, `visit_notes`, `general`.

Link to interactions via `interaction_id` when applicable (`prenote`, `postnote`, `call_notes`, `visit_notes`).

When researching a new company:

1. `create_company(...)` with known fields
2. `create_document({ type: "research", content: <scraped + structured markdown> })`

For type descriptions and research workflow details, consult `references/documents.md`.

## Tasks

Tasks are the action queue. `get_next_steps` returns them sorted by due date. After completing a task, always check if a new task should be created for the next step.

## Pages

Use `create_page` to generate prospect sales pages. Set `lang: 'ca'` first, then create translations for the same slug.

Pages use Tiptap JSON with custom block nodes (hero, cta, valueProps, painPoints, socialProof). Standard rich text uses Tiptap StarterKit.

Always `publish_page` after review — pages are draft by default.

For page structure details, consult `references/documents.md`.

## Dos and don'ts

| Do                                        | Don't                               |
| ----------------------------------------- | ----------------------------------- |
| Use MCP tools for all data access         | Write raw SQL                       |
| Set `next_action_at` on every interaction | Leave a company with no next action |
| Use `metadata jsonb` for evolving data    | Add DB columns for one-off fields   |
| Write documents in clean markdown         | Dump raw scraped HTML               |

## Additional resources

### Reference files

For detailed field values, workflows, and examples, consult:

- **`references/companies.md`** — Status flow, slug format, priority, source values, metadata patterns
- **`references/interactions.md`** — Channel/direction/type/outcome values, log_interaction example, next_action workflow
- **`references/documents.md`** — Document types, research workflow, pages (Tiptap JSON, publish flow), tasks

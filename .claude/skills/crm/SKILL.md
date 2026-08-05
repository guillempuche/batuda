---
name: crm
description: This skill should be used when the user asks to "add a company", "update a company", "add a contact", "fix a contact's email", "change somebody's phone number", "remove an address", "log an interaction", "create a document", "check the pipeline", "get next steps", "check overdue tasks", "create a page", "publish a page", "research a company", or mentions CRM data, MCP tools, companies, contacts, channels, interactions, documents, tasks, or pages.
---

# CRM Operations

Batuda CRM operations guide. Use MCP tools for all data access — never write raw SQL, read `.env` files, or call the HTTP API directly.

The MCP server is registered in `.mcp.json`. Run `/mcp` in Claude Code to verify tools are loaded.

## Context efficiency

Fetch only what is needed. Prefer summaries over full profiles.

| Tool                        | Returns                                                   |
| --------------------------- | --------------------------------------------------------- |
| `search_companies(filters)` | Summaries only, no full profiles                          |
| `get_company(id_or_slug)`   | Full profile + last 5 interactions (no documents)         |
| `get_documents(subject)`    | Summaries + a snippet — no full body                      |
| `get_document(id)`          | Full markdown content                                     |
| `get_pipeline()`            | Counts only                                               |
| `get_next_steps(limit)`     | Due tasks + overdue `next_action_at` + research to review |
| `create_page(...)`          | Create a prospect sales page (draft) with Tiptap JSON     |
| `update_page(...)`          | Update page content, title, or meta                       |
| `publish_page(id)`          | Publish a draft page                                      |
| `list_pages(filters)`       | List pages by company, status, or language                |
| `get_page(id_or_slug_lang)` | Full page content by id or slug+lang                      |

Always call `search_companies` before `get_company`. Fetch document content only when needed to read or rewrite it.

## Schema conventions

All IDs are UUIDs. All timestamps are UTC.

Fields that take one of a fixed set of words (status, priority, size range, email verification) are plain strings, not Postgres enums; the sets they take are in `packages/domain/src/schema/`.

A channel's `kind` is not one of them — it is deliberately open, so a platform nobody has heard of yet needs no change. `CHANNEL_KINDS` lists the ones the web app knows how to draw and name; anything else is stored and shown as it arrived.

`industry` is not one of them. A company's trade is whatever the organisation calls it, so send the words a person would write (`Serralleria`, `Freight forwarding`) and the server files it under that organisation's own entry, creating one the first time anybody uses it. What comes back on the row is that entry's web-address form, which is what a filter and a shared link use.

`metadata jsonb` columns accept any valid JSON object. Always merge, never replace:

```
update_company({ id, metadata: { ...existing, new_field: value } })
```

## Companies

Status moves forward only: `prospect → contacted → responded → meeting → proposal → client/closed/dead`. To re-engage dead/closed: set status back to `contacted`.

- **Slug**: kebab-case from name. If duplicate, append city: `can-joan-girona`
- **Priority**: 1 = hot (contact this week), 2 = medium, 3 = cold (backlog)
- **metadata**: use for data that doesn't fit existing columns (fiscal data, employee names, social stats, competitor notes)

For detailed field values, status flow diagram, and examples, consult `references/companies.md`.

## Contacts

A wrong email is corrected with `manage_contact_channels`, never by deleting the person and starting over — deleting detaches every interaction, proposal and thread they were attached to. `update_contact`'s `channels[]` only ever adds or refreshes, so a correction made there leaves the old address beside the new one.

For adding, correcting, removing and re-electing a channel, and for how far an address is trusted, consult `references/contacts.md`.

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

Types: `research`, `prenote`, `postnote`, `call_notes`, `visit_notes`, `general`. Nothing else is accepted.

Every document is filed against a CRM record — `subject_table` (`companies`, `contacts`, `tasks`, `proposals`, `calendar_events`) plus `subject_id`. File it against what it is about: a meeting prep note goes on the `calendar_events` row so it appears when someone opens that meeting. `attach_document` files the same document in a second place.

When researching a new company:

1. `create_companies(...)` with known fields
2. `create_document({ subject_table: "companies", subject_id: <id>, type: "research", content: <scraped + structured markdown> })`

A company's standing summary is `companies.account_brief`, not a document.

To have the server do the research instead, `start_research` returns a run id and
a `poll_after_ms`; wait that long, then `get_research`, and repeat while
`poll_after_ms` keeps coming back. A run takes 2-5 minutes, so do not wait on it
inside one reply — hand back the id, and pick it up on the next turn or from
`get_next_steps`. `progressSteps` climbs while the run works; unchanged for
several minutes means it is stuck, and `cancel_research` ends it.

For type descriptions and filing details, consult `references/documents.md`.

## Tasks

Tasks are the action queue. `get_next_steps` returns them sorted by due date, alongside companies with an overdue `next_action_at` and finished research awaiting review. After completing a task, always check if a new task should be created for the next step.

`researchAwaitingReview` is how finished research gets noticed at all — a run takes 2-5 minutes, so whoever asked for it is rarely still waiting. Each entry carries `pendingUpdateCount` (CRM changes still undecided — read them with `list_research_proposed_updates`) and a `status`; `failed`, `no_reliable_data` or `succeeded_low_confidence` means the run itself needs a look.

Reading the proposals is yours; **deciding them is not**. `resolve_research_proposed_update` writes to the customer's own records, so it asks the person first — and Claude.ai and ChatGPT cannot show that question, so from either of those it always answers `confirmation_required` and changes nothing. Summarise what the run proposes and point the person at `/research/<run id>`, where they can apply or reject each one. The same holds for `resolve_research_paid_action` (it spends money), `delete_research`, and raising a limit with `research_policy` — relay the `nextStep` rather than retrying, since retrying gives the same answer.

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

- **`references/companies.md`** — Status flow, slug format, priority, size ranges, how a trade is named, metadata patterns
- **`references/contacts.md`** — Correcting and removing one channel, primary election, how far an address is trusted vs whether it bounced
- **`references/interactions.md`** — Channel/direction/type/outcome values, log_interaction example, next_action workflow
- **`references/documents.md`** — Document types, research workflow, pages (Tiptap JSON, publish flow), tasks

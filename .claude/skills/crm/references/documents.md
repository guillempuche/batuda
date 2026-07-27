# Documents, pages, and tasks reference

## Where a document is filed

Every document is filed against a CRM record, named by `subject_table` + `subject_id`:
`companies`, `contacts`, `tasks`, `proposals`, or `calendar_events`.

File it against the thing it is actually about. A prep note for a meeting belongs on that
`calendar_events` row, not on the company — that is what makes it show up when someone opens the
meeting. A note about how a person likes to work belongs on their `contacts` row.

One document can be filed in more than one place. `create_document` takes the first record;
`attach_document` adds others and `detach_document` removes one. Filing the same pair twice is a
no-op, not an error.

## Document types

| Type          | Purpose                            |
| ------------- | ---------------------------------- |
| `research`    | Scraped/researched company profile |
| `prenote`     | Prep before a meeting              |
| `postnote`    | What happened at a meeting         |
| `call_notes`  | Phone call notes                   |
| `visit_notes` | On-site visit notes                |
| `general`     | Anything else                      |

These six are the whole list — the tools reject anything else.

## Writing documents

`documents.content` is full markdown. Write it as a human would — structured, scannable, no AI filler phrases.

## Research workflow

When researching a new company with Firecrawl/Exa:

1. `create_companies(...)` with known fields (name, slug, source, industry, etc.)
2. `create_document({ subject_table: "companies", subject_id: <id>, type: "research", content: <scraped + structured markdown> })`

Structure research documents with clear sections: overview, products/services, team, location, online presence, opportunities.

A company's standing summary is `companies.account_brief`, not a document — it is one per company and
kept current, where documents accumulate. Update the brief through `update_company`.

Contacts, tasks and proposals used to carry a `notes` field of their own. They no longer do: anything
written about one of them is a document filed against it. `create_document` with the matching
`subject_table` is how you write one now.

## Pages

### Creating pages

Use `create_page` to generate prospect sales pages. Set `lang: 'ca'` first, then create translations for the same slug.

### Content format

Pages use Tiptap JSON with custom block nodes:

- `hero` — main banner with headline and subheadline
- `cta` — call to action block
- `valueProps` — value propositions list
- `painPoints` — customer pain points
- `socialProof` — testimonials or social proof

Standard rich text uses Tiptap StarterKit nodes (paragraph, heading, bulletList, etc.).

### Publishing

Pages are draft by default. Always `publish_page` after review to make them publicly accessible.

### Page tools reference

| Tool                        | Purpose                                    |
| --------------------------- | ------------------------------------------ |
| `create_page(...)`          | Create draft page with Tiptap JSON content |
| `update_page(...)`          | Update page content, title, or meta        |
| `publish_page(id)`          | Make page publicly accessible              |
| `list_pages(filters)`       | List pages by company, status, or language |
| `get_page(id_or_slug_lang)` | Get full page content                      |

## Tasks

Tasks are the action queue driven by `next_action` and `next_action_at` fields on interactions and companies.

- `get_next_steps(limit)` returns tasks sorted by due date (including overdue items), companies with an overdue next action, and finished research awaiting review
- After completing a task, always check if a new task should be created for the next step
- Tasks connect to the pipeline: completing tasks often means updating company status or logging a new interaction

# Documents, pages, and tasks reference

## Document types

| Type          | Purpose                            | Interaction link                                |
| ------------- | ---------------------------------- | ----------------------------------------------- |
| `research`    | Scraped/researched company profile | No                                              |
| `prenote`     | Prep before a meeting              | Yes — link via `interaction_id` once scheduled  |
| `postnote`    | What happened at a meeting         | Yes — always link to meeting's `interaction_id` |
| `call_notes`  | Phone call notes                   | Yes — link to interaction                       |
| `visit_notes` | On-site visit notes                | Yes — link to interaction                       |
| `general`     | Anything else                      | Optional                                        |

## Writing documents

`documents.content` is full markdown. Write it as a human would — structured, scannable, no AI filler phrases.

## Research workflow

When researching a new company with Firecrawl/Exa:

1. `create_company(...)` with known fields (name, slug, source, industry, etc.)
2. `create_document({ type: "research", content: <scraped + structured markdown> })`

Structure research documents with clear sections: overview, products/services, team, location, online presence, opportunities.

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

- `get_next_steps(limit)` returns tasks sorted by due date, including overdue items
- After completing a task, always check if a new task should be created for the next step
- Tasks connect to the pipeline: completing tasks often means updating company status or logging a new interaction

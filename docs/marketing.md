# Marketing Frontend

Engranatge public website at `engranatge.com`. TanStack Start SSR app deployed to Unikraft (Node.js).
For system context see [architecture.md](architecture.md).

---

## Stack

- **TanStack Start** — SSR framework (file-based routing, server functions)
- **TanStack Router** — type-safe client routing
- **styled-components** — CSS-in-JS co-located in .tsx files, using MD3 CSS custom property tokens
- **Tiptap** — renders page content from JSON (read-only, no editor)
- **@engranatge/ui** — shared design tokens + Tiptap block extensions

---

## Route structure

```
src/routes/
├── __root.tsx              # Root layout
├── index.tsx               # / — Engranatge marketing homepage
├── $lang.tsx               # Language layout: validates lang, sets <html lang>
└── $lang/
    ├── index.tsx           # /:lang — language-specific landing
    └── $slug.tsx           # /:lang/:slug — prospect page
```

### Language validation

`$lang.tsx` validates the `lang` param against allowed values. Returns 404 on invalid language.

```tsx
const LANGS = ['ca', 'es', 'en'] as const
type Lang = typeof LANGS[number]

// In route loader:
if (!LANGS.includes(params.lang)) throw notFound()
```

### Prospect page (`$lang/$slug.tsx`)

1. Server function calls `GET ${SERVER_URL}/pages/${slug}?lang=${lang}`
2. If page not published or not found → 404
3. Renders Tiptap JSON content by mapping block types to React components
4. Emits SEO tags from `meta` field
5. Fires `POST /pages/${slug}/view` on client load (fire-and-forget)

---

## Languages

| Code | Language          | Locale  |
| ---- | ----------------- | ------- |
| `ca` | Catalan (default) | `ca_ES` |
| `es` | Spanish           | `es_ES` |
| `en` | English           | `en_US` |

---

## SEO

Every prospect page emits:

```html
<html lang="ca">
<head>
  <title>{page.title}</title>
  <link rel="canonical" href="https://engranatge.com/ca/{slug}" />
  <link rel="alternate" hreflang="ca" href="https://engranatge.com/ca/{slug}" />
  <link rel="alternate" hreflang="es" href="https://engranatge.com/es/{slug}" />
  <link rel="alternate" hreflang="en" href="https://engranatge.com/en/{slug}" />
  <meta property="og:title" content="{meta.og_title}" />
  <meta property="og:description" content="{meta.og_description}" />
  <meta property="og:image" content="{meta.og_image}" />
  <meta property="og:locale" content="ca_ES" />
</head>
```

`hreflang` links are emitted only for translations that exist. The server returns available langs alongside the page content.

---

## Block rendering

Page content is Tiptap JSON with custom block nodes defined in `packages/ui/src/blocks/`. Each custom block maps to a React component in `src/components/blocks/`:

| Block type    | Component         | Renders                                                        |
| ------------- | ----------------- | -------------------------------------------------------------- |
| `hero`        | `Hero.tsx`        | Full-width hero: heading, subheading, CTA button               |
| `cta`         | `Cta.tsx`         | Call-to-action section with buttons (calendar, WhatsApp, etc.) |
| `valueProps`  | `ValueProps.tsx`  | Feature grid: title, body, optional image per item             |
| `painPoints`  | `PainPoints.tsx`  | Problem list: icon, title, body per item                       |
| `socialProof` | `SocialProof.tsx` | Testimonials: quote, author, company per item                  |

Standard Tiptap content (paragraphs, headings, lists, bold, italic) is rendered using `generateHTML()` from `@tiptap/html` with the shared extensions from `@engranatge/ui`.

### Rendering pattern

```tsx
import { generateHTML } from '@tiptap/html'
import StarterKit from '@tiptap/starter-kit'
import { allBlockExtensions } from '@engranatge/ui'

function PageContent({ doc }: { doc: TiptapDocument }) {
  // Custom blocks render via component map
  // Standard content renders via generateHTML
  return doc.content.map((node, i) => {
    const Block = BLOCK_MAP[node.type]
    if (Block) return <Block key={i} {...node.attrs} />
    // Standard rich text node
    return <RichText key={i} html={generateHTML({ type: 'doc', content: [node] }, [StarterKit, ...allBlockExtensions])} />
  })
}
```

---

## Tokens

Design tokens are imported from `@engranatge/ui/tokens.css`:

```css
/* src/styles/global.css */
@import '@engranatge/ui/tokens.css';
```

Same MD3 token system as `apps/internal` — see [frontend.md](frontend.md) for the full token reference.

---

## styled-components conventions

Same as `apps/internal` — see [frontend.md](frontend.md) § styled-components conventions. Key rules:

1. **Tokens always.** Use `var(--token)` — never hardcode.
2. **Co-locate styles.** Styled components live in the same `.tsx` file.
3. **Transient props.** Use `$` prefix for styling-only props.
4. **SSR.** styled-components handles server-side rendering automatically.

---

## Deployment

Deployed to Unikraft at `engranatge.com`:

```bash
pnpm --filter marketing build    # produces .output/server/index.mjs
kraft build                       # builds unikernel image
kraft deploy                      # deploys to Unikraft Cloud
```

Env vars:

```
SERVER_URL=https://api.engranatge.com
PORT=3000
```

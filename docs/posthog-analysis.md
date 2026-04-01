# PostHog Marketing Site: Deep Analysis

## 1. Overall Design Philosophy

PostHog's marketing site is a masterclass in **anti-corporate SaaS design** built on a single cohesive metaphor: **the entire site IS a retro PC operating system** called "PostHog 3000."

### The OS Desktop Metaphor (the real insight)

Every page is an "application" running inside their virtual OS:

| Element                                           | OS Equivalent                                         |
| ------------------------------------------------- | ----------------------------------------------------- |
| Window chrome (title bars, close/min/max buttons) | Every content area is framed as a window              |
| Left sidebar with folder icons                    | File browser / Finder                                 |
| `home.mdx` filename labels                        | Files open in an editor                               |
| `posts.psheet` blog                               | Spreadsheet app (with toolbar: bold, italic, filters) |
| Docs icon grid                                    | File manager / desktop icons                          |
| Isometric pixel art header                        | Desktop wallpaper                                     |
| `skin-modern` / `skin-classic` Tailwind variants  | OS theme customization (like Windows XP skins)        |
| `body[data-wallpaper]` attribute                  | Changeable desktop wallpaper                          |
| CD jewel case pricing                             | Boxed software from a store                           |
| "Digital download*" disclaimers                   | Physical software era nostalgia                       |

This metaphor is what gives PostHog its distinctive feel. Not just the colors or typography — the **conceptual layer** that makes every design decision coherent.

### Supporting Principles

- **Playful irreverence**: Hedgehog mascot in every situation, fake e-commerce carts, "Not endorsed by Kim K" badges, intentional typos
- **Radical transparency**: Links to salary data, sales playbooks, company strategy
- **Content-dense but scannable**: Heavy use of tabs, accordions, and visual hierarchy

---

## 2. Technical Stack

| Aspect                | Technology                                                                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Framework**         | Gatsby 4.25.9 (React SSG)                                                                                                                                    |
| **CSS**               | Tailwind CSS + plugins: `@tailwindcss/forms`, `@headlessui/tailwindcss`, `@tailwindcss/container-queries`, `tailwindcss-animated`, `@tailwindcss/typography` |
| **Class composition** | `cntl` tagged template literals for composing Tailwind class strings                                                                                         |
| **Images**            | Cloudinary CDN (`cloudinary-react`) with dynamic transforms                                                                                                  |
| **Fonts**             | IBM Plex Sans Variable (primary), Source Code Pro (code), Charter (serif), Open Runde (rounded)                                                              |
| **UI Libraries**      | Radix UI (accordions, toasts), HeadlessUI, react-popper                                                                                                      |
| **Hosting**           | Cloud-based, US + EU regions                                                                                                                                 |
| **Theme**             | Light/dark via `darkMode: 'class'`, warm earth tones, skin/wallpaper system via `body[data-skin]`                                                            |

---

## 3. Color System

### CSS Custom Properties Pattern

Colors use `rgb(var(--name) / <alpha-value>)` enabling Tailwind opacity modifiers on theme tokens:

```css
--bg, --accent, --border
--input-bg, --input-bg-hover, --input-border, --input-border-hover
--text-primary, --text-secondary, --text-muted
```

### Full Neutral Scale (light-1 through light-12)

```
light-1:  #FDFDF8  (lightest, near-white)
light-2:  #EEEFE9  (page background)
light-3:  #E5E7E0  (accent/surface)
light-11: #4D4F46  (primary text)
light-12: #23251D  (darkest, near-black)
```

### Brand/Accent Colors

```
orange:   #EB9D2A  (primary CTA)
blue:     #2F80FA
red:      #F54E00
green:    #6AA84F
purple:   #B62AD9
yellow:   #F7A501
teal:     #29DBBB
pink:     #E34C6F
```

### Button-Specific Colors

```
button-shadow: #CD8407  (3D bottom edge)
button-border: #B17816
highlight:     rgba(235,157,42,.2)  (orange tint)
```

### Footer

```
footer:   #08042f  (deep navy, almost black)
```

### Design Notes

- **No blue for CTAs** - breaks SaaS convention completely
- Warm earth tones create approachability and distinction
- Text is never pure black (#000) -- always warm gray (#4D4F46)
- CTA buttons use amber (#EB9D2A) with black text for maximum contrast
- Background is subtly textured/noisy, not flat white
- Dark mode supported via `darkMode: 'class'` toggle

---

## 4. Typography System

### Font Families (from tailwind.config.js)

```css
/* Primary (headings + body + nav + buttons) */
font-sans:    "IBM Plex Sans Variable", "IBM Plex Sans", -apple-system, ..., sans-serif;
font-button:  "IBM Plex Sans Variable", "IBM Plex Sans", sans-serif;
font-nav:     "IBM Plex Sans Variable", "IBM Plex Sans", sans-serif;

/* Code */
font-code:    "Source Code Pro", Menlo, Consolas, monaco, monospace;

/* Decorative */
font-serif:   Charter, MatterVF, Arial, Helvetica, sans-serif;
font-rounded: "Open Runde", sans-serif;
font-comic:   "Comic Sans MS", ...;  /* easter eggs */
font-os:      system font stack;
```

### Section Heading Scale (from Section component)

| Size | Mobile     | Desktop       |
| ---- | ---------- | ------------- |
| `sm` | `text-2xl` | `text-[30px]` |
| `md` | `text-3xl` | `text-[48px]` |
| `lg` | `text-4xl` | `text-[64px]` |

### Rendered Sizes

| Element            | Size            |
| ------------------ | --------------- |
| H1 (hero, home)    | 30px            |
| H1 (product pages) | 60px            |
| H2                 | 21-36px         |
| Body               | 16px            |
| Tiny (`2xs`)       | 10px (0.625rem) |

### Characteristics

- Single font family for headings AND body (IBM Plex Sans Variable)
- Heavy use of **bold** for emphasis within paragraphs
- Italic used sparingly for editorial voice
- Line-heights are generous (1.5-1.7 for body)
- Headings use tighter line-height (~1.2)

---

## 5. Layout System

### Container Widths (Section component)

| Size   | Max-Width                       |
| ------ | ------------------------------- |
| `full` | None (full bleed)               |
| `sm`   | `max-w-[600px]`                 |
| `md`   | `max-w-[800px]`                 |
| `lg`   | `max-w-[1200px]` (main content) |
| outer  | `max-w-7xl` (1280px)            |

Also uses a 16-column sub-grid: `grid-template-columns: repeat(16, minmax(0, 1fr))`

### Grid Patterns (Section component responsive cols)

```
2 cols: grid-cols-1 sm:grid-cols-2
3 cols: grid-cols-1 md:grid-cols-3
4 cols: grid-cols-1 sm:grid-cols-2 lg:grid-cols-4
5 cols: grid-cols-1 sm:grid-cols-2 lg:grid-cols-5
```

Custom flex values: `flex-1/3: '0 0 33%'`, `flex-2/3: '0 0 66%'`, `flex-half: '0 0 49%'`

### Responsive Breakpoints (from tailwind.config.js)

| Token        | Width                 | Notes                             |
| ------------ | --------------------- | --------------------------------- |
| `2xs`        | 425px                 | Small mobile                      |
| `xs`         | 482px                 | Large mobile                      |
| `sm`         | 640px                 | Phablet                           |
| `md`         | 768px                 | Tablet                            |
| `mdlg`       | 900px                 | Custom - pricing plans            |
| `lg`         | 1024px                | Small desktop                     |
| `lgxl`       | 1160px                | Custom - wider desktop            |
| `xl`         | 1280px                | Desktop                           |
| `2xl`        | 1536px                | Large desktop                     |
| `reasonable` | `(min-height: 640px)` | Raw media query for short screens |

### Section Pattern

```html
<section>  <!-- full-width background -->
  <div class="max-w-[1200px] mx-auto">  <!-- centered content -->
    <h2>Section heading</h2>             <!-- optional, 3 sizes -->
    <div class="grid grid-cols-...">     <!-- responsive grid -->
      <!-- section body -->
    </div>
    <a>CTA link</a>                      <!-- optional -->
  </div>
</section>
```

---

## 6. Component Patterns

### Buttons (CallToAction component)

**4 variants** (`primary`, `secondary`, `outline`, `custom`) x **5 sizes** (`xs`, `sm`, `md`, `lg`, `absurd`)

**3D press effect** - the signature interaction:

```
Container: bg-button-shadow (#CD8407), border-button (#B17816)
Child:     bg-orange (#EB9D2A), text-black
           -translate-y-1     (default: raised)
           hover:-translate-y-1.5  (hover: more raised)
           active:-translate-y-0.5 (click: pressed down)
```

The container's darker background peeks out as a "shadow" bottom edge, creating a physical, tactile button feel.

- **Primary**: `bg-orange text-black border-button`
- **Secondary**: `bg-white text-primary border-button`
- **Ghost/Link**: Text-only with arrow indicators

### Cards

- Subtle borders or background differentiation
- Rounded corners (4-8px)
- Content-first: text > imagery
- Often include icons or small illustrations

### Tabs

- Horizontal scrolling tab bars (prominent pattern)
- Used for: product categories, feature showcases, customer segments
- Active tab has visual indicator (underline/background change)

### Tables

- Clean, minimal borders
- Alternating row patterns on blog (spreadsheet aesthetic)
- Feature comparison tables with checkmarks

### Navigation (Header + MainNav)

- **Sticky**: `sticky top-0 z-[9999999]`
- **Frosted glass**: `backdrop-blur` effect on scroll
- Logo left, nav links center (Product OS, Pricing, Docs, Community, Company), CTA right
- Mega-menu dropdowns with `react-popper` positioning
- **InternalMenu** (secondary horizontal nav below main): snap-scrolling with gradient fade masks on edges, uses `react-intersection-observer` for overflow detection
- Mobile: separate `<Mobile>` component as bottom tab bar
- Easter eggs: "Hedgehog mode", "Theo mode" (clutter-free), enterprise mode renames nav items
- Active state: `ActiveBackground` absolute-positioned highlight component

### Footer (6 link groups)

| Column     | Links                                                       |
| ---------- | ----------------------------------------------------------- |
| Products   | 16 links (all products, pricing, founder stack, etc.)       |
| Product OS | 7 links (SDKs, frameworks, API, toolbar)                    |
| Docs       | 9 links (per-product docs)                                  |
| Community  | 13 links (questions, guides, merch, newsletter, PostHog FM) |
| Handbook   | 9 links (values, engineering, brand, marketing)             |
| Company    | 12 links (about, roadmap, changelog, careers, security)     |

Background: `#08042f` (deep navy). Social: X, LinkedIn, YouTube, GitHub.

### "Shameless CTA" (unique)

- Fake e-commerce product card (CD jewel case design)
- Mock pricing ($0 strikethrough), fake urgency ("1 left at this price!!")
- Region selector (US/EU)
- Parody of conversion tactics while actually converting

---

## 7. Animation & Advanced CSS

### Named Animations (from tailwind.config.js, 20+)

| Animation                      | Effect                                           | Duration           |
| ------------------------------ | ------------------------------------------------ | ------------------ |
| `wiggle`                       | Rotation oscillation                             | 0.2s, 3 iterations |
| `grow` / `grow-sm`             | Scale pulse                                      | 2-3s infinite      |
| `flash`                        | Quick scale bump                                 | 1s, 2 iterations   |
| `reveal`                       | max-height 0 -> 1000px                           | transition         |
| `develop`                      | Grayscale+brightness -> full color               | 1.5s               |
| `slideDown` / `slideUp`        | Accordion via `--radix-accordion-content-height` | transition         |
| `wobble`                       | Translate + rotate oscillation                   | loop               |
| `slideIn` / `swipeOut`         | Toast notifications                              | 150ms              |
| `spin-slow`                    | Slow rotation                                    | 4s                 |
| `gradient-rotate`              | Background-position animation                    | loop               |
| `slide-up-fade-in/out`         | 300ms slide + opacity                            | 300ms              |
| `float`                        | Gentle vertical hover (translateY)               | loop               |
| `breathe`                      | Subtle scale oscillation                         | loop               |
| `text-gradient`                | Background-position for gradient text            | loop               |
| `svg-stroke-dashoffset-around` | SVG stroke drawing                               | 2.5s               |

### Advanced CSS Techniques

**Multi-gradient backgrounds per product area:**

```css
/* bg-ai: 7 overlapping radial gradients creating organic color field */
background: radial-gradient(...), radial-gradient(...), ...;
```

Each product area (AI, LLM analytics, trace monitoring, cost analysis) has unique multi-gradient compositions.

**SVG data URI backgrounds**: Bullet points, checkmarks, chevrons defined as base64 SVG data URIs in Tailwind's `backgroundImage`, with separate light/dark variants.

**Skin/wallpaper theming system**: Custom Tailwind variants respond to `body[data-skin]` and `body[data-wallpaper]` data attributes, allowing site-wide appearance changes.

**Container queries**: `@tailwindcss/container-queries` plugin with `.container-size` utility for `container-type: size`.

---

## 8. Image & Media Strategy

### Cloudinary CDN

All images served via Cloudinary with dynamic transforms:

```
https://res.cloudinary.com/dmukukwp6/image/upload/
  c_scale,w_2574/     -- scale to width
  f_auto/              -- auto format (WebP/AVIF)
  q_auto/              -- auto quality
  c_fill,g_auto/       -- smart crop
```

### Image Types

1. **Hedgehog illustrations**: Custom hand-drawn mascots for every context (presenting, sleeping, reading, etc.)
2. **Product screenshots**: Large, high-res app screenshots
3. **Team photos**: Real photos of team members, not stock
4. **Decorative**: Isometric pixel art (docs page header), retro game-style graphics
5. **Customer logos**: Grayscale/muted, with shuffle animation

### Lazy Loading

- Images use `loading="lazy"` attribute
- Gatsby image optimization (blur-up placeholders)
- Responsive srcset for different viewport sizes

---

## 9. Page-by-Page Analysis

### Homepage (/)

**Sections flow:**

1. Hero: "We make dev tools..." + dual CTA (Get started / Install with AI)
2. Product tabs: Startup/Growth/Scale tiers with horizontally scrollable product cards
3. Social proof: Customer logos with shuffle
4. Data Stack: Text-heavy section with Cloudinary illustration
5. Pricing summary: 4-row table with free tiers
6. AI section: Brief pitch
7. Why PostHog: Bullet points with links to handbook
8. Bedtime reading: Casual link list
9. Shameless CTA: Fake e-commerce card

### Product Pages (/product-analytics, etc.)

**Sections flow:**

1. Hero: Product name + single line + screenshot
2. Customer testimonials: Card carousel
3. Features: Tabbed showcase (Funnels/Graphs/Lifecycle/etc.)
4. AI integration pitch
5. Demo video embed
6. FAQ/Accordion expandable answers
7. Pricing table
8. Competitor comparison table
9. Documentation links
10. Paired products
11. Creative CTA (paint program mockup, motivational poster)

### Pricing (/pricing)

- CD jewel case product imagery (creative)
- Clean free vs paid comparison
- Interactive pricing calculator with sliders
- Volume discount tiers in expandable rows
- FAQ with team member avatars answering
- Competitor comparison grid
- The shameless CTA section

### Blog (/blog)

- **Spreadsheet/table layout** (unique approach)
- Columns: Date, Title, Tags, Author(s) with avatar
- Filterable by category, tags, author
- Sort controls
- Blog title uses "posts.psheet" filename reference
- Thumbnails are small, content-focused

### Docs (/docs)

- **Isometric pixel art office** as page header (most distinctive visual)
- Search bar prominently placed
- Icon-based category grid
- 3-column layout: sidebar nav + content + right sidebar
- Clean, functional, information-dense
- "Ask AI" integration

### About (/about)

- **Long-form editorial** feel, like a company manifesto
- "From the desk of" header (newsletter vibe)
- Mixed text + callout illustrations
- Team Tulum photo
- Stats woven into narrative (190254+ teams)
- Merch section at bottom

---

## 10. Key Design Techniques Worth Adopting

### The lesson for Engranatge:

**PostHog's power is the metaphor, not the pixels.** Every color, animation, and layout choice serves the "this is an OS" concept. Engranatge needs an equally strong central metaphor — see [brand-proposal.md](brand-proposal.md) for the **Workshop / Taller** concept.

Patterns to adopt (translated to our context):

1. **Central metaphor** — PostHog = OS. Engranatge = Workshop. Commit fully.
2. **Warm, non-SaaS palette** — They use earth tones. We use Mediterranean industrial (terracotta, olive, warm cream).
3. **A mascot with personality** — Their hedgehog. Our gear character (Roda).
4. **Honest, anti-bullshit tone** — They say "a competitor might be better if...". We say "this won't work for everyone."
5. **Single accent color for CTAs** — Their amber. Our terracotta.
6. **Content framed by the metaphor** — Their blog IS a spreadsheet app. Our blog IS a workshop logbook.
7. **Page-specific UI** — Each PostHog page looks like a different app. Each Engranatge page should look like a different part of the workshop.
8. **3D tactile buttons** — Their translate-y press effect. We should have something equally physical (lever, switch, dial).

### What NOT to copy:

- **Page length** — PostHog pages are extremely long. Local SMBs won't scroll that far. Keep it tight.
- **Technical depth** — PostHog shows SQL and API docs. We show results and hours saved.
- **Self-referential humor** — PostHog jokes about SaaS conventions. Our audience doesn't know SaaS conventions. Our humor is about the frustrations of running a small business.
- **Developer aesthetic** — Filenames and code terminals won't resonate with a restaurant owner. Blueprints and control panels will.
- **English-first** — We're Catalan-first.

---

## 11. Pretext Integration Considerations

### What Pretext Actually Is

Pretext (`@chenglou/pretext`) by Cheng Lou is NOT a fluid CSS layout library. It is a **DOM-free text measurement engine** for predicting text heights without triggering browser reflow.

### Core API

```ts
// Phase 1: Expensive, cached (run once per text+font combo)
const prepared = prepare(text, '16px Inter')

// Phase 2: Cheap, arithmetic only (~0.0002ms per block)
const { height, lineCount } = layout(prepared, containerWidth, 24)
```

### What It Solves

- Predicts multiline text height without DOM measurement
- Enables reflow-free masonry/card layouts
- Handles all scripts (CJK, Arabic, Thai) via Intl.Segmenter
- Uses Canvas measureText as ground truth, then pure arithmetic on resize
- Browser-only (needs Canvas + Intl.Segmenter)

### Use Cases for a Marketing Site

1. **Masonry blog/card layouts**: Know card heights before rendering, preventing layout shift
2. **Accordion panels**: Calculate expanded heights without DOM reads
3. **Fluid text containers**: Binary-search tightest container width (shrinkwrap)
4. **Variable-width editorial layouts**: Text flowing around images/obstacles
5. **Virtualized lists**: Accurate row heights for virtual scrolling

### Important Caveat

Pretext is about **text height prediction**, not fluid responsive design (like CSS clamp/vw units). For a marketing site, it would mainly help with:

- CLS (Cumulative Layout Shift) elimination
- Smooth resize animations without jank
- Complex masonry/editorial layouts

For fluid typography (text that scales with viewport), you'd still use CSS `clamp()` or similar approaches. Pretext complements that by telling you the resulting heights.

### Integration Pattern (React/Next.js)

```tsx
import { prepare, layout } from '@chenglou/pretext'

function Card({ text }) {
  const prepared = useMemo(() => prepare(text, '16px Inter'), [text])
  const [width, setWidth] = useState(0)
  const ref = useRef()

  useResizeObserver(ref, (entry) => setWidth(entry.contentRect.width))

  const { height } = layout(prepared, width, 24)

  return (
    <div ref={ref} style={{ height }}>
      <p>{text}</p>
    </div>
  )
}
```

# Forja — Build Plan

Full scaffold for a B2B prospecting CRM + automation platform.
Brand: **Engranatge** (`engranatge.com`)
Domains: `engranatge.com` (marketing) · `batuda.co` (internal) · `api.batuda.co` (server)

---

## Stack

| Layer              | Technology                                                 |
| ------------------ | ---------------------------------------------------------- |
| Monorepo           | pnpm workspaces                                            |
| Dev environment    | Nix flake (Node 24 + pnpm + kraft)                         |
| Backend            | Effect HTTP server + MCP server                            |
| Internal frontend  | `apps/internal` — TanStack Start → Unikraft (Node.js SSR)  |
| Marketing frontend | `apps/marketing` — TanStack Start → Unikraft (Node.js SSR) |
| Shared UI          | `packages/ui` — design tokens + Tiptap block extensions    |
| Database           | NeonDB (Postgres) via Effect SQL                           |
| Deploy             | Unikraft (kraft CLI) — both server and web                 |
| Auth               | API keys (hashed, per integration)                         |
| AI access          | MCP stdio (Claude Code) + HTTP/SSE (Claude.ai, ChatGPT)    |

---

## Directory Tree

```
batuda/
├── apps/
│   ├── server/                   # Effect: HTTP API + MCP server
│   │   ├── src/
│   │   │   ├── main.ts           # HTTP server entry (Unikraft deploy)
│   │   │   ├── mcp-stdio.ts      # MCP stdio entry (Claude Code)
│   │   │   ├── db/
│   │   │   │   └── client.ts     # PgClient + Effect SQL connection
│   │   │   ├── routes/
│   │   │   │   ├── companies.ts
│   │   │   │   ├── contacts.ts
│   │   │   │   ├── interactions.ts
│   │   │   │   ├── tasks.ts
│   │   │   │   ├── proposals.ts
│   │   │   │   ├── products.ts
│   │   │   │   ├── documents.ts
│   │   │   │   ├── pages.ts
│   │   │   │   └── webhooks.ts
│   │   │   ├── mcp/
│   │   │   │   ├── server.ts     # McpServer setup
│   │   │   │   ├── tools/
│   │   │   │   │   ├── companies.ts
│   │   │   │   │   ├── contacts.ts
│   │   │   │   │   ├── interactions.ts
│   │   │   │   │   ├── tasks.ts
│   │   │   │   │   ├── documents.ts
│   │   │   │   │   ├── pages.ts
│   │   │   │   │   └── pipeline.ts
│   │   │   │   └── resources/
│   │   │   │       ├── company.ts
│   │   │   │       └── pipeline.ts
│   │   │   ├── middleware/
│   │   │   │   └── api-key.ts    # HttpApiSecurity.apiKey
│   │   │   └── services/
│   │   │       ├── companies.ts
│   │   │       ├── email.ts          # Resend: send + inbound reply handling
│   │   │       ├── pages.ts          # page CRUD + view tracking
│   │   │       ├── webhooks.ts
│   │   │       └── pipeline.ts
│   │   ├── Kraftfile             # Unikraft build definition
│   │   ├── Dockerfile            # Two-stage Node 24 build for Unikraft
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── internal/                 # Forja — internal sales tool (batuda.co)
│   │   ├── src/
│   │   │   ├── router.tsx              # createRouter + routeTree.gen
│   │   │   ├── routes/
│   │   │   │   ├── __root.tsx
│   │   │   │   ├── index.tsx           # Pipeline dashboard
│   │   │   │   ├── companies/
│   │   │   │   │   ├── index.tsx       # Company list
│   │   │   │   │   └── $slug.tsx       # Company detail
│   │   │   │   └── tasks/
│   │   │   │       └── index.tsx       # Today's next steps
│   │   │   ├── components/
│   │   │   │   ├── pri/               # Pri* primitives (BaseUI + styled-components)
│   │   │   │   │   ├── PriButton.tsx
│   │   │   │   │   ├── PriInput.tsx
│   │   │   │   │   ├── PriSelect.tsx
│   │   │   │   │   ├── PriDialog.tsx
│   │   │   │   │   ├── PriTabs.tsx
│   │   │   │   │   ├── PriCheckbox.tsx
│   │   │   │   │   └── PriMenu.tsx
│   │   │   │   ├── Pipeline.tsx
│   │   │   │   ├── CompanyCard.tsx
│   │   │   │   ├── StatusBadge.tsx
│   │   │   │   ├── CompanyMap.tsx       # react-map-gl + MapLibre
│   │   │   │   └── TaskList.tsx
│   │   │   ├── lib/
│   │   │   │   └── api.ts              # Typed client → server
│   │   │   └── styles/
│   │   │       └── global.css          # imports @engranatge/ui tokens
│   │   ├── vite.config.ts              # Vite + tanstackStart()
│   │   ├── Dockerfile                  # Two-stage Node 24 build
│   │   ├── Kraftfile                   # Unikraft deploy config
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── marketing/                # Engranatge — public site (engranatge.com)
│       ├── src/
│       │   ├── router.tsx              # createRouter + routeTree.gen
│       │   ├── routes/
│       │   │   ├── __root.tsx
│       │   │   ├── index.tsx           # Marketing homepage
│       │   │   ├── $lang.tsx           # Language layout (ca/es/en)
│       │   │   └── $lang/
│       │   │       ├── index.tsx       # /:lang landing
│       │   │       └── $slug.tsx       # /:lang/:slug prospect page
│       │   ├── components/
│       │   │   └── blocks/            # Tiptap block renderers
│       │   │       ├── Hero.tsx
│       │   │       ├── PainPoints.tsx
│       │   │       ├── ValueProps.tsx
│       │   │       ├── SocialProof.tsx
│       │   │       ├── Cta.tsx
│       │   │       └── RichText.tsx
│       │   ├── lib/
│       │   │   └── api.ts              # Typed client → server
│       │   └── styles/
│       │       └── global.css          # imports @engranatge/ui tokens
│       ├── vite.config.ts
│       ├── Dockerfile
│       ├── Kraftfile
│       ├── package.json
│       └── tsconfig.json
│
├── packages/
│   ├── domain/                   # Shared: Effect Schema types
│   │   ├── src/
│   │   │   ├── schema/
│   │   │   │   ├── companies.ts
│   │   │   │   ├── contacts.ts
│   │   │   │   ├── interactions.ts
│   │   │   │   ├── tasks.ts
│   │   │   │   ├── products.ts
│   │   │   │   ├── proposals.ts
│   │   │   │   ├── documents.ts
│   │   │   │   ├── pages.ts
│   │   │   │   ├── api-keys.ts
│   │   │   │   ├── webhook-endpoints.ts
│   │   │   │   └── index.ts            # re-exports all tables
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── ui/                       # Shared: design tokens + Tiptap block extensions
│       ├── src/
│       │   ├── tokens.css              # MD3 tokens: typography, color, spacing, shape
│       │   ├── blocks/                 # Tiptap custom node extensions
│       │   │   ├── hero.ts
│       │   │   ├── cta.ts
│       │   │   ├── value-props.ts
│       │   │   ├── social-proof.ts
│       │   │   ├── pain-points.ts
│       │   │   └── index.ts
│       │   └── index.ts
│       ├── package.json
│       └── tsconfig.json
│
├── flake.nix
├── flake.lock                    # generated: run `nix flake update`
├── .envrc                        # direnv: `use flake`
├── biome.json                    # linting + formatting for all packages
├── dprint.json                   # markdown formatting
├── turbo.json                    # Turborepo task caching
├── syncpack.config.js            # dependency version consistency
├── lefthook.yml                  # git hooks
├── tsconfig.base.json            # shared TS config — all packages extend this
├── pnpm-workspace.yaml
├── package.json                  # root: scripts + devDeps
├── .mcp.json
├── .env.example
├── .gitignore
└── PLAN.md                       # this file
```

---

## Phase 1 — Repo Init

### Commands

```bash
cd /Users/guillem/programacio/codi/autonom/batuda
git init
```

### `/pnpm-workspace.yaml`

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

### `/package.json`

```json
{
  "name": "forja",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=24",
    "pnpm": ">=10"
  },
  "scripts": {
    "dev:server": "pnpm --filter server dev",
    "dev:internal": "pnpm --filter internal dev",
    "dev:marketing": "pnpm --filter marketing dev",
    "build": "turbo build",
    "check-types": "turbo check-types",
    "lint": "turbo lint",
    "lint-biome": "biome check --write",
    "lint-syncpack": "syncpack format && syncpack fix-mismatches",
    "format": "biome check --write . && dprint fmt",
    "check": "biome check .",
    "check-deps": "syncpack lint",
    "db:generate": "pnpm --filter domain db:generate",
    "db:migrate": "pnpm --filter domain db:migrate",
    "db:studio": "pnpm --filter domain db:studio",
    "prepare": "lefthook install"
  },
  "devDependencies": {
    "@biomejs/biome": "2.4.10",
    "lefthook": "2.1.4",
    "syncpack": "14.3.0",
    "turbo": "2.9.1",
    "typescript": "6.0.2"
  }
}
```

### `/tsconfig.base.json`

Shared base — all packages extend this. Maximum strictness, bundler-mode (no `.js` extensions needed in imports).

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",

    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "noPropertyAccessFromIndexSignature": true,
    "noImplicitReturns": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "allowUnreachableCode": false,
    "allowUnusedLabels": false,
    "forceConsistentCasingInFileNames": true,

    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "isolatedDeclarations": true,
    "erasableSyntaxOnly": true,
    "noUncheckedSideEffectImports": true,

    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

- `"strict": true` — enables all 9 strict-family flags (noImplicitAny, strictNullChecks, strictFunctionTypes, strictBindCallApply, strictPropertyInitialization, strictBuiltinIteratorReturn, noImplicitThis, useUnknownInCatchVariables, alwaysStrict)
- `"noUncheckedIndexedAccess"` — array/object index access returns `T | undefined`
- `"exactOptionalPropertyTypes"` — `{ a?: string }` means absent, not `undefined`
- `"noPropertyAccessFromIndexSignature"` — force `obj["key"]` for index signature keys
- `"isolatedDeclarations"` — exports must have explicit type annotations
- `"erasableSyntaxOnly"` — no enums, namespaces, or parameter properties (Node type-stripping compatible)
- `"noUncheckedSideEffectImports"` — verify side-effect imports resolve to real files
- `"verbatimModuleSyntax"` — enforces `import type` for type-only imports

### `/biome.json`

```json
{
  "$schema": "https://biomejs.dev/schemas/2.4.10/schema.json",
  "vcs": {
    "enabled": true,
    "clientKind": "git",
    "useIgnoreFile": true
  },
  "files": {
    "includes": [
      "**",
      "!dist",
      "!.output",
      "!.wrangler",
      "!migrations",
      "!node_modules",
      "!.cache",
      "!flake.lock",
      "!flake.nix",
      "!**/package.json"
    ],
    "ignoreUnknown": true
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "tab",
    "indentWidth": 2,
    "lineWidth": 80,
    "lineEnding": "lf"
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "correctness": {
        "useExhaustiveDependencies": "warn"
      },
      "performance": {
        "noAccumulatingSpread": "warn"
      },
      "style": {
        "noNonNullAssertion": "warn"
      },
      "suspicious": {
        "noConsole": {
          "level": "warn",
          "options": {
            "allow": ["error", "warn"]
          }
        }
      }
    }
  },
  "assist": {
    "actions": {
      "source": {
        "organizeImports": {
          "level": "on",
          "options": {
            "groups": [
              [":NODE:", ":BUN:", ":URL:", ":PACKAGE_WITH_PROTOCOL:", ":PACKAGE:"],
              ":BLANK_LINE:",
              [":ALIAS:", ":PATH:"]
            ]
          }
        }
      }
    }
  },
  "css": {
    "formatter": {
      "enabled": true
    }
  },
  "javascript": {
    "formatter": {
      "arrowParentheses": "asNeeded",
      "quoteStyle": "single",
      "jsxQuoteStyle": "single",
      "semicolons": "asNeeded"
    }
  },
  "json": {
    "parser": {
      "allowComments": true
    }
  },
  "overrides": [
    {
      "includes": ["**/test/**", "**/*.test.ts", "**/*.test.tsx"],
      "linter": {
        "rules": {
          "style": {
            "noNonNullAssertion": "off"
          },
          "suspicious": {
            "noConsole": "off",
            "noExplicitAny": "warn"
          }
        }
      }
    }
  ]
}
```

### `/turbo.json`

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "inputs": ["$TURBO_DEFAULT$", ".env*"],
      "outputs": ["dist/**/*"]
    },
    "check-deps": {
      "outputs": [],
      "cache": true
    },
    "check-types": {
      "dependsOn": ["^check-types"],
      "outputs": ["tsconfig.tsbuildinfo"]
    },
    "lint": {
      "outputs": [],
      "cache": true
    },
    "test": {
      "dependsOn": ["^build"],
      "inputs": [
        "$TURBO_DEFAULT$",
        "src/**/*",
        "test/**/*",
        "**/*.test.*",
        "**/*.spec.*"
      ],
      "outputs": ["coverage/**/*"],
      "cache": true
    }
  }
}
```

### `/syncpack.config.js`

```javascript
/** @type {import("syncpack").RcFile} */
export default {
  dependencyTypes: ['dev', 'prod', 'overrides', 'peer', 'resolutions'],
  filter: '.',
  indent: '\t',
  versionGroups: [
    {
      label: 'TypeScript',
      dependencies: ['typescript'],
    },
    {
      label: 'Forja',
      dependencies: ['@engranatge/*'],
      policy: 'sameRange',
    },
    {
      label: 'React',
      dependencies: ['react', 'react-dom'],
      isIgnored: true,
    },
    {
      label: 'React types',
      dependencies: ['@types/react*'],
      policy: 'sameRange',
    },
    {
      label: 'Effect',
      dependencies: ['effect', '@effect/*'],
      policy: 'sameRange',
    },
    {
      label: 'Effect SQL',
      dependencies: ['@effect/sql-pg'],
      policy: 'sameRange',
    },
    {
      label: 'TanStack',
      dependencies: ['@tanstack/*'],
      policy: 'sameRange',
    },
    {
      label: 'Testing',
      dependencies: ['vitest', '@vitest/*', '@testing-library/*'],
      policy: 'sameRange',
    },
  ],
  sortAz: [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'resolutions',
  ],
  sortFirst: [
    'name',
    'version',
    'description',
    'type',
    'types',
    'module',
    'main',
    'exports',
    'engines',
    'scripts',
    'dependencies',
    'peerDependencies',
    'devDependencies',
    'resolutions',
    'private',
  ],
  sortPackages: true,
  source: [
    'package.json',
    'apps/*/package.json',
    'packages/*/package.json',
  ],
}
```

### `/lefthook.yml`

```yaml
pre-commit:
  commands:
    check-deps:
      run: |
        pnpm check-deps
      stage_fixed: true

    check-types:
      run: |
        pnpm check-types

    lint:
      run: |
        pnpm lint-biome {staged_files}
      stage_fixed: true

    format-packages:
      run: |
        pnpm lint-syncpack
      stage_fixed: true

    format-markdown:
      glob: "**/*.md"
      run: |
        dprint fmt --config dprint.json --allow-no-files {staged_files}
      stage_fixed: true

pre-push:
  commands:
    test:
      run: |
        pnpm turbo test
```

### `/dprint.json`

```json
{
  "markdown": {
    "textWrap": "maintain",
    "emphasisKind": "asterisks",
    "strongKind": "asterisks",
    "newLineKind": "lf"
  },
  "includes": ["**/*.md"],
  "excludes": [
    "node_modules",
    "dist",
    ".output",
    ".wrangler",
    ".cache",
    ".turbo",
    "coverage",
    "**/CHANGELOG.md"
  ],
  "plugins": ["https://plugins.dprint.dev/markdown-0.21.1.wasm"]
}
```

### `/.gitignore`

```
node_modules/
dist/
.env
.env.local
*.db
.wrangler/
.cache/
.output/
.turbo/
```

### `/.env.example`

```
# NeonDB
DATABASE_URL=postgres://user:pass@ep-xxx.us-east-2.aws.neon.tech/forja?sslmode=require

# API key for MCP remote (Claude.ai, ChatGPT)
MCP_SECRET=change-me

# Server
PORT=3000
```

---

## Phase 2 — Nix Flake + direnv

### `/flake.nix`

```nix
{
  description = "Forja — B2B prospecting platform";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = [
            pkgs.nodejs_24
            pkgs.nodePackages.pnpm
            pkgs.dprint
          ];

          shellHook = ''
            echo "Forja dev environment"
            echo "Node: $(node --version)"
            echo "pnpm: $(pnpm --version)"
          '';
        };
      }
    );
}
```

### `/.envrc`

```
use flake
```

Run `direnv allow` after cloning. The environment activates automatically on `cd`.

---

## Phase 3 — packages/domain

### `packages/domain/package.json`

```json
{
  "name": "@engranatge/domain",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsdown",
    "build": "tsdown"
  },
  "dependencies": {
    "effect": "^4.0.0-beta.43"
  },
  "devDependencies": {
    "tsdown": "^0.21.7",
    "typescript": "^6.0.2",
    "dotenv": "^17.3.1"
  }
}
```

### `packages/domain/tsconfig.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ESNext"],
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

<!-- drizzle.config.ts removed — migrations handled by Effect SQL Migrator -->

### `packages/domain/src/schema/companies.ts`

```typescript
// Schema now uses Effect Schema (see packages/domain/src/schema/companies.ts)

export const companies = pgTable('companies', {
  id:              uuid('id').primaryKey().defaultRandom(),
  slug:            text('slug').notNull().unique(),
  name:            text('name').notNull(),

  // Pipeline
  status:          text('status').notNull().default('prospect'),
  // values: prospect | contacted | responded | meeting
  //         | proposal | client | closed | dead

  // Classification
  industry:        text('industry'),
  // values: restauració | construcció | retail | manufactura
  //         | serveis | hostaleria | distribució | transport | other
  sizeRange:       text('size_range'),
  // values: 1-5 | 6-10 | 11-25 | 26-50 | 51-200
  region:          text('region'),
  // values: cat | ara | cv
  location:        text('location'),
  source:          text('source'),
  // values: firecrawl | exa | google_maps | referral
  //         | linkedin | instagram | manual
  priority:        integer('priority').default(2),
  // values: 1 (hot) | 2 (medium) | 3 (cold)

  // Contact info
  website:         text('website'),
  email:           text('email'),
  phone:           text('phone'),
  instagram:       text('instagram'),
  linkedin:        text('linkedin'),
  googleMapsUrl:   text('google_maps_url'),

  // Sales intel
  productsFit:     text('products_fit').array(),
  tags:            text('tags').array(),
  painPoints:      text('pain_points'),
  currentTools:    text('current_tools'),

  // Next action
  nextAction:      text('next_action'),
  nextActionAt:    timestamp('next_action_at'),
  lastContactedAt: timestamp('last_contacted_at'),

  // Catch-all for evolving data
  metadata:        jsonb('metadata'),

  createdAt:       timestamp('created_at').defaultNow().notNull(),
  updatedAt:       timestamp('updated_at').defaultNow().notNull(),
})
```

### `packages/domain/src/schema/contacts.ts`

```typescript
// Schema now uses Effect Schema (see packages/domain/src/schema/)
import { companies } from './companies'

export const contacts = pgTable('contacts', {
  id:              uuid('id').primaryKey().defaultRandom(),
  companyId:       uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),

  name:            text('name').notNull(),
  role:            text('role'),
  isDecisionMaker: boolean('is_decision_maker').default(false),

  email:           text('email'),
  phone:           text('phone'),
  whatsapp:        text('whatsapp'),
  linkedin:        text('linkedin'),
  instagram:       text('instagram'),

  notes:           text('notes'),
  metadata:        jsonb('metadata'),

  createdAt:       timestamp('created_at').defaultNow().notNull(),
  updatedAt:       timestamp('updated_at').defaultNow().notNull(),
})
```

### `packages/domain/src/schema/interactions.ts`

```typescript
// Schema now uses Effect Schema (see packages/domain/src/schema/)
import { companies } from './companies'
import { contacts } from './contacts'

export const interactions = pgTable('interactions', {
  id:            uuid('id').primaryKey().defaultRandom(),
  companyId:     uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  contactId:     uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),

  date:          timestamp('date').notNull(),
  durationMin:   integer('duration_min'),

  channel:       text('channel').notNull(),
  // values: email | phone | visit | linkedin | instagram | whatsapp | event
  direction:     text('direction').notNull(),
  // values: outbound | inbound
  type:          text('type').notNull(),
  // values: cold | followup | meeting | demo | check-in

  subject:       text('subject'),
  summary:       text('summary'),

  outcome:       text('outcome'),
  // values: no_response | responded | interested | not_interested
  //         | meeting_scheduled | proposal_requested

  nextAction:    text('next_action'),
  nextActionAt:  date('next_action_at'),

  metadata:      jsonb('metadata'),
  createdAt:     timestamp('created_at').defaultNow().notNull(),
})
```

### `packages/domain/src/schema/tasks.ts`

```typescript
// Schema now uses Effect Schema (see packages/domain/src/schema/)
import { companies } from './companies'
import { contacts } from './contacts'

export const tasks = pgTable('tasks', {
  id:          uuid('id').primaryKey().defaultRandom(),
  companyId:   uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  contactId:   uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),

  type:        text('type').notNull(),
  // values: call | visit | email | proposal | followup | other
  title:       text('title').notNull(),
  notes:       text('notes'),

  dueAt:       timestamp('due_at'),
  completedAt: timestamp('completed_at'),

  createdAt:   timestamp('created_at').defaultNow().notNull(),
})
```

### `packages/domain/src/schema/products.ts`

```typescript
// Schema now uses Effect Schema (see packages/domain/src/schema/)

export const products = pgTable('products', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  slug:               text('slug').notNull().unique(),
  name:               text('name').notNull(),

  type:               text('type').notNull(),
  // values: service | product
  status:             text('status').notNull().default('active'),
  // values: active | beta | idea

  description:        text('description'),
  defaultPrice:       numeric('default_price', { precision: 10, scale: 2 }),
  priceType:          text('price_type').default('fixed'),
  // values: fixed | monthly | custom

  targetIndustries:   text('target_industries').array(),
  metadata:           jsonb('metadata'),

  createdAt:          timestamp('created_at').defaultNow().notNull(),
  updatedAt:          timestamp('updated_at').defaultNow().notNull(),
})
```

### `packages/domain/src/schema/proposals.ts`

```typescript
// Schema now uses Effect Schema (see packages/domain/src/schema/)
import { companies } from './companies'
import { contacts } from './contacts'

export const proposals = pgTable('proposals', {
  id:          uuid('id').primaryKey().defaultRandom(),
  companyId:   uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  contactId:   uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),

  status:      text('status').notNull().default('draft'),
  // values: draft | sent | viewed | negotiating | accepted | rejected | expired
  title:       text('title').notNull(),

  lineItems:   jsonb('line_items').notNull(),
  // [{product_id, qty, price, notes}]
  totalValue:  numeric('total_value', { precision: 10, scale: 2 }),
  currency:    text('currency').default('EUR'),

  sentAt:      timestamp('sent_at'),
  expiresAt:   timestamp('expires_at'),
  respondedAt: timestamp('responded_at'),
  notes:       text('notes'),
  metadata:    jsonb('metadata'),

  createdAt:   timestamp('created_at').defaultNow().notNull(),
  updatedAt:   timestamp('updated_at').defaultNow().notNull(),
})
```

### `packages/domain/src/schema/documents.ts`

```typescript
// Schema now uses Effect Schema (see packages/domain/src/schema/)
import { companies } from './companies'
import { interactions } from './interactions'

export const documents = pgTable('documents', {
  id:            uuid('id').primaryKey().defaultRandom(),
  companyId:     uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  interactionId: uuid('interaction_id').references(() => interactions.id, { onDelete: 'set null' }),
  // links prenote/postnote to a specific meeting

  type:          text('type').notNull(),
  // values: research | prenote | postnote | call_notes | visit_notes | general
  title:         text('title'),
  content:       text('content').notNull(),
  // full markdown

  createdAt:     timestamp('created_at').defaultNow().notNull(),
  updatedAt:     timestamp('updated_at').defaultNow().notNull(),
})
```

### `packages/domain/src/schema/pages.ts`

```typescript
// Schema now uses Effect Schema (see packages/domain/src/schema/)
import { companies } from './companies'

export const pages = pgTable('pages', {
  id:            uuid('id').primaryKey().defaultRandom(),
  companyId:     uuid('company_id').references(() => companies.id, { onDelete: 'set null' }),
  // nullable — for generic pages not tied to a prospect

  slug:          text('slug').notNull(),
  lang:          text('lang').notNull(),
  // values: ca | es | en

  title:         text('title').notNull(),
  status:        text('status').notNull().default('draft'),
  // values: draft | published | archived
  template:      text('template'),
  // values: product-pitch | case-study | intro | landing | custom

  content:       jsonb('content').notNull(),
  // Tiptap JSON document with custom block nodes (hero, cta, value-props, etc.)
  meta:          jsonb('meta'),
  // SEO: { og_title, og_description, og_image }

  publishedAt:   timestamp('published_at'),
  expiresAt:     timestamp('expires_at'),
  viewCount:     integer('view_count').notNull().default(0),

  createdAt:     timestamp('created_at').defaultNow().notNull(),
  updatedAt:     timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  unique('pages_slug_lang_unique').on(table.slug, table.lang),
])
```

### `packages/domain/src/schema/api-keys.ts`

```typescript
// Schema now uses Effect Schema (see packages/domain/src/schema/)

export const apiKeys = pgTable('api_keys', {
  id:         uuid('id').primaryKey().defaultRandom(),
  name:       text('name').notNull(),
  // e.g. "n8n local", "zapier prod", "claude-code"
  keyHash:    text('key_hash').notNull().unique(),
  scopes:     text('scopes').array().notNull().default([]),
  // e.g. ["read:companies", "write:interactions", "write:tasks"]
  isActive:   boolean('is_active').notNull().default(true),
  lastUsedAt: timestamp('last_used_at'),
  expiresAt:  timestamp('expires_at'),
  createdAt:  timestamp('created_at').defaultNow().notNull(),
})
```

### `packages/domain/src/schema/webhook-endpoints.ts`

```typescript
// Schema now uses Effect Schema (see packages/domain/src/schema/)

export const webhookEndpoints = pgTable('webhook_endpoints', {
  id:              uuid('id').primaryKey().defaultRandom(),
  name:            text('name').notNull(),
  // e.g. "n8n company created", "zapier proposal accepted"
  url:             text('url').notNull(),
  events:          text('events').array().notNull(),
  // e.g. ["company.status_changed", "interaction.logged",
  //        "proposal.accepted", "task.due"]
  secret:          text('secret'),
  // HMAC-SHA256 signing secret
  isActive:        boolean('is_active').notNull().default(true),
  lastTriggeredAt: timestamp('last_triggered_at'),
  createdAt:       timestamp('created_at').defaultNow().notNull(),
})
```

### `packages/domain/src/schema/index.ts`

```typescript
export * from './companies'
export * from './contacts'
export * from './interactions'
export * from './tasks'
export * from './products'
export * from './proposals'
export * from './documents'
export * from './pages'
export * from './api-keys'
export * from './webhook-endpoints'
```

### `packages/domain/src/index.ts`

```typescript
export * from './schema/index'
```

---

## Phase 4 — apps/server

### `apps/server/package.json`

```json
{
  "name": "@engranatge/server",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "node --watch src/main.ts",
    "dev:mcp": "node src/mcp-stdio.ts",
    "build": "tsdown",
    "start": "node dist/main.js"
  },
  "dependencies": {
    "@engranatge/domain": "workspace:*",
    "effect": "^3.21.0",
    "@effect/platform": "^0.96.0",
    "@effect/platform-node": "^0.106.0",
    "@effect/sql": "^0.51.0",
    "@effect/sql-pg": "^4.0.0-beta.43",
    "@effect/platform-node": "^4.0.0-beta.43",
    "resend": "^6.10.0",
    "dotenv": "^17.3.1"
  },
  "devDependencies": {
    "tsdown": "^0.21.7",
    "typescript": "^6.0.2",
    "@types/node": "^25.5.0"
  }
}
```

### `apps/server/tsconfig.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ESNext"],
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

Node 24 has built-in TypeScript type stripping (no `tsx` needed). The `erasableSyntaxOnly: true` flag in tsconfig ensures only Node-compatible TS syntax is used. Write imports without `.js`:

```typescript
// correct — no extension needed
import { CompanyService } from '../services/companies'
import { db } from '../db/client'
```

**Note on Effect package versions:** Verify exact versions on npm at scaffold time. Effect packages use coordinated version numbers. Check `@effect/experimental` for the `McpServer` export — it may be under `@effect/experimental/McpServer` or a dedicated `@effect/mcp` package by v4 release.

### `apps/server/src/db/client.ts`

```typescript
import { PgClient } from '@effect/sql-pg'
import { Config } from 'effect'

export const PgLive = PgClient.layerConfig({
  url: Config.redacted('DATABASE_URL'),
  transformResultNames: Config.succeed((s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())),
  transformQueryNames: Config.succeed((s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)),
})
```

### `apps/server/src/middleware/api-key.ts`

```typescript
// Uses Effect's HttpApiSecurity to validate API key on protected routes.
// Key arrives as header: x-api-key
// Validate: hash incoming key, compare to api_keys table, check is_active.
// On success: attach scopes to request context.
// On failure: return 401.
```

### `apps/server/src/mcp/server.ts`

```typescript
// McpServer setup using @effect/experimental McpServer.
// Register all tools and resources.
// Two transports:
//   1. stdio  — for Claude Code (mcp-stdio.ts entry)
//   2. HTTP/SSE — mounted at /mcp on the HTTP server (for Claude.ai, ChatGPT)
//      Protected by MCP_SECRET env var checked as Bearer token.
```

### MCP Tools to implement

Each tool returns the minimum data needed — never dumps full table.

| Tool               | Input                                                                                     | Returns                                                           |
| ------------------ | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `search_companies` | `{status?, region?, industry?, priority?, product_fit?, limit?}`                          | array of company summaries                                        |
| `get_company`      | `{id_or_slug}`                                                                            | full company + contacts + recent interactions (last 5)            |
| `create_company`   | company fields                                                                            | created company                                                   |
| `update_company`   | `{id, fields}`                                                                            | updated company                                                   |
| `log_interaction`  | `{company_id, channel, direction, type, summary, outcome, next_action?, next_action_at?}` | created interaction + auto-updates `last_contacted_at` on company |
| `get_documents`    | `{company_id, type?}`                                                                     | list of documents (id + title + type, NOT content)                |
| `get_document`     | `{id}`                                                                                    | full document content                                             |
| `create_document`  | `{company_id, interaction_id?, type, title?, content}`                                    | created document                                                  |
| `update_document`  | `{id, content}`                                                                           | updated document                                                  |
| `create_task`      | `{company_id, type, title, due_at?}`                                                      | created task                                                      |
| `complete_task`    | `{id}`                                                                                    | updated task                                                      |
| `get_pipeline`     | `{}`                                                                                      | counts by status, overdue tasks, companies without next action    |
| `get_next_steps`   | `{limit?}`                                                                                | tasks due soon + companies with overdue next_action_at            |
| `create_page`      | `{company_id?, slug, lang, template?, title, content}`                                    | created page (draft)                                              |
| `update_page`      | `{id, content?, title?, meta?}`                                                           | updated page                                                      |
| `publish_page`     | `{id}`                                                                                    | sets status to published, sets published_at                       |
| `list_pages`       | `{company_id?, status?, lang?}`                                                           | page summaries                                                    |
| `get_page`         | `{id_or_slug, lang?}`                                                                     | full page content                                                 |

### MCP Resources to implement

| Resource         | URI                      | Returns                             |
| ---------------- | ------------------------ | ----------------------------------- |
| Company profile  | `forja://company/{slug}` | full profile compressed for context |
| Pipeline summary | `forja://pipeline`       | pipeline overview                   |

### `apps/server/src/routes/`

One file per entity. Each file exports an Effect `HttpApiGroup` with:

- `GET /companies` — search with filters
- `GET /companies/:slug` — single company
- `POST /companies` — create
- `PATCH /companies/:id` — update
- (same pattern for contacts, interactions, tasks, proposals, products, documents)
- `GET /pages/:slug` — public: returns published page content by slug+lang query param
- `POST /pages/:slug/view` — public: increment view counter
- `GET /pages` — internal: list pages with filters
- `POST /pages` — internal: create page
- `PATCH /pages/:id` — internal: update content/status
- `DELETE /pages/:id` — internal: archive
- `POST /webhooks/test/:id` — trigger a webhook manually for testing

### `apps/server/Kraftfile`

Based on the iapacte/iapacte production pattern (`infrastructure/kraftcloud/`):

```yaml
spec: v0.6

name: forja-server

runtime: node:latest

labels:
  cloud.unikraft.v1.instances/scale_to_zero.policy: "on"
  cloud.unikraft.v1.instances/scale_to_zero.stateful: "false"
  cloud.unikraft.v1.instances/scale_to_zero.cooldown_time_ms: 1000

rootfs: ./Dockerfile
cmd: ["/usr/bin/node", "/app/dist/main.js"]
```

- `runtime: node:latest` — use Unikraft's official Node runtime (no Caddy needed, server handles HTTP directly)
- `scale_to_zero` — scales to zero when idle, wakes on first request
- `rootfs` points to the Dockerfile which builds the monorepo and produces `/app/dist/main.js`
- Verify `node:latest` resolves to Node 24 in the Unikraft catalog at deploy time; pin to `node:24` if available

### `apps/server/Dockerfile`

Two-stage build based on iapacte's `Dockerfile.web` pattern:

```dockerfile
# Stage 1 — build
FROM node:24-alpine AS build

# Disable parallel IPv4/IPv6 — required for Unikraft's network stack
ENV NODE_OPTIONS=--no-network-family-autoselection

WORKDIR /repo

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

# Copy workspace manifests first for layer caching
COPY ./package.json ./pnpm-lock.yaml ./pnpm-workspace.yaml ./
COPY ./apps/server ./apps/server
COPY ./packages ./packages

RUN --mount=type=cache,target=/root/.pnpm-store \
    CI=true pnpm install --frozen-lockfile

RUN pnpm --filter @engranatge/domain build && \
    pnpm --filter @engranatge/server build

# Stage 2 — runtime
FROM node:24-alpine

ENV NODE_OPTIONS=--no-network-family-autoselection
ENV NODE_ENV=production
ENV PORT=3000

WORKDIR /app
COPY --from=build /repo/apps/server/dist /app/dist

CMD ["node", "dist/main.js"]
```

Key points from iapacte reference:

- `NODE_OPTIONS=--no-network-family-autoselection` is required — Unikraft's network stack doesn't support Node's happy-eyeballs IPv4/IPv6 fallback
- `pnpm@9.15.4` — pin exact version to match lockfile; update when upgrading pnpm
- Build `domain` package first so `server` can import from it
- Stage 2 copies only `dist/` — no source, no node_modules, minimal image

---

## Phase 5 — apps/internal (Forja)

### Step 1 — Scaffold with TanStack CLI

```bash
npx @tanstack/cli create web \
  --toolchain biome \
  --no-examples \
  --no-git \
  --no-install \
  --package-manager pnpm \
  --framework React \
  --target-dir apps/internal
```

This creates a working TanStack Start + Biome project with Vite. No `--deployment` flag — we deploy to Unikraft (Node.js SSR), not Cloudflare.

### Step 2 — Post-scaffold cleanup

Remove Tailwind and Cloudflare (we use styled-components + MD3 tokens, deployed to Unikraft):

```bash
# In apps/internal/package.json, remove:
#   tailwindcss, @tailwindcss/vite, @tailwindcss/typography
#   @cloudflare/vite-plugin, wrangler (if scaffolded)

# Remove devtools (we add them later if needed):
#   @tanstack/react-devtools, @tanstack/devtools-vite, @tanstack/react-router-devtools

# Remove demo files:
rm src/components/Header.tsx src/components/Footer.tsx src/components/ThemeToggle.tsx
rm src/routes/about.tsx
rm wrangler.jsonc  # if created
```

Remove from `vite.config.ts`: `tailwindcss()`, `cloudflare()`, `devtools()` plugins + their imports.

Replace `src/styles.css` content — remove Tailwind `@import "tailwindcss"` and the demo theme. This file will hold our MD3 token system (see docs/frontend.md).

### Step 3 — Adapt for monorepo

**`apps/internal/package.json`** — final shape after cleanup:

```json
{
  "name": "@engranatge/internal",
  "private": true,
  "type": "module",
  "imports": {
    "#/*": "./src/*"
  },
  "description": "Forja — internal sales prospecting tool",
  "scripts": {
    "dev": "vite dev --port 3000",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "@engranatge/domain": "workspace:*",
    "@engranatge/ui": "workspace:*",
    "@tanstack/react-router": "latest",
    "@tanstack/react-start": "latest",
    "@tanstack/router-plugin": "^1.132.0",
    "@base-ui/react": "^1.3.0",
    "@tiptap/react": "^3.21.0",
    "@tiptap/starter-kit": "^3.21.0",
    "@tiptap/pm": "^3.21.0",
    "styled-components": "^6.3.12",
    "react-map-gl": "^8.1.0",
    "maplibre-gl": "^5.21.1",
    "supercluster": "^8.0.1",
    "react": "^19.2.0",
    "react-dom": "^19.2.0",
    "effect": "^3.21.0"
  },
  "devDependencies": {
    "@types/react": "^19.2.0",
    "@types/react-dom": "^19.2.0",
    "@types/supercluster": "^7.1.3",
    "@vitejs/plugin-react": "^5.1.4",
    "typescript": "^6.0.2",
    "vite": "^7.3.1",
    "vite-tsconfig-paths": "^5.1.4"
  }
}
```

**`apps/internal/tsconfig.json`** — extend monorepo base, keep CLI's bundler settings:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["**/*.ts", "**/*.tsx"],
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["ESNext", "DOM", "DOM.Iterable"],
    "types": ["vite/client"],
    "baseUrl": ".",
    "paths": {
      "#/*": ["./src/*"]
    },
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "noEmit": true
  }
}
```

### Step 4 — Key generated files

**`apps/internal/vite.config.ts`** (after cleanup):

```typescript
import { defineConfig } from 'vite'
import tsconfigPaths from 'vite-tsconfig-paths'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'

const config = defineConfig({
  plugins: [
    tsconfigPaths({ projects: ['./tsconfig.json'] }),
    tanstackStart(),
    viteReact(),
  ],
})

export default config
```

**`apps/internal/Dockerfile`** (two-stage Node 24 build for Unikraft):

```dockerfile
FROM node:24-alpine AS build
ENV NODE_OPTIONS=--no-network-family-autoselection
WORKDIR /repo
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@latest --activate
COPY ./package.json ./pnpm-lock.yaml ./pnpm-workspace.yaml ./
COPY ./turbo.json ./
RUN sed -i 's/"prepare": "lefthook install"/"prepare": ""/' package.json
COPY ./apps ./apps
COPY ./packages ./packages
RUN --mount=type=cache,target=/root/.pnpm-store CI=true pnpm install --frozen-lockfile
RUN DO_NOT_TRACK=1 TURBO_TELEMETRY_DISABLED=1 pnpm turbo run build --filter=@engranatge/internal

FROM node:24-alpine
ENV NODE_OPTIONS=--no-network-family-autoselection
WORKDIR /app
COPY --from=build /repo/apps/internal/.output /app/.output
ENV NODE_ENV=production
ENV PORT=3000
ENV SERVER_URL=https://api.batuda.co
CMD ["node", ".output/server/index.mjs"]
```

Note: The Dockerfile builds domain+ui+internal via Turborepo. The `SERVER_URL` points to `api.batuda.co`.

**`apps/internal/Kraftfile`**:

```yaml
spec: v0.6
name: forja-internal
runtime: node:latest
labels:
  cloud.unikraft.v1.instances/scale_to_zero.policy: "on"
  cloud.unikraft.v1.instances/scale_to_zero.stateful: "false"
  cloud.unikraft.v1.instances/scale_to_zero.cooldown_time_ms: 1000
rootfs: ./Dockerfile
cmd: ["/usr/bin/node", "/app/.output/server/index.mjs"]
```

**`apps/internal/src/router.tsx`** (scaffolded by CLI):

```typescript
import { createRouter as createTanStackRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

export function getRouter() {
  const router = createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
  })

  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
```

`routeTree.gen.ts` is auto-generated by `@tanstack/router-plugin` from the `src/routes/` directory. Do not edit it manually.

### Route structure

```
/ (index)          Pipeline dashboard
                   - Status counts (prospect/contacted/responded/meeting/proposal/client)
                   - Overdue tasks
                   - Companies needing next action
                   Mobile-first, card layout

/companies         Company list
                   - Filters: status, region, industry, priority, product_fit
                   - Search by name
                   - Sorted by priority + last_contacted_at

/companies/$slug   Company detail
                   - Full profile
                   - Contacts
                   - Interaction timeline
                   - Documents (research, pre/postnotes)
                   - Tasks
                   - Proposals

/tasks             Next steps view
                   - Today + overdue
                   - Upcoming (7 days)
```

### Design principles

- Mobile-first, fluid layout
- styled-components for co-located CSS in .tsx files, using MD3 CSS custom property tokens
- BaseUI headless components styled via styled-components
- react-map-gl + MapLibre for company map view with clustering
- Status colors consistent across all views
- Minimal JS, mostly server-rendered

---

## Phase 5b — packages/ui

Shared design tokens and Tiptap block extensions used by both `apps/internal` and `apps/marketing`.

### `packages/ui/package.json`

```json
{
  "name": "@engranatge/ui",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": "./dist/index.js",
    "./tokens.css": "./src/tokens.css"
  },
  "scripts": {
    "build": "tsdown"
  },
  "dependencies": {
    "@tiptap/core": "^3.21.0",
    "@tiptap/pm": "^3.21.0"
  },
  "devDependencies": {
    "tsdown": "^0.21.7",
    "typescript": "^6.0.2"
  }
}
```

### `packages/ui/src/tokens.css`

Contains all MD3 design tokens (moved from apps/internal). See [frontend.md](docs/frontend.md) for the full token system:

- Typography scale (display/headline/title/body/label × large/medium/small)
- Color scheme (light + dark)
- Fluid spacing scale
- Shape tokens
- Elevation tokens
- Breakpoint tokens

Both apps import tokens via:

```css
/* apps/internal/src/styles/global.css or apps/marketing/src/styles/global.css */
@import '@engranatge/ui/tokens.css';
```

### `packages/ui/src/blocks/`

Tiptap custom node extensions for marketing page blocks. Each file exports a Tiptap `Node.create()`:

| Block         | Attrs                                                   | Purpose                |
| ------------- | ------------------------------------------------------- | ---------------------- |
| `hero`        | `heading`, `subheading`, `cta: { label, action }`       | Page hero section      |
| `cta`         | `heading`, `body`, `buttons: [{ label, action, url }]`  | Call-to-action section |
| `valueProps`  | `heading`, `items: [{ title, body, image? }]`           | Feature/benefit grid   |
| `painPoints`  | `heading`, `items: [{ icon, title, body }]`             | Problem statement list |
| `socialProof` | `heading`, `testimonials: [{ quote, author, company }]` | Testimonials/logos     |

Standard rich text (paragraphs, headings, lists) is handled by Tiptap's built-in StarterKit — no custom nodes needed.

---

## Phase 5c — apps/marketing (Engranatge)

Public-facing website at `engranatge.com`. Serves both the Engranatge marketing homepage and AI-generated prospect sales pages.

### Scaffold

```bash
npx @tanstack/cli create marketing \
  --toolchain biome \
  --no-examples \
  --no-git \
  --no-install \
  --package-manager pnpm \
  --framework React \
  --target-dir apps/marketing
```

Same post-scaffold cleanup as `apps/internal` (remove Tailwind, Cloudflare, devtools, demo files).

### `apps/marketing/package.json`

```json
{
  "name": "@engranatge/marketing",
  "private": true,
  "type": "module",
  "description": "Engranatge — public marketing site + prospect pages",
  "imports": {
    "#/*": "./src/*"
  },
  "scripts": {
    "dev": "vite dev --port 3001",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "@engranatge/domain": "workspace:*",
    "@engranatge/ui": "workspace:*",
    "@tanstack/react-router": "latest",
    "@tanstack/react-start": "latest",
    "@tanstack/router-plugin": "^1.132.0",
    "@tiptap/react": "^3.21.0",
    "@tiptap/starter-kit": "^3.21.0",
    "@tiptap/pm": "^3.21.0",
    "styled-components": "^6.3.12",
    "react": "^19.2.0",
    "react-dom": "^19.2.0"
  },
  "devDependencies": {
    "@types/react": "^19.2.0",
    "@types/react-dom": "^19.2.0",
    "@vitejs/plugin-react": "^5.1.4",
    "typescript": "^6.0.2",
    "vite": "^7.3.1",
    "vite-tsconfig-paths": "^5.1.4"
  }
}
```

### Route structure

```
/                   Marketing homepage (Engranatge)
/:lang              Language landing (ca/es/en)
/:lang/:slug        Prospect page — fetches from GET /pages/:slug?lang=:lang
```

### `$lang.tsx` — language layout

Validates `lang` param against `ca | es | en`. Sets `<html lang>`. Returns 404 on invalid language code. Provides lang context to child routes.

### `$lang/$slug.tsx` — prospect page

1. Server function calls `GET ${SERVER_URL}/pages/${slug}?lang=${lang}`
2. If page not published or not found → 404
3. Renders Tiptap JSON content by mapping block types to React components
4. Emits SEO tags from `meta` field: `<title>`, `og:title`, `og:description`, `og:image`, `og:locale`
5. Emits `<link rel="alternate" hreflang="...">` for all available translations
6. Fires `POST /pages/${slug}/view` on load (fire-and-forget)

### Block renderer

```tsx
// apps/marketing/src/components/blocks/BlockRenderer.tsx
import { Hero } from './Hero'
import { Cta } from './Cta'
import { ValueProps } from './ValueProps'
import { PainPoints } from './PainPoints'
import { SocialProof } from './SocialProof'
import { RichText } from './RichText'

const BLOCK_MAP = {
  hero: Hero,
  cta: Cta,
  valueProps: ValueProps,
  painPoints: PainPoints,
  socialProof: SocialProof,
} as const

// For standard Tiptap content (paragraphs, headings, lists),
// use generateHTML() from @tiptap/html with the shared block extensions.
// Custom block nodes render via BLOCK_MAP.
```

### `apps/marketing/Dockerfile`

```dockerfile
FROM node:24-alpine AS build
ENV NODE_OPTIONS=--no-network-family-autoselection
WORKDIR /repo
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@latest --activate
COPY ./package.json ./pnpm-lock.yaml ./pnpm-workspace.yaml ./
COPY ./turbo.json ./
RUN sed -i 's/"prepare": "lefthook install"/"prepare": ""/' package.json
COPY ./apps ./apps
COPY ./packages ./packages
RUN --mount=type=cache,target=/root/.pnpm-store CI=true pnpm install --frozen-lockfile
RUN DO_NOT_TRACK=1 TURBO_TELEMETRY_DISABLED=1 pnpm turbo run build --filter=@engranatge/marketing

FROM node:24-alpine
ENV NODE_OPTIONS=--no-network-family-autoselection
WORKDIR /app
COPY --from=build /repo/apps/marketing/.output /app/.output
ENV NODE_ENV=production
ENV PORT=3000
ENV SERVER_URL=https://api.batuda.co
CMD ["node", ".output/server/index.mjs"]
```

### `apps/marketing/Kraftfile`

```yaml
spec: v0.6
name: engranatge-marketing
runtime: node:latest
labels:
  cloud.unikraft.v1.instances/scale_to_zero.policy: "on"
  cloud.unikraft.v1.instances/scale_to_zero.stateful: "false"
  cloud.unikraft.v1.instances/scale_to_zero.cooldown_time_ms: 1000
rootfs: ./Dockerfile
cmd: ["/usr/bin/node", "/app/.output/server/index.mjs"]
```

---

## Phase 6 — MCP Config

### `/.mcp.json`

```json
{
  "mcpServers": {
    "forja": {
      "command": "pnpm",
      "args": ["--filter", "server", "dev:mcp"],
      "env": {
        "DATABASE_URL": "${DATABASE_URL}"
      },
      "description": "Forja — companies, contacts, interactions, documents, pages, pipeline"
    }
  }
}
```

---

## Phase 7 — .claude/CLAUDE.md

### `/.claude/CLAUDE.md`

```markdown
# Forja — AI Agent Instructions

## Source of truth

All data lives in NeonDB (Postgres). Use MCP tools to read and write.
Never generate SQL directly. Always use MCP tools.

## MCP tools available

See PLAN.md § MCP Tools for the full list.

## Key rules

- `documents.content` is full markdown. Write it as a human would.
- When logging an interaction, always set `next_action` and `next_action_at` if known.
- `metadata` jsonb is for data that doesn't fit existing columns yet — use it freely.
- Company `status` only moves forward (prospect → client). To reopen use `status: contacted`.
- Never create a company without a `slug` (kebab-case from name + location if duplicate).

## Context efficiency

- Use `search_companies` before `get_company` — it returns summaries only.
- Use `get_documents` (list) before `get_document` (content) — fetch content only when needed.
- `get_pipeline` for overviews. `get_next_steps` for daily planning.
- Use `create_page` to generate prospect sales pages. Set `lang: "ca"` first, then create translations.
- Always `publish_page` after review — pages are draft by default.
```

---

## Phase 8 — Execution Order

Run these steps in order:

```bash
# 1. Allow direnv (activates Nix flake automatically)
direnv allow

# 2. Install all dependencies (also runs `lefthook install` via prepare script)
pnpm install

# 3. Copy env and fill in NeonDB URL
cp .env.example .env
# edit .env — add DATABASE_URL from NeonDB dashboard

# 4. Generate and run initial migration
pnpm db:generate
pnpm db:migrate

# 5. Start server in dev
pnpm dev:server

# 6. Start internal app in dev (separate terminal)
pnpm dev:internal

# 7. Start marketing app in dev (separate terminal)
pnpm dev:marketing

# 7. Test MCP locally
pnpm --filter server dev:mcp
# Then in Claude Code: /mcp to verify forja tools appear
```

---

## Open items at scaffold time

1. **Effect MCP package** — verify whether MCP lives in `@effect/experimental` or a separate `@effect/mcp` package
2. **TanStack Start deployment** — Unikraft (Node.js SSR) via Dockerfile + Kraftfile
3. **Unikraft Node 24 base image** — check `catalog.unikraft.org` for availability of node:24
4. **NeonDB project** — create project at neon.tech, copy connection string to `.env`
5. **DNS setup** — `engranatge.com`, `batuda.co`, `api.batuda.co` pointing to respective Unikraft instances
6. **Tiptap block extensions** — verify custom node API in Tiptap v3 for structured block content

---

## Entity relationships summary

```
companies ──< contacts
companies ──< interactions >── contacts
companies ──< tasks        >── contacts
companies ──< proposals    >── contacts
companies ──< documents    >── interactions
companies ──< pages
webhook_endpoints (standalone)
api_keys (standalone)
products (standalone, referenced by proposals.line_items jsonb)
```

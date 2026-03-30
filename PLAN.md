# Batuda — Build Plan

Full scaffold for a B2B prospecting CRM + automation platform.
Subdomain: `batuda.guillempuche.com`

---

## Stack

| Layer | Technology |
|-------|-----------|
| Monorepo | pnpm workspaces |
| Dev environment | Nix flake (Node 24 + pnpm + kraft) |
| Backend | Effect HTTP server + MCP server |
| Frontend | TanStack Start → Cloudflare Pages |
| Database | NeonDB (Postgres) via Drizzle ORM |
| Server deploy | Unikraft (kraft CLI) |
| Auth | API keys (hashed, per integration) |
| AI access | MCP stdio (Claude Code) + HTTP/SSE (Claude.ai, ChatGPT) |

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
│   │   │   │   └── client.ts     # Drizzle + NeonDB connection
│   │   │   ├── routes/
│   │   │   │   ├── companies.ts
│   │   │   │   ├── contacts.ts
│   │   │   │   ├── interactions.ts
│   │   │   │   ├── tasks.ts
│   │   │   │   ├── proposals.ts
│   │   │   │   ├── products.ts
│   │   │   │   ├── documents.ts
│   │   │   │   └── webhooks.ts
│   │   │   ├── mcp/
│   │   │   │   ├── server.ts     # McpServer setup
│   │   │   │   ├── tools/
│   │   │   │   │   ├── companies.ts
│   │   │   │   │   ├── contacts.ts
│   │   │   │   │   ├── interactions.ts
│   │   │   │   │   ├── tasks.ts
│   │   │   │   │   ├── documents.ts
│   │   │   │   │   └── pipeline.ts
│   │   │   │   └── resources/
│   │   │   │       ├── company.ts
│   │   │   │       └── pipeline.ts
│   │   │   ├── middleware/
│   │   │   │   └── api-key.ts    # HttpApiSecurity.apiKey
│   │   │   └── services/
│   │   │       ├── companies.ts
│   │   │       ├── webhooks.ts
│   │   │       └── pipeline.ts
│   │   ├── Kraftfile             # Unikraft build definition
│   │   ├── Dockerfile            # Two-stage Node 24 build for Unikraft
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── web/                      # TanStack Start → Cloudflare Pages
│       ├── src/
│       │   ├── routes/
│       │   │   ├── __root.tsx
│       │   │   ├── index.tsx           # Pipeline dashboard
│       │   │   ├── companies/
│       │   │   │   ├── index.tsx       # Company list
│       │   │   │   └── $slug.tsx       # Company detail
│       │   │   └── tasks/
│       │   │       └── index.tsx       # Today's next steps
│       │   ├── components/
│       │   │   ├── Pipeline.tsx
│       │   │   ├── CompanyCard.tsx
│       │   │   ├── StatusBadge.tsx
│       │   │   └── TaskList.tsx
│       │   ├── lib/
│       │   │   └── api.ts              # Typed client → server
│       │   └── styles/
│       │       ├── tokens.css          # MD3 tokens: typography, color, spacing
│       │       └── global.css
│       ├── wrangler.toml               # Cloudflare Pages config
│       ├── package.json
│       └── tsconfig.json
│
├── packages/
│   └── domain/                   # Shared: Drizzle schema + Effect Schema + types
│       ├── src/
│       │   ├── schema/
│       │   │   ├── companies.ts
│       │   │   ├── contacts.ts
│       │   │   ├── interactions.ts
│       │   │   ├── tasks.ts
│       │   │   ├── products.ts
│       │   │   ├── proposals.ts
│       │   │   ├── documents.ts
│       │   │   ├── api-keys.ts
│       │   │   ├── webhook-endpoints.ts
│       │   │   └── index.ts            # re-exports all tables
│       │   └── index.ts
│       ├── drizzle.config.ts
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
  "name": "batuda",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=24",
    "pnpm": ">=10"
  },
  "scripts": {
    "dev:server": "pnpm --filter server dev",
    "dev:web": "pnpm --filter web dev",
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
    "target": "ES2024",
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
      label: 'Batuda',
      dependencies: ['@batuda/*'],
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
      label: 'Drizzle',
      dependencies: ['drizzle-orm', 'drizzle-kit'],
      policy: 'sameRange',
    },
    {
      label: 'TanStack',
      dependencies: ['@tanstack/*'],
      policy: 'sameRange',
    },
    {
      label: 'Cloudflare',
      dependencies: ['wrangler', '@cloudflare/*'],
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
DATABASE_URL=postgres://user:pass@ep-xxx.us-east-2.aws.neon.tech/batuda?sslmode=require

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
  description = "Batuda — B2B prospecting platform";

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
            echo "Batuda dev environment"
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
  "name": "@batuda/domain",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:studio": "drizzle-kit studio"
  },
  "dependencies": {
    "drizzle-orm": "^0.45.2",
    "@neondatabase/serverless": "^1.0.2",
    "effect": "^3.21.0"
  },
  "devDependencies": {
    "drizzle-kit": "^0.31.10",
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
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

### `packages/domain/drizzle.config.ts`
```typescript
import { defineConfig } from 'drizzle-kit'
import * as dotenv from 'dotenv'
dotenv.config({ path: '../../.env' })

export default defineConfig({
  schema: './src/schema/index.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
})
```

### `packages/domain/src/schema/companies.ts`
```typescript
import { pgTable, uuid, text, integer, timestamp, jsonb } from 'drizzle-orm/pg-core'

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
import { pgTable, uuid, text, boolean, timestamp, jsonb } from 'drizzle-orm/pg-core'
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
import { pgTable, uuid, text, integer, date, timestamp, jsonb } from 'drizzle-orm/pg-core'
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
import { pgTable, uuid, text, timestamp, jsonb } from 'drizzle-orm/pg-core'
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
import { pgTable, uuid, text, numeric, timestamp, jsonb } from 'drizzle-orm/pg-core'

export const products = pgTable('products', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  slug:               text('slug').notNull().unique(),
  name:               text('name').notNull(),

  type:               text('type').notNull(),
  // values: service | product | microsaas
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
import { pgTable, uuid, text, numeric, timestamp, jsonb } from 'drizzle-orm/pg-core'
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
import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core'
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

### `packages/domain/src/schema/api-keys.ts`
```typescript
import { pgTable, uuid, text, boolean, timestamp } from 'drizzle-orm/pg-core'

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
import { pgTable, uuid, text, boolean, timestamp } from 'drizzle-orm/pg-core'

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
  "name": "@batuda/server",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/main.ts",
    "dev:mcp": "tsx src/mcp-stdio.ts",
    "build": "tsc",
    "start": "node dist/main.js"
  },
  "dependencies": {
    "@batuda/domain": "workspace:*",
    "effect": "^3.21.0",
    "@effect/platform": "^0.96.0",
    "@effect/platform-node": "^0.106.0",
    "@effect/sql": "^0.51.0",
    "@effect/sql-pg": "^0.52.1",
    "@effect/experimental": "^0.60.0",
    "drizzle-orm": "^0.45.2",
    "@neondatabase/serverless": "^1.0.2",
    "dotenv": "^17.3.1"
  },
  "devDependencies": {
    "typescript": "^6.0.2",
    "tsx": "^4.21.0",
    "@types/node": "^25.5.0"
  }
}
```

### `apps/server/tsconfig.json`
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

`tsx` respects `moduleResolution: "bundler"` — write imports without `.js`:
```typescript
// correct — no extension needed
import { CompanyService } from '../services/companies'
import { db } from '../db/client'
```

**Note on Effect package versions:** Verify exact versions on npm at scaffold time. Effect packages use coordinated version numbers. Check `@effect/experimental` for the `McpServer` export — it may be under `@effect/experimental/McpServer` or a dedicated `@effect/mcp` package by v4 release.

### `apps/server/src/db/client.ts`
```typescript
import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import * as schema from '@batuda/domain'

const sql = neon(process.env.DATABASE_URL!)
export const db = drizzle(sql, { schema })
export type DB = typeof db
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

| Tool | Input | Returns |
|------|-------|---------|
| `search_companies` | `{status?, region?, industry?, priority?, product_fit?, limit?}` | array of company summaries |
| `get_company` | `{id_or_slug}` | full company + contacts + recent interactions (last 5) |
| `create_company` | company fields | created company |
| `update_company` | `{id, fields}` | updated company |
| `log_interaction` | `{company_id, channel, direction, type, summary, outcome, next_action?, next_action_at?}` | created interaction + auto-updates `last_contacted_at` on company |
| `get_documents` | `{company_id, type?}` | list of documents (id + title + type, NOT content) |
| `get_document` | `{id}` | full document content |
| `create_document` | `{company_id, interaction_id?, type, title?, content}` | created document |
| `update_document` | `{id, content}` | updated document |
| `create_task` | `{company_id, type, title, due_at?}` | created task |
| `complete_task` | `{id}` | updated task |
| `get_pipeline` | `{}` | counts by status, overdue tasks, companies without next action |
| `get_next_steps` | `{limit?}` | tasks due soon + companies with overdue next_action_at |

### MCP Resources to implement

| Resource | URI | Returns |
|----------|-----|---------|
| Company profile | `batuda://company/{slug}` | full profile compressed for context |
| Pipeline summary | `batuda://pipeline` | pipeline overview |

### `apps/server/src/routes/`

One file per entity. Each file exports an Effect `HttpApiGroup` with:
- `GET /companies` — search with filters
- `GET /companies/:slug` — single company
- `POST /companies` — create
- `PATCH /companies/:id` — update
- (same pattern for contacts, interactions, tasks, proposals, products, documents)
- `POST /webhooks/test/:id` — trigger a webhook manually for testing

### `apps/server/Kraftfile`

Based on the iapacte/iapacte production pattern (`infrastructure/kraftcloud/`):

```yaml
spec: v0.6

name: batuda-server

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

RUN pnpm --filter @batuda/domain build && \
    pnpm --filter @batuda/server build

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

## Phase 5 — apps/web

### `apps/web/package.json`
```json
{
  "name": "@batuda/web",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vinxi dev",
    "build": "vinxi build",
    "preview": "wrangler pages dev .output/public"
  },
  "dependencies": {
    "@batuda/domain": "workspace:*",
    "@tanstack/start": "^1.120.20",
    "@tanstack/react-router": "^1.168.8",
    "@base-ui-components/react": "1.0.0-rc.0",
    "react": "^19.2.4",
    "react-dom": "^19.2.4",
    "effect": "^3.21.0"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20260329.1",
    "@types/react": "^19.2.14",
    "@types/react-dom": "^19.2.3",
    "wrangler": "^4.78.0",
    "typescript": "^6.0.2",
    "vite": "^8.0.3"
  }
}
```

### `apps/web/tsconfig.json`
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", ".output", ".wrangler"]
}
```

- `"jsx": "react-jsx"` — React 19 automatic JSX transform, no `import React` needed in every file
- `"lib": ["ES2022", "DOM", "DOM.Iterable"]` — browser globals + modern JS
- `@types/react@^19` — React 19 ships its own types but `@types/react` is still the DefinitelyTyped package; pin to `^19` to match the runtime

**Note on TanStack Start + Cloudflare Pages:** Use the `cloudflare-pages` preset in `app.config.ts`. Verify the exact preset name in TanStack Start docs at scaffold time — it may be `vinxi`'s built-in Cloudflare preset.

### `apps/web/app.config.ts`
```typescript
import { defineConfig } from '@tanstack/start/config'

export default defineConfig({
  server: {
    preset: 'cloudflare-pages',
  },
})
```

### `apps/web/wrangler.toml`
```toml
name = "batuda-web"
compatibility_date = "2025-01-01"
pages_build_output_dir = ".output/public"

[vars]
SERVER_URL = "https://server.batuda.guillempuche.com"
```

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
- No UI library — plain CSS with custom tokens
- Status colors consistent across all views
- Minimal JS, mostly server-rendered

---

## Phase 6 — MCP Config

### `/.mcp.json`
```json
{
  "mcpServers": {
    "batuda": {
      "command": "pnpm",
      "args": ["--filter", "server", "dev:mcp"],
      "env": {
        "DATABASE_URL": "${DATABASE_URL}"
      },
      "description": "Batuda CRM — companies, contacts, interactions, documents, pipeline"
    }
  }
}
```

---

## Phase 7 — .claude/CLAUDE.md

### `/.claude/CLAUDE.md`
```markdown
# Batuda — AI Agent Instructions

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

# 6. Start web in dev (separate terminal)
pnpm dev:web

# 7. Test MCP locally
pnpm --filter server dev:mcp
# Then in Claude Code: /mcp to verify batuda tools appear
```

---

## Open items at scaffold time

1. **Effect MCP package** — verify whether MCP lives in `@effect/experimental` or a separate `@effect/mcp` package
2. **TanStack Start Cloudflare preset** — confirm preset name in app.config.ts
3. **Unikraft Node 24 base image** — check `catalog.unikraft.org` for availability of node:24
4. **NeonDB project** — create project at neon.tech, copy connection string to `.env`

---

## Entity relationships summary

```
companies ──< contacts
companies ──< interactions >── contacts
companies ──< tasks        >── contacts
companies ──< proposals    >── contacts
companies ──< documents    >── interactions
webhook_endpoints (standalone)
api_keys (standalone)
products (standalone, referenced by proposals.line_items jsonb)
```

#!/usr/bin/env node
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Generator, getConfig } from '@tanstack/router-generator'

// Standalone TanStack Router tree regeneration so `pnpm check-types`
// doesn't have to wait for `pnpm dev` or `pnpm build` to refresh
// `src/routeTree.gen.ts` after a new route file is added. Mirrors what
// the `tanstackStart()` Vite plugin does internally; reads the same
// defaults (routes under `src/routes/`, output to `src/routeTree.gen.ts`).

const here = fileURLToPath(new URL('.', import.meta.url))
const root = resolve(here, '..')

const config = await getConfig({}, root)
const generator = new Generator({ config, root })
await generator.run()

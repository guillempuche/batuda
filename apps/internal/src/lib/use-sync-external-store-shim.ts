/* ESM re-export of React's native `useSyncExternalStore`. Aliased from
 * `use-sync-external-store/shim` (and its `/index` / `/index.js`
 * subpaths) via `vite.config.ts` so the bundler never reaches the
 * original CJS shim file, which does `require("react")` at runtime and
 * creates a second React module instance through Node's CJS cache.
 *
 * Aliasing the shim straight to bare `'react'` works in production
 * builds but breaks Vite's dev SSR module-runner: the alias keeps
 * `react` in-graph (bypassing externalization), and React 19's root
 * entry is CJS (`react/index.js`), which the runner's
 * `ESModulesEvaluator` can't execute (`module is not defined`). A
 * dedicated ESM file sidesteps that path entirely. */
export { useSyncExternalStore } from 'react'

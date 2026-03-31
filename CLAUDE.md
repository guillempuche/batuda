# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Motion+ is a monorepo containing premium animation features for Motion and Motion for React (previously Framer Motion). Each premium feature lives in a separate package under `packages/`.

## Commands

```bash
yarn                    # Install dependencies
yarn dev                # Start dev site at localhost:3000
yarn build              # Build all packages (via Turbo)
yarn test               # Run Jest tests + bundlesize checks
yarn test-e2e           # Run Playwright tests against dev site
yarn new                # Full publish pipeline: build → test → e2e → publish → notify
yarn new-alpha          # Publish alpha/canary version
```

## Architecture

**Packages:**
- `motion-plus` - React components and utilities (AnimateNumber, Cursor, Carousel, Ticker, Typewriter)
- `motion-plus-dom` - Framework-agnostic DOM utilities (splitText, typewriter, wheel)

**Development:**
- `dev/react-env` - Next.js 15 site for testing components
- Test components live at `dev/react-env/src/app/tests/[slug]/components/`
- Playwright E2E tests live in `/tests/`
- Jest unit tests live alongside source in `__tests__/` folders

**Build tooling:** Turbo (orchestration), Lerna (versioning/publishing), Rollup (bundling)

## Bundle Size Constraints

All components have strict size limits enforced by bundlesize:
- AnimateNumber: 2.7 KB
- Carousel: 6.5 KB
- Cursor: 2.6 KB
- Ticker: 5 KB
- Typewriter: 2 KB
- splitText: 1.0 KB

## Motion API Rules

**Imports:**
- Never import from `framer-motion`
- React files: import from `motion/react`
- Server components: `import * as motion from "motion/react-client"`
- Non-React files: import from `motion`

**animate function signatures:**
- `animate(motionValue, targetValue, options)`
- `animate(originValue, targetValue, options)` - with `onUpdate` in options
- `animate(objectOrElement, values, options)`

**Motion Values:**
- Use `value.on("change", update)` not `value.onChange(update)`
- Never read from MotionValue in render, only in effects/callbacks
- Use `value.stop()` to end current animation

**useTransform:**
- Range mapping: `useTransform(value, inputRange, outputRange, options)`
- Function: `useTransform(() => otherMotionValue.get() * 2)`
- Never use deprecated syntax: `useTransform(value, (latestValue) => newValue)`

## Performance Guidelines

Inside functions that run every frame (useTransform, onUpdate):
- Avoid object allocation, prefer mutation
- Use `for` loops over `forEach`/`map`
- Avoid `Object.entries`, `Object.values`

For hardware-accelerated animations:
- Add `willChange: "transform"` when animating transform properties
- Only valid willChange values: `transform`, `opacity`, `clipPath`, `filter`
- Prefer `transform` over independent transforms (`x`, `scaleX`) unless composing animations

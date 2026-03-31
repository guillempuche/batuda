## Structure

This is a monorepo. Development and test environments live in `/dev`, packages live in `/packages`.

Packages are:

-   `framer-motion`: For React-specific code. More of this should be refactored to `motion-dom` where possible.
-   `motion`: Re-export of `framer-motion`.
-   `motion-dom`: Vanilla/JS animation library.
-   `motion-utils`: Pure functions and easing functions.

## Tests

There are three types of test suites in Motion.

1. Jest (unit) tests
2. Cypress e2e tests
3. Playwright e2e tests

### Jest

Structure code to be unit testable where possible. Co-locate a unit test in a `__tests__` folder. Name the unit tests for a file `<filename>.test.ts(x)`.

Run with `yarn test`.

### Cypress

The Cypress test suite is for testing React code in a browser environment.

When a piece of UI is interactable, or we rely on browser APIs, write a Cypress test. The UI files should live in `dev/react/src/tests` and the test files to run against them live in `packages/framer-motion/cypress/integration`.

Run with `yarn test-e2e`.

### Playwright

The Cypress test suite is for testing vanilla JS code in a browser environment.

The UI files live in `dev/html/public/playwright` and the test files live in `/tests`.

Run with `yarn test-playwright`.

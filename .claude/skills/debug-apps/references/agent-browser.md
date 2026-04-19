# agent-browser Reference

Playwright-based CLI for testing apps as a real user. Already installed in this environment.

## Dev login credentials

Created by `pnpm cli seed` (any preset). Defined in `apps/cli/src/commands/seed.ts`:

- **Email:** `dev@forja.cat`
- **Password:** `forja-dev-2026`

If login fails, re-run `pnpm cli seed --preset minimal` — the seed is idempotent and will (re)create the user via Better-Auth's `signUpEmail`.

## Login flow

Ensure seed data exists before attempting login.

```bash
agent-browser open https://batuda.localhost/login
agent-browser snapshot                                        # see the login form
agent-browser fill "input[name='email']" "dev@forja.cat"
agent-browser fill "input[name='password']" "forja-dev-2026"
agent-browser click "button[type='submit']"
agent-browser wait 3000
agent-browser snapshot                                        # should show dashboard
agent-browser get url                                         # should be / (pipeline)
```

## Navigate

```bash
agent-browser open https://batuda.localhost              # pipeline dashboard
agent-browser open https://batuda.localhost/companies    # company list
agent-browser open https://batuda.localhost/tasks        # tasks view
agent-browser back                                                 # go back
agent-browser reload                                               # reload page
```

## Inspect page state

```bash
agent-browser snapshot                  # accessibility tree with refs (best for AI)
agent-browser screenshot                # screenshot to stdout
agent-browser screenshot /tmp/page.png  # screenshot to file
agent-browser get text "h1"             # read heading text
agent-browser get url                   # current URL
agent-browser get title                 # page title
agent-browser get html ".pipeline"      # HTML of an element
agent-browser get count ".company-card" # count elements
```

## Interact with UI

```bash
agent-browser click "button:has-text('Add company')"
agent-browser fill "input[name='name']" "Can Joan"
agent-browser select "select[name='status']" "prospect"
agent-browser press Enter
agent-browser check "input[name='is_decision_maker']"
agent-browser scroll down 300
agent-browser scrollintoview ".task-list"
```

## Find elements by role/text

```bash
agent-browser find role "button" click             # click first button
agent-browser find text "Save" click               # click element containing "Save"
agent-browser find placeholder "Search companies" fill "restaurant"
agent-browser find testid "pipeline-card" click
```

### Stable `data-testid` hooks in Forja

Prefer `find testid` over text — immune to i18n (en/ca) and layout churn. Conventions Forja uses consistently:

- **Nav:** `nav-<slug>` (mobile bottom) and `nav-desktop-<slug>` (sidebar) — kept distinct so testids resolve to the currently visible element.
- **Tabs:** `tab-<value>` auto-emitted by `PriTabs.Tab` from its `value` prop.
- **Rows / cards:** `<thing>-row-<id>` or `<thing>-card-<slug>` (e.g. `thread-row-<uuid>`, `company-card-tancaments-garraf`).
- **Surface parts:** `<surface>-<part>` (e.g. `login-submit`, `emails-search`, `compose-send`, `where-locate`).

The authoritative list is the source — `grep -r data-testid apps/internal/src` — not this doc. Don't hand-maintain a table here.

Quick mobile login → navigate → drill-in, all via testids:

```bash
agent-browser set device "iPhone 16 Pro"
agent-browser open https://batuda.localhost/
agent-browser find testid "login-email" fill "dev@forja.cat"
agent-browser find testid "login-password" fill "forja-dev-2026"
agent-browser find testid "login-submit" click
agent-browser wait 2500
agent-browser find testid "nav-companies" click
agent-browser find testid "companies-search" fill "tancaments"
agent-browser find testid "company-card-tancaments-garraf" click
agent-browser find testid "tab-where" click
```

## Verify state

```bash
agent-browser is visible ".company-card"
agent-browser is enabled "button[type='submit']"
agent-browser is checked "input[name='active']"
agent-browser wait ".pipeline"                      # wait for element to appear
agent-browser wait 2000                             # wait N ms
```

## Debug

```bash
agent-browser console                   # view console logs
agent-browser errors                    # view JS errors
agent-browser highlight ".status-badge" # highlight element visually
agent-browser eval "document.title"     # run arbitrary JS
agent-browser diff snapshot             # compare current vs last snapshot
agent-browser set media dark            # test dark mode
agent-browser set viewport 375 812     # test mobile (iPhone X)
agent-browser set viewport 1440 900    # test desktop
```

## Network & requests

```bash
agent-browser network requests                        # list network requests
agent-browser network requests --filter "/api/"       # filter API calls
agent-browser set offline on                          # test offline behavior
agent-browser set offline off
```

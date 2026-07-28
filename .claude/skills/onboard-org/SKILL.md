---
name: onboard-org
description: This skill should be used when the user asks to "set up a new org", "create an organization", "onboard a customer", "onboard <name>", "add a member", "add someone to an org", "give <person> access", "create a tenant", or asks what to send a new customer so they can start using Batuda from ChatGPT or Claude.ai. Covers the developer-only `pnpm cli auth` org + first-admin creation (production, rehearsed locally), how members are added afterwards, the one-organization-per-connection rule for people who belong to several orgs, read-only confirmation, and the English getting-started message to hand over.
allowed-tools: Bash(pnpm:*) Bash(infisical:*) Read
---

# Onboarding a new organization

Only a Batuda developer can create an organization. Public signup is off
(`emailAndPassword.disableSignUp = true`), nothing in the product creates an org, and the
`organization` + `member` rows are written by `pnpm cli auth` talking straight to the
database. Everything after the first admin is self-serve: that admin adds their own people
from the web app.

Four steps, in order: **rehearse → create → confirm → hand over** — §1, §2, §5 and §6. The
two sections in between are reference for when they come up, not steps. Never skip the
confirm — an org that reaches a customer half-made costs a support round-trip that a
two-second read would have prevented.

## 1. Rehearse locally

Run the real command against the local database first. It is the only place the CLI hands
back a sign-in link, so it is the only place the whole path can be walked before a customer
walks it.

```bash
pnpm cli auth invite-admin --email owner@acme.com --name "Ada Lovelace" --org-name "Acme" --org-slug acme --locale en
```

The CLI captures the magic link in-process and prints it. With `pnpm dev:server` running,
open it and confirm the sign-in lands. (`pnpm cli auth bootstrap-org` is the other local
path — first admin *and* org on an empty database; it refuses if any `"user"` row exists.)

## 2. Create it in production

Read the target host first, then pass it back as the confirm:

```bash
infisical run --env=prod -- pnpm cli doctor --env cloud
```

That run adds a **Cloud DB host** row the local run does not have, carrying the host the
connection will actually dial — which is not always the address the connection string
appears to name. That row's value is what `--confirm-host` wants. The check fails rather
than guessing when `DATABASE_URL` is missing or still points at localhost.

```bash
infisical run --env=prod -- pnpm cli auth invite-admin --env cloud --email owner@acme.com --name "Ada Lovelace" --org-name "Acme" --org-slug acme --locale en --confirm-host <host from doctor>
```

What each part is doing, and the traps:

- **Two independent halves.** `infisical run --env=prod` injects the secrets into this one
  process; `--env cloud` layers the non-secret settings from
  `apps/server/config.production.json`. Neither stands in for the other, and anything
  already in the environment outranks both.
- **`--confirm-host` replaces the interactive `y/N`** and refuses if it disagrees with the
  resolved `DATABASE_URL`. That is what makes a forgotten `--env cloud` harmless instead of
  a write to the wrong database. Never guess the value — read it from the `Cloud DB host`
  row above.
- **Nothing is emailed and no link is printed** against a database that is not on this
  machine. The account exists; that is all. The person signs in at
  `https://batuda.co/login`, enters their address, and gets their own link, good for five
  minutes from the moment they ask. Minting one here would leave a working way into the
  account sitting in a mailbox.
- **A taken slug aborts with `OrgSlugTaken`.** That guard is the reason a mistyped slug
  cannot bolt a new admin onto another customer's tenant. Add `--allow-existing-org` only
  when joining an existing org is precisely the intent.
- **The role follows the org**: creating one makes them `owner`, joining an existing one
  makes them `admin`.
- **`--locale en|ca`** decides the language of their welcome email and their first visit.
  Omitted leaves it unset.

Secrets never go in argv — pnpm echoes its arguments. Nothing here takes one; keep it that
way.

## 3. Adding more people

- **Another admin, from the CLI** — the same `invite-admin` command with the same
  `--org-slug` plus `--allow-existing-org`. An email that already has an account is reused:
  same account, a second membership.
- **Everyone else — the org's own owner or admin adds them** at
  `https://batuda.co/settings/organization/members`: email, role (`member` or `admin`), and
  language. The route resolves the organization from the session and never from the request
  body, and only an owner or admin of it may add someone.
- **There is no invitation and nothing to accept.** The person is a member the moment the
  form is submitted, and the email they receive carries no link that signs them in.

Prefer handing that second path — the members form — to the admin over running it for them.
It is theirs, it is one form, and it keeps a developer out of the customer's daily work.

## 4. People who belong to more than one organization

An assistant acts in **exactly one organization per call**. A connection authorized for
several has every call refused, with:

> This connection is authorized for more than one organization. Choose one at
> /settings/mcp/connections, or send X-Batuda-Organization-Id with one of them.

The header is not a real option for a chat. Claude.ai stores headers once per connection
from an allow-listed set of names, ChatGPT's connector form has no header field at all, and
where headers exist at all the value is fixed for the whole connection rather than sent per
call. Command-line clients (Claude Code, Cursor, Codex) can set one, so the header stays
useful there and nowhere else.

The approval screen ticks every organization by default, so anyone in two or more lands in
the broken state on their first connection. The fix — and the only way back — is
`https://batuda.co/settings/mcp/connections` → **Change organizations** → tick exactly one
→ **Save**. Reconnecting the assistant does not ask again, because consent is skipped once a
consent row covers the scopes; that page is the route, not a re-approval. Saving with
nothing ticked is refused, since an empty choice reads as "nobody has chosen" and widens
access rather than removing it.

Reading the state on that page:

| What it shows                                          | What it means                                                                                                                              |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| One organization chip                                  | Working. This is the state to aim for.                                                                                                     |
| All your organizations                                 | Nobody has chosen. It reaches every org this person belongs to — which is what breaks every call for anyone in more than one organization. |
| No organization selected                               | Every organization has been cut off from this connection. It reaches nothing.                                                              |
| An owner removed this one. Ask them to allow it again. | The organization stopped it, so the member cannot tick it back on. §4.1                                                                    |

Consequences to state in the handover when they apply:

- One connection per organization — someone working across two adds the connector twice (or
  uses a second chat profile) and narrows each one.
- An API key is pinned to one organization for its whole life, so a coding tool needs one
  key per org.

### 4.1 Who can undo a stop, and who cannot

A stop records who made it, and that record alone decides who can lift it.

- **The member stopped their own connection** — they lift it themselves by choosing that
  organization again. It stays theirs: the organization can stop a connection, but it cannot
  switch somebody's assistant back on for them.
- **The organization stopped it** — an owner or admin lifts it from *Everyone's connections*
  on the same page, where a **Stopped here** list shows what was stopped, by whom, and when,
  with **Allow again**. It takes effect from the assistant's next request.
- **Allowing back only ever reopens the organization doing the allowing**, and only for an
  assistant whose owner has already chosen that organization — otherwise the page says *Its
  owner has not chosen this organization* and does not offer it. Lifting a stop on a
  connection nobody has chosen for would hand it every organization that person belongs to,
  including ones this organization has no say over.
- **Nobody can lift a stop somebody else aimed at them**, whatever their role.

So a customer reporting "an owner removed this one" needs their own org's owner or admin,
not a developer, and not a reconnect.

Include the multi-org part of the handover **only** for people it actually applies to. For a
single-org person it is noise that invites them to change a setting that is already right.

## 5. Confirm — read-only

Nothing below writes anything or spends anything.

```bash
infisical run --env=prod -- pnpm cli data orgs --env cloud
```

```bash
infisical run --env=prod -- pnpm cli data members --env cloud
```

What a healthy result looks like:

- `data orgs` — the new slug and name, with a member count of at least 1.
- `data members` — the person's email against that org slug, with the role that was
  intended (`owner` for a new org, `admin` for a joined one). One row per membership, so
  this is also where a multi-org person shows up as two rows.
- `infisical run --env=prod -- pnpm cli auth list-users --env cloud` — the account itself,
  if the email needs checking. Both halves are needed here too; without them it reads the
  local database and reports a healthy-looking absence.

If the org row exists with a member count of 0, the membership did not land. Re-run the same
`invite-admin` with `--allow-existing-org` — without it the slug that already exists aborts
with `OrgSlugTaken` — rather than creating a second org under a new slug. The account is
reused, and the role lands as `admin` rather than `owner`, because the org is no longer new.

## 6. Hand over the getting-started message

Read `references/handover-message.md`, fill the placeholders, and **print the finished
message in the conversation** in English, ready to paste into an email or a chat. Do not
write it to a file unless asked for one.

Fill in: the organization name, the person's first name, `https://batuda.co`,
`https://api.batuda.co/mcp`. Keep or drop the multi-organization block per §4.

The message is customer-facing copy, so it follows `docs/brand-voice.md`:

- One person speaking — "I", never "we".
- No tool names and no jargon. The connection, not MCP. "Ask it to research", not
  `start_research`.
- Nothing from the banned list: solutions, leverage, empower, seamless, unlock.
- Describe what they will see, not what the system does.

If the customer's locale was set to `ca`, say so when handing the message over — the app and
their email will be in Catalan even though this message is English.

## Troubleshooting

| Symptom                                    | Cause and fix                                                                                                       |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `UsersAlreadyExist`                        | `bootstrap-org` ran against a database that already has users. Use `invite-admin`.                                  |
| `OrgSlugTaken`                             | The slug exists. Check for a typo; add `--allow-existing-org` only if joining it is the intent.                     |
| The command refuses the host               | `--confirm-host` disagrees with the resolved `DATABASE_URL` — the target is not what was assumed. Re-read `doctor`. |
| Customer says every request is refused     | Multi-organization connection. §4.                                                                                  |
| Customer signed in but sees 403 everywhere | Signed in with no organization. Check `data members` for a membership row.                                          |

## Additional resources

- **`references/handover-message.md`** — the English getting-started message to fill in and
  paste: connecting a chat, saving standing instructions, asking for research, and adding
  companies and people.
- `docs/getting-started.md` §5–6 — the local bootstrap path in full.
- `pnpm cli auth --help` — the rest of the family (`list-users`, `promote`,
  `reset-password`, `sessions`).

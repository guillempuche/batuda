---
name: onboard-org
description: This skill should be used when the user asks to "set up a new org", "create an organization", "onboard a customer", "onboard <name>", "add a member", "add someone to an org", "give <person> access", "create a tenant", or asks what to send a new customer so they can start using Batuda from ChatGPT or Claude.ai. Covers the developer-only `pnpm cli auth` org + first-admin creation (production, rehearsed locally), how members are added afterwards, the one-organization-per-connection rule for people who belong to several orgs, read-only confirmation, and the English getting-started message to hand over.
allowed-tools: Bash(pnpm:*) Bash(nix:*) WebFetch WebSearch Read
---

# Onboarding a new organization

Only a Batuda developer can create an organization. Public signup is off
(`emailAndPassword.disableSignUp = true`), nothing in the product creates an org, and the
`organization` + `member` rows are written by `pnpm cli auth` talking straight to the
database. Everything after the first admin is self-serve: that admin adds their own people
from the web app.

**Onboarding means production.** Somebody asking to onboard an org is asking for one a
customer can sign into, so never stop at the local run and never ask which environment is
meant. Local is step one of this job, not a destination: it is where the command is
rehearsed before it touches the real database. Only build a local-only org if the person
says so in as many words.

Settle the details first (§0), then five steps in order: **rehearse → research → create →
confirm → hand over** — §1 to §3, §6 and §7. The two sections in between are reference for
when they come up, not steps. Never skip the confirm — an org that reaches a customer
half-made costs a support round-trip that a two-second read would have prevented.

## 0. Get the details right first

Three of the values are permanent and customer-visible, and nothing downstream will catch a
wrong one:

- **The person's full name** — greets them in the app forever. Ask for it. Never build one
  from the email address: `kobie@…` is not a name, and a guess is visible to them on day one.
- **The organization name and slug** — take them from whoever asked, not from the email
  domain. The name is what the customer reads; the slug is permanent.
- **The email address** — read it back before the production run. A wrong slug aborts with
  `OrgSlugTaken`, but a wrong email has no guard, no delete anywhere in the CLI, and prints
  no link in production. A typo becomes an account nobody can sign into, and the first
  symptom is a customer saying it does not work.

## 1. Rehearse locally

Run the real command against the local database first. It is the only place the CLI hands
back a sign-in link, so it is the only place the whole path can be walked before a customer
walks it.

```bash
pnpm cli auth invite-admin --email owner@acme.com --name "Ada Lovelace" --org-name "Acme" --org-slug acme --locale en
```

The CLI captures the magic link in-process and prints it, already pointing at the host and
port this checkout is served on — a worktree included. With `pnpm dev:server` running, open
it as printed and confirm the sign-in lands. (`pnpm cli auth bootstrap-org` is the other
local path — first admin *and* org on an empty database; it refuses if any `"user"` row
exists.)

Two things this leaves behind, both worth clearing when the rehearsal is done: the dev
server is still running, and the rehearsal org and user stay in the local database — there
is no delete for either, so `pnpm cli db reset` (drop and re-migrate) is the only way back,
and it takes the rest of the local data with it.

## 2. Research the organization and who it sells to

The handover in §7 is not a form letter with a name dropped into it. Four of its lines — the
standing instructions, the research request, the companies to add and the contact — have to be
written for this customer, and they cannot be written without knowing who the customer sells
to. So find that out before going near production.

**Run this research automatically, as part of the job.** Do not ask whether to look them up,
do not ask the person to describe their own market, and do not wait to be told to search — an
onboarding request is the instruction. The only thing worth asking about is a company you
genuinely cannot identify from its domain.

Fetch their own site, then search for what a home page will not tell you — the kinds of
company that actually buy this, any customers or case studies they publish, and the job title
that signs off. Both halves are needed: a site states a pitch, and what the examples need is
the shape of a real prospect list. Two or three searches is usually enough.

Come out of it able to answer, in one sentence each:

- **What they sell, in the words a buyer would use.**
- **What kind of company buys it** — concrete enough to search for, not "businesses".
- **Who inside that company decides**, by role.
- **Where** — one country, a region, or anywhere. Only say a country when their market plainly
  is one; otherwise say nothing about geography and let it stay worldwide.

That is what the four examples get written from. If the research comes up thin, say so when
handing the message over rather than padding the examples with guesses.

This is reading and searching public pages to write a better message. Nothing is written to
their records, nothing is bought, and no guess leaves the message.

## 3. Create it in production

Read the target host first, then pass it back as the confirm:

```bash
nix develop -c infisical run --env=prod -- pnpm cli doctor --env cloud
```

`infisical` is a package in the flake's dev shell, not a global install, so every production
command below is prefixed with `nix develop -c`. Without it they all die with
`command not found`.

That run adds a **Cloud DB host** row the local run does not have, carrying the host the
connection will actually dial — which is not always the address the connection string
appears to name. That row's value is what `--confirm-host` wants. The check fails rather
than guessing when `DATABASE_URL` is missing or still points at localhost.

```bash
nix develop -c infisical run --env=prod -- pnpm cli auth invite-admin --env cloud --email owner@acme.com --name "Ada Lovelace" --org-name "Acme" --org-slug acme --locale en --confirm-host <host from doctor>
```

What each part is doing, and the traps:

- **Three independent parts.** `nix develop -c` puts `infisical` on the path;
  `infisical run --env=prod` injects the secrets into this one process; `--env cloud` layers
  the non-secret settings from `apps/server/config.production.json`. None stands in for
  another, and anything already in the environment outranks the lot.
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
  Pass `ca` only for a customer who works in Catalan and `en` for everyone else. Always pass
  one: omitted leaves the column null, and a null hands the choice to whatever the browser
  asks for — so a Catalan-configured laptop opens an English customer's account in Catalan.
  English is only where it lands once the browser offers nothing either.

Secrets never go in argv — pnpm echoes its arguments. Nothing here takes one; keep it that
way.

## 4. Adding more people

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

## 5. People who belong to more than one organization

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
| An owner removed this one. Ask them to allow it again. | The organization stopped it, so the member cannot tick it back on. §5.1                                                                    |

Consequences to state in the handover when they apply:

- One connection per organization — someone working across two adds the connector twice (or
  uses a second chat profile) and narrows each one.
- An API key is pinned to one organization for its whole life, so a coding tool needs one
  key per org.

### 5.1 Who can undo a stop, and who cannot

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

## 6. Confirm — read-only

Nothing below writes anything or spends anything.

```bash
nix develop -c infisical run --env=prod -- pnpm cli data orgs --env cloud
```

```bash
nix develop -c infisical run --env=prod -- pnpm cli data members --env cloud
```

Every command here prints the flake's shell banner and a couple of deprecation warnings from
the database driver before its table. That is normal output, not a failure — read the table.

What a healthy result looks like:

- `data orgs` — the new slug and name, with a member count of at least 1.
- `data members` — the person's email against that org slug, with the role that was
  intended (`owner` for a new org, `admin` for a joined one). One row per membership, so
  this is also where a multi-org person shows up as two rows.
- `nix develop -c infisical run --env=prod -- pnpm cli auth list-users --env cloud` — the
  account itself, if the email needs checking. Every part is needed here too; without them it
  reads the local database and reports a healthy-looking absence.

If the org row exists with a member count of 0, the membership did not land. Re-run the same
`invite-admin` with `--allow-existing-org` — without it the slug that already exists aborts
with `OrgSlugTaken` — rather than creating a second org under a new slug. The account is
reused, and the role lands as `admin` rather than `owner`, because the org is no longer new.

**Then read the same output for your own account.** Adding yourself for support is what tips
a developer's own address past one organization, and §5 applies to you exactly as it does to
a customer: from the next call, every request through your own connection is refused until
you pick one organization at `https://batuda.co/settings/mcp/connections`. Count your own
rows in `data members` before moving on — the cost of missing it is your own tooling
breaking later, somewhere that looks unrelated.

## 7. Hand over the getting-started message

Read `references/handover-message.md`, fill the placeholders, and **print the finished
message in the conversation** in English, ready to paste into an email or a chat. Do not
write it to a file unless asked for one.

Fill in: the organization name, the person's first name, `https://batuda.co`, and
`https://api.batuda.co/mcp`.

**Then write the four example prompts from the §2 research** — the standing instructions, the
research request, the companies to add and the contact. The template carries no wording for
these on purpose: they are the part a new customer reads to decide whether this tool
understands their work, and somebody else's prospects answer that badly. The reference file
says what each one has to do; the worked illustration in it is there to show the shape and is
never pasted.

**Keep or drop the multi-organization block** on the evidence already in front of you rather
than on a guess: count that person's rows in the §6 `data members` output. Two or more means
keep it, one means drop it, for the reason §5 gives.

**Say who sends it.** Production emails nothing, so until somebody writes to them the
customer does not know the account exists. Print the message and say plainly that it still
needs sending, and from whose address.

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
| `infisical: command not found`             | The `nix develop -c` prefix is missing — it is a flake dev-shell package, not a global install. §3.                 |
| `UsersAlreadyExist`                        | `bootstrap-org` ran against a database that already has users. Use `invite-admin`.                                  |
| `OrgSlugTaken`                             | The slug exists. Check for a typo; add `--allow-existing-org` only if joining it is the intent.                     |
| The command refuses the host               | `--confirm-host` disagrees with the resolved `DATABASE_URL` — the target is not what was assumed. Re-read `doctor`. |
| Customer says every request is refused     | Multi-organization connection. §5.                                                                                  |
| Customer signed in but sees 403 everywhere | Signed in with no organization. Check `data members` for a membership row.                                          |

## Additional resources

- **`references/handover-message.md`** — the English getting-started message to fill in and
  paste: connecting a chat, saving standing instructions, asking for research, and adding
  companies and people.
- `docs/getting-started.md` §5–6 — the local bootstrap path in full.
- `pnpm cli auth --help` — the rest of the family (`list-users`, `promote`,
  `reset-password`, `sessions`).

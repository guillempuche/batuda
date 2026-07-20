# Getting started

A linear walkthrough for a fresh clone of Batuda. Every command here assumes you are at the repo root.

## Contents

- [Prerequisites](#prerequisites)
- [1. Clone + install](#1-clone--install)
- [2. Configure environment files](#2-configure-environment-files)
- [3. Start Docker services](#3-start-docker-services)
- [4. Migrate the database](#4-migrate-the-database)
- [5. Bootstrap the first admin](#5-bootstrap-the-first-admin)
- [6. (Optional) Invite another user](#6-optional-invite-another-user)
- [7. Run the health check](#7-run-the-health-check)
- [8. Start the dev servers](#8-start-the-dev-servers)
- [Env targets: `--env local|cloud`](#env-targets---env-localcloud)
- [Troubleshooting](#troubleshooting)
- [Next steps](#next-steps)

---

## Prerequisites

- **Node 24** — `node -v` should print `v24.x.y`
- **pnpm 10** — `pnpm -v` should print `10.x.y`
- **Docker + Compose** — `docker info` must succeed. Compose is bundled with Docker Desktop; on Linux install `docker-compose-plugin`.

If you use [Nix](https://nixos.org), `nix develop` drops you into a shell with Node and pnpm already pinned — you still need Docker on the host though.

## 1. Clone + install

```bash
git clone https://github.com/<org>/batuda.git
cd batuda
pnpm install
```

Workspace layout:

- `apps/*` — `server`, `internal` (the Batuda web app), `cli`
- `packages/*` — `domain`, `controllers`, `auth`, `ui`, etc.

## 2. Configure environment files

```bash
pnpm cli setup
```

Copies every `.env.example` in the workspace to a matching `.env`. Local defaults are enough for the full dev loop — you only need to edit values if:

- you change the Postgres port (defaults to `5433`)
- you are wiring a real email provider (locally, magic links land in `apps/server/.dev-inbox/` and no configuration is needed)
- you need to talk to a cloud service from the CLI — see [Env targets](#env-targets---env-localcloud)

If you later add a new env key upstream, rerun `pnpm cli setup --update` to append missing keys without overwriting what you already filled in, or `pnpm cli setup --reset` to start fresh.

## 3. Start Docker services

```bash
pnpm cli services up
```

Starts Postgres and MinIO in Docker. Verify with `docker ps` — you should see two `batuda-*` containers in `healthy` state.

Stop with `pnpm cli services down`; inspect with `pnpm cli services status`.

## 4. Migrate the database

```bash
pnpm cli db migrate
```

Runs every CRM migration plus Better Auth's built-in migrations. After this, `docker exec -it batuda-postgres psql -U batuda -c '\dt'` should list:

- **Auth tables**: `user`, `session`, `account`, `verification`, `apiKey`
- **CRM tables**: `company`, `contact`, `interaction`, `task`, `document`, `proposal`, `page`, …

## 5. Bootstrap the first admin and their organization

```bash
pnpm cli auth bootstrap-org
```

Interactively prompts for email, display name, password, organization name, and organization slug. The command **refuses** if any row already exists in `"user"`, so running it twice on the same database fails loudly with `UsersAlreadyExist` instead of silently creating a second admin.

Creating the organization alongside the user is the point. Every CRM table is row-level-security scoped to an organization, so an admin without one signs in successfully and then gets 403 on every read. `pnpm cli auth bootstrap` (no `-org`) still exists and still works, but it stops at the user — reach for it only when you intend to attach the organization yourself.

Keep the password you set — the dev loop uses it for every web login.

## 6. (Optional) Invite another admin

```bash
pnpm cli auth invite-admin \
  --email you@example.com --name "Your Name" \
  --org-name "Acme" --org-slug acme
```

Creates the organization if the slug is free, creates the user, attaches them, and issues a magic link. The role follows the organization: creating one makes you `owner`, joining an existing one makes you `admin`.

Pass `--allow-existing-org` to join an organization that already exists. Without it a slug collision aborts with `OrgSlugTaken` — the guard that stops a mistyped slug from attaching your new admin to somebody else's tenant.

**Locally**, the CLI captures the magic-link URL in-process and prints it to stdout; the server's dev inbox at `apps/server/.dev-inbox/` also catches a Markdown copy of the message. Paste the URL into a browser while `pnpm dev:server` is running to complete sign-in. Under `--env cloud` the running server owns delivery, so the CLI prints a `curl` recipe against `/auth/sign-in/magic-link` instead of the URL itself.

Other useful commands in the same family:

- `pnpm cli auth list-users` — dump every user row
- `pnpm cli auth promote --email alice@example.com --role admin` — change a role
- `pnpm cli auth reset-password --email alice@example.com` — overwrite a credential (prompts for the new password)
- `pnpm cli auth list-keys`, `pnpm cli auth sessions` — read-only inventories

Run `pnpm cli auth --help` for the full list.

## 7. Run the health check

```bash
pnpm cli doctor
```

Verifies the database is reachable, env vars are set, and Docker services are up. Run this any time something feels off — it is the fastest way to localize a broken dev box.

## 8. Start the dev servers

Open two terminals at the repo root:

```bash
# terminal 1 — API + MCP + Better Auth
pnpm dev:server

# terminal 2 — Batuda web app (the internal app)
pnpm dev:internal
```

Dev URLs use portless `*.localhost` hostnames (no `/etc/hosts` edit needed on modern macOS/Linux). portless binds 443 when it can, otherwise a non-privileged port (e.g. `:1355`) — so **open the exact URL the dev server prints on startup** (it carries that port; the hosts below omit it):

- API: `https://api.batuda.localhost`
- API docs (Scalar): `https://api.batuda.localhost/docs`
- Batuda web app: `https://batuda.localhost`

Each tenant runs its own public marketing site from a separate repo (e.g. the Engranatge tenant uses `engranatge-marketing`). Run the tenant's own `pnpm dev` if you need the full loop against a local CRM.

Log in at `/login` with the admin credentials you set in Step 5.

---

## (Optional) Parallel work in git worktrees

Work on several branches at once without a second Docker stack: each git worktree is a *tenant* in the shared stack with its own database + bucket. The `/worktree` skill has the full model; the short version:

```bash
git worktree add .claude/worktrees/<name> -b <branch>   # create
pnpm cli worktree up                                     # its DB + bucket + .env, then migrate + seed
pnpm dev                                                 # portless serves it on its own host
pnpm cli worktree doctor                                 # prints that host + health
pnpm cli worktree down                                   # drop its DB + bucket when done
```

portless serves the worktree at the branch's **last path segment** — `ui/foo` → `https://foo.batuda.localhost`. Use the URL `worktree doctor` prints rather than guessing it.

## Env targets: `--env local|cloud`

Every CLI command accepts `--env local|cloud` (default `local`).

- `--env local` loads `.env` + `apps/cli/.env` + `.env.local` + `apps/cli/.env.local`. This is always safe.
- `--env cloud` loads the same baseline plus the deployed server's non-secret settings from `apps/server/config.production.json` — the same committed file the production server boots on, so the CLI and the deployment cannot drift apart on things like the API base URL or the storage bucket. Secrets are never read from a file: they come from Infisical, injected into the environment by wrapping the command, and anything already in the environment outranks every file the loader touches.

```bash
infisical run --env=prod -- pnpm cli auth invite-admin --env cloud …
```

- `db reset` and `seed` **refuse** to run against anything but a database on this machine. There is no prompt and no override: both rebuild a database from empty, so reaching a real one is never the intent, and a confirm would still let a mistyped keystroke through. The attempt is recorded as a `BLOCKED` line in `cloud-audit.log`.

- The `auth` user / key / session writes do run against production — that is what they are for — so they ask first: a `y/N` confirm (default no) showing the parsed DB hostname. Decline or Ctrl-C appends `REFUSED` to `cloud-audit.log`; confirming appends `OK`.

- Without a terminal to answer that confirm, pass `--confirm-host <hostname>` naming the database the command should reach; `pnpm cli doctor --env cloud` prints the value. It is deliberately not a bare `--yes`: the value belongs to one specific database, so a command copied into another environment fails with `CloudRefused` and a `MISMATCH` audit line instead of quietly running. Treat the hostname as infrastructure detail — it is not a credential, but it names a reachable endpoint, so keep it out of shared logs and public snippets.

- Both checks read the host out of the resolved `DATABASE_URL` rather than trusting `--env cloud`, because credentials arrive through the environment and a forgotten flag must not be the difference between a prompt and a dropped schema. A connection string that won't parse counts as remote. Pure inspections (`doctor`, `auth list-*`, `auth sessions`) never prompt, and nothing pointed at localhost does either — so ordinary local dev and CI are untouched.

The interactive TUI (`pnpm cli:tui`) shows a coloured `LOCAL` / `CLOUD` badge in its header so you always know which database is at risk. Its menu is auto-generated from the CLI command tree, so every new `pnpm cli` subcommand appears in the TUI (and in `pnpm cli --help`) with no extra wiring.

Cloud env requires the Infisical CLI (pinned in `flake.nix`, so the Nix shell already has it) and a logged-in session — `infisical login`. Run `pnpm cli doctor --env cloud` to check the wiring: it reports whether the CLI is available and whether the resolved database host is actually remote. A run without `infisical run` still starts, but every secret falls back to the local baseline, which the DB-host check flags rather than letting it pass silently.

## Troubleshooting

**`docker info` fails.** Docker Desktop is not running. Start it and wait until the daemon is ready, then rerun `pnpm cli services up`.

**Port 5433 already in use.** Another Postgres is bound to the default port. Either stop the other instance or change `POSTGRES_PORT` in `.env` and re-run `pnpm cli services up`.

**TLS cert errors on `*.batuda.localhost`.** Dev servers use self-signed certs. Accept the cert once per hostname in your browser (API + web app = two prompts).

**A worktree host won't load at all** (`ERR_CONNECTION_CLOSED`, no cert prompt). A long-running portless proxy can lack certs for worktree subdomains created after it started — restart the proxy so it re-mints them.

**`pnpm cli auth bootstrap-org` says `UsersAlreadyExist`.** Someone already bootstrapped. Use `pnpm cli auth invite-admin --allow-existing-org` to add yourself to the organization that already exists, or `pnpm cli auth reset-password --email <their-email>` to take over the original account.

**I lost my admin password.** `pnpm cli auth reset-password --email <my-email>`. The CLI prompts for the new password and hashes it directly into `"account"`.

**Magic link URL never prints.** Make sure you are on `--env local`. Cloud runs leave delivery to the running server — `auth invite-admin` prints a `curl` recipe instead, and `auth invite` dispatches through the transactional email provider (Resend) — so neither leaks the URL to stdout. Treat the URL as a credential wherever it does appear: it signs whoever holds it straight in.

**Server logs look empty.** Effect logs persist to `apps/server/server.log` across `node --watch` reloads. `grep event apps/server/server.log | tail -n 20` is the fastest way to catch the last structured log lines.

## Next steps

- [Architecture](architecture.md) — system design, bounded contexts, deployment topology
- [Backend](backend.md) — Effect patterns, routes, MCP tools, auth internals
- [Frontend](frontend.md) — design tokens, MD3, BaseUI, components
- [AI agents](../AGENTS.md) — how AI agents interact with this system

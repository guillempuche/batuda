# Getting started

A linear walkthrough for a fresh clone of Engranatge. Every command here assumes you are at the repo root.

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
git clone https://github.com/<org>/engranatge.git
cd engranatge
pnpm install
```

Workspace layout:

- `apps/*` — `server`, `internal` (Forja CRM), `cli`
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

Starts Postgres and MinIO in Docker. Verify with `docker ps` — you should see two `engranatge-*` containers in `healthy` state.

Stop with `pnpm cli services down`; inspect with `pnpm cli services status`.

## 4. Migrate the database

```bash
pnpm cli db migrate
```

Runs every CRM migration plus Better Auth's built-in migrations. After this, `docker exec -it engranatge-postgres psql -U engranatge -c '\dt'` should list:

- **Auth tables**: `user`, `session`, `account`, `verification`, `apiKey`
- **CRM tables**: `company`, `contact`, `interaction`, `task`, `document`, `proposal`, `page`, …

## 5. Bootstrap the first admin

```bash
pnpm cli auth bootstrap
```

Interactively prompts for email, display name, and password. The command **refuses** if any row already exists in `"user"`, so running it twice on the same database fails loudly with `UsersAlreadyExist` instead of silently creating a second admin.

Keep the password you set — the dev loop uses it for every web login.

## 6. (Optional) Invite another user

```bash
pnpm cli auth invite alice@example.com --name "Alice"
```

Creates a passwordless user and immediately issues a magic link. **Locally**, the CLI captures the URL in-process and prints it to stdout; the server's dev inbox at `apps/server/.dev-inbox/` also catches a Markdown copy of the message. Paste the URL into a browser while `pnpm dev:server` is running to complete sign-in.

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

# terminal 2 — Forja CRM (the internal app)
pnpm dev:internal
```

Dev URLs use portless `*.localhost` hostnames (no `/etc/hosts` edit needed on modern macOS/Linux):

- API: [https://api.batuda.localhost](https://api.batuda.localhost)
- API docs (Scalar): [https://api.batuda.localhost/docs](https://api.batuda.localhost/docs)
- Forja: [https://batuda.localhost](https://batuda.localhost)

The public marketing site lives in a separate repo (`engranatge-marketing`). Run its own `pnpm dev` if you need the full loop against a local CRM.

Log in at `/sign-in` with the admin credentials you set in Step 5.

---

## Env targets: `--env local|cloud`

Every CLI command accepts `--env local|cloud` (default `local`).

- `--env local` loads `.env` + `apps/cli/.env` + `.env.local` + `apps/cli/.env.local`. This is always safe.
- `--env cloud` loads the equivalents with `.cloud` suffix. **Destructive operations** (`db migrate`, `db reset`, `auth bootstrap`, `auth invite`, `auth create-key`, `auth promote`, `auth demote`, `auth revoke-key`, `auth reset-password`) are gated behind a re-prompt: the CLI asks you to type the DB hostname verbatim before it proceeds. Mistyping aborts and appends a `REFUSED` line to `cloud-audit.log` at the repo root. Successful runs append an `OK` line.

Read-only commands (`doctor`, `auth list-users`, `auth list-keys`, `auth sessions`) skip the gate.

The interactive TUI (`pnpm cli:tui`) shows a coloured `LOCAL` / `CLOUD` badge in its header so you always know which database is at risk.

`.env.cloud` files are gitignored — only the committer of a cloud env file should have it on disk.

## Troubleshooting

**`docker info` fails.** Docker Desktop is not running. Start it and wait until the daemon is ready, then rerun `pnpm cli services up`.

**Port 5433 already in use.** Another Postgres is bound to the default port. Either stop the other instance or change `POSTGRES_PORT` in `.env` and re-run `pnpm cli services up`.

**TLS cert errors on `*.engranatge.localhost`.** Dev servers use self-signed certs. Accept the cert once per hostname in your browser (API + Forja = two prompts).

**`pnpm cli auth bootstrap` says `UsersAlreadyExist`.** Someone already bootstrapped. If you don't know the credentials, run `pnpm cli auth reset-password --email <their-email>` to overwrite the password instead.

**I lost my admin password.** `pnpm cli auth reset-password --email <my-email>`. The CLI prompts for the new password and hashes it directly into `"account"`.

**Magic link URL never prints.** Make sure you are on `--env local`. Cloud runs dispatch through AgentMail and intentionally do not leak the URL to stdout.

**Server logs look empty.** Effect logs persist to `apps/server/server.log` across `node --watch` reloads. `grep event apps/server/server.log | tail -n 20` is the fastest way to catch the last structured log lines.

## Next steps

- [Architecture](architecture.md) — system design, bounded contexts, deployment topology
- [Backend](backend.md) — Effect patterns, routes, MCP tools, auth internals
- [Frontend](frontend.md) — design tokens, MD3, BaseUI, components
- [AI agents](../AGENTS.md) — how AI agents interact with this system

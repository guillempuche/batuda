#!/usr/bin/env bash
# SessionStart hook — when a session begins in a linked worktree that hasn't been
# provisioned yet, install deps and create its database + bucket in the shared
# stack so the dev server just works. Runs once per worktree (skips once its
# database exists), and never blocks the session: on failure it says how to finish
# by hand and still exits 0. The slow install/up output goes to a log, not the session.
set -uo pipefail

# Act only inside a linked git worktree. The main checkout's git dir equals the
# shared common dir; a linked worktree's git dir sits under it, so they differ.
gitdir="$(git rev-parse --path-format=absolute --absolute-git-dir 2>/dev/null)" || exit 0
common="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || exit 0
[ -n "$gitdir" ] && [ "$gitdir" != "$common" ] || exit 0

root="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0

# Already provisioned if this worktree's database exists in the shared Postgres.
# Mirror the CLI's slug (branch, drop a leading `worktree-`, lowercase, non-alnum
# → `-`, cap 24; the database swaps `-` for `_`). Best-effort: if the stack is down
# or docker is missing the probe is empty and we (re-)provision below.
branch="$(git -C "$root" rev-parse --abbrev-ref HEAD 2>/dev/null)" || exit 0
slug="$(printf '%s' "${branch#worktree-}" | tr '[:upper:]' '[:lower:]' \
	| sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//' | cut -c1-24)"
db="batuda_${slug//-/_}"
exists="$(docker exec batuda-db psql -U batuda -d postgres -tAc \
	"SELECT 1 FROM pg_database WHERE datname='$db'" 2>/dev/null | tr -d '[:space:]')"
[ "$exists" = "1" ] && exit 0

cd "$root" || exit 0
log="$root/.claude/worktree-up.log"
if pnpm install >"$log" 2>&1 && pnpm cli worktree up >>"$log" 2>&1; then
	printf '%s\n' "Provisioned this worktree's database + bucket (pnpm cli worktree up). Run \`pnpm dev\` to serve it; full log at .claude/worktree-up.log."
else
	printf '%s\n' "Could not auto-provision this worktree (see .claude/worktree-up.log). Start Docker/OrbStack, then run: pnpm install && pnpm cli worktree up"
fi
exit 0

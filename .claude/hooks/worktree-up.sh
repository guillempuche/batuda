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

# Already provisioned if this worktree's `.env` exists and names a database that
# lives in the shared Postgres. Key off the `.env` `up` wrote, not the live
# branch: a PR merge or a branch switch moves HEAD away from what was created, so
# a branch-derived name would miss the real database and re-provision (which
# re-seeds) on every start. No `.env` yet ⇒ first run ⇒ fall through to provision.
env_file="$root/.env"
if [ -f "$env_file" ]; then
	db="$(sed -nE 's#^DATABASE_URL=.*/([^/?[:space:]]+).*#\1#p' "$env_file" | head -1)"
	if [ -n "$db" ]; then
		exists="$(docker exec batuda-db psql -U batuda -d postgres -tAc \
			"SELECT 1 FROM pg_database WHERE datname='$db'" 2>/dev/null | tr -d '[:space:]')"
		[ "$exists" = "1" ] && exit 0
	fi
fi

cd "$root" || exit 0
log="$root/.claude/worktree-up.log"
if pnpm install >"$log" 2>&1 && pnpm cli worktree up >>"$log" 2>&1; then
	printf '%s\n' "Provisioned this worktree's database + bucket (pnpm cli worktree up). Run \`pnpm dev\` to serve it; full log at .claude/worktree-up.log."
else
	printf '%s\n' "Could not auto-provision this worktree (see .claude/worktree-up.log). Start Docker/OrbStack, then run: pnpm install && pnpm cli worktree up"
fi
exit 0

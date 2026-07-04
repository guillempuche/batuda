#!/usr/bin/env bash
# WorktreeRemove hook — drop this worktree's Postgres database and MinIO bucket
# from the shared stack just before its directory is deleted, so those resources
# don't leak. Side-effect only: WorktreeRemove cannot block removal, so this
# always exits 0, even on error.
set -uo pipefail

payload="$(cat)"
# Record each removal so the event's (currently undocumented) shape stays
# auditable and the worktree path field can be confirmed from real runs.
printf '%s\n' "$payload" \
	>>"${CLAUDE_PROJECT_DIR:-.}/.claude/worktree-remove.log" 2>/dev/null || true

# The event carries the worktree's absolute path, but the field name isn't
# published — prefer the documented-style key, then fall back to any string in
# the payload that points under .claude/worktrees/.
wt="$(jq -r '.worktree_path // .worktreePath // .path // empty' <<<"$payload" 2>/dev/null)"
if [ -z "$wt" ] || [ ! -d "$wt" ]; then
	wt="$(jq -r '[.. | strings] | map(select(test("/\\.claude/worktrees/"))) | .[0] // empty' <<<"$payload" 2>/dev/null)"
fi
[ -n "$wt" ] && [ -d "$wt" ] || exit 0

# Stop any dev servers running inside the worktree before its directory is
# removed, so a server isn't left bound to a deleted path. Same script the CLI
# teardown uses; self-guarding and always exits 0.
bash "${CLAUDE_PROJECT_DIR:-.}/scripts/worktree-stop-procs.sh" "$wt" "$$" 2>/dev/null || true

# Read this worktree's real database + bucket from the `.env` it generated at
# provision time — never re-derive them from the live branch. `gh pr merge
# --delete-branch` checks `main` out into the worktree, and switching branches
# inside it likewise leaves HEAD pointing away from what `up` created; deriving
# from the branch then would drop the wrong data — or another worktree's. This
# mirrors the CLI's `down`/`prune`, which key off `.env` for exactly this reason.
env_file="$wt/.env"
[ -f "$env_file" ] || exit 0
db="$(sed -nE 's#^DATABASE_URL=.*/([^/?[:space:]]+).*#\1#p' "$env_file" | head -1)"
bucket="$(sed -nE 's#^STORAGE_BUCKET=([^[:space:]]+).*#\1#p' "$env_file" | head -1)"
# Only a suffixed `batuda_<slug>` / `batuda-assets-<slug>` pair belongs to a
# worktree; the main checkout's bare `batuda` / `batuda-assets` must never drop.
case "$db" in batuda_?*) ;; *) exit 0 ;; esac
case "$bucket" in batuda-assets-?*) ;; *) exit 0 ;; esac

docker exec batuda-db psql -U batuda -d postgres \
	-c "DROP DATABASE IF EXISTS ${db} WITH (FORCE)" >/dev/null 2>&1 || true
docker run --rm --network batuda_default --entrypoint /bin/sh minio/mc:latest \
	-c "mc alias set local http://storage:9000 batuda batuda-secret >/dev/null 2>&1 && mc rb --force local/${bucket}" \
	>/dev/null 2>&1 || true
exit 0

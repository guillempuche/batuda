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

# Mirror the CLI's slug: branch name with a leading `worktree-` dropped,
# lowercased, non-alphanumerics collapsed to `-`, capped at 24 chars. The
# database swaps `-` for `_` (Postgres identifiers); the bucket keeps `-`.
branch="$(git -C "$wt" rev-parse --abbrev-ref HEAD 2>/dev/null)" || exit 0
slug="$(printf '%s' "${branch#worktree-}" | tr '[:upper:]' '[:lower:]' \
	| sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//' | cut -c1-24)"
[ -n "$slug" ] || exit 0
db="batuda_${slug//-/_}"
bucket="batuda-assets-${slug}"

docker exec batuda-db psql -U batuda -d postgres \
	-c "DROP DATABASE IF EXISTS ${db} WITH (FORCE)" >/dev/null 2>&1 || true
docker run --rm --network batuda_default --entrypoint /bin/sh minio/mc:latest \
	-c "mc alias set local http://storage:9000 batuda batuda-secret >/dev/null 2>&1 && mc rb --force local/${bucket}" \
	>/dev/null 2>&1 || true
exit 0

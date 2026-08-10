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

# The integration-test database named after the worktree itself, which the pre-push
# suite uses before `up` writes an `.env` (see scripts/integration-db.ts). A worktree
# can hold one whether or not it was ever provisioned, and its name does not follow
# from the dev database, so it is dropped here rather than alongside the pair below —
# an unprovisioned worktree exits at the `.env` check and would otherwise leak it.
# `.git` in a linked worktree is a file reading `gitdir: <main>/.git/worktrees/<name>`.
# The name is only built when the sanitized suffix is non-empty, so this can never
# collapse to the main checkout's bare `batuda_it`.
before_up_db=""
if [ -f "$wt/.git" ]; then
	wt_name="$(sed -nE 's#^gitdir:.*/worktrees/([^/[:space:]]+)/?[[:space:]]*$#\1#p' "$wt/.git" | head -1)"
	if [ -n "$wt_name" ]; then
		suffix="$(printf '%s' "$wt_name" | tr '[:upper:]' '[:lower:]' \
			| sed -E 's#[^a-z0-9]+#_#g; s#^_+##; s#_+$##' | cut -c1-52)"
		[ -n "$suffix" ] && before_up_db="batuda_it__${suffix}"
	fi
fi
if [ -n "$before_up_db" ]; then
	docker exec batuda-db psql -U batuda -d postgres \
		-c "DROP DATABASE IF EXISTS ${before_up_db} WITH (FORCE)" >/dev/null 2>&1 || true
fi

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
# Drop this worktree's integration-test database too — the pre-push suite creates it
# lazily (batuda_<slug> -> batuda_it__<slug>; see scripts/integration-db.ts) and never
# records it in .env. The batuda_?* guard above means $db is the suffixed form, so
# ${db#batuda_} is <slug> and this can never target the main checkout's batuda_it.
docker exec batuda-db psql -U batuda -d postgres \
	-c "DROP DATABASE IF EXISTS batuda_it__${db#batuda_} WITH (FORCE)" >/dev/null 2>&1 || true
docker run --rm --network batuda_default --entrypoint /bin/sh minio/mc:latest \
	-c "mc alias set local http://storage:9000 batuda batuda-secret >/dev/null 2>&1 && mc rb --force local/${bucket}" \
	>/dev/null 2>&1 || true
exit 0

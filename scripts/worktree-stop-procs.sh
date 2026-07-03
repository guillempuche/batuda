#!/usr/bin/env bash
# Stop the dev servers running inside a worktree, so tearing the worktree down
# doesn't leave a server bound to a now-deleted directory (it keeps serving,
# and its port stays taken, until killed by hand).
#
# The candidate list comes from portless's own route registry
# (~/.portless/routes.json, an array of {hostname, port, pid}) rather than a
# scan of every process — so we only ever touch dev servers portless is actually
# proxying, and never the shared proxy daemon itself (the proxy reads that file;
# it is not listed in it). A candidate is kept only when its working directory
# is inside this worktree, which stays correct even after a merge has swapped the
# branch (portless's hostnames follow the branch; a directory does not).
#
# Best-effort by contract: teardown must never fail because a process couldn't
# be signalled, so every step tolerates errors and the script always exits 0.
#
# Usage: worktree-stop-procs.sh <worktree-abs-path> [caller-pid]
set -uo pipefail

wt="${1:-}"
caller_pid="${2:-}"
[ -n "$wt" ] || exit 0
# Resolve symlinks so the comparison matches lsof's real paths. The directory
# still exists at teardown time (removal happens later), but fall back to the
# raw string if it's already gone.
if [ -d "$wt" ]; then wt="$(cd "$wt" && pwd -P)"; fi
# Re-check: if the `cd` above failed (a race with the removal, or permissions),
# `wt` is now empty — and an empty pattern below would match every path and kill
# every worktree's servers. Bail rather than over-reach.
[ -n "$wt" ] || exit 0

routes="${HOME}/.portless/routes.json"
[ -f "$routes" ] || exit 0

proxy_pid="$(cat "${HOME}/.portless/proxy.pid" 2>/dev/null || true)"

# The pid registered for each active route. node is always present (Node
# monorepo); a parse failure yields nothing and the script simply stops nobody.
route_pids="$(node -e 'try{for(const r of require(process.argv[1]))if(r&&r.pid)console.log(r.pid)}catch{}' "$routes" 2>/dev/null || true)"
[ -n "$route_pids" ] || exit 0

# The working directory of a pid, read from kernel state so it still resolves
# after the directory is unlinked.
proc_cwd() { lsof -a -d cwd -p "$1" -Fn 2>/dev/null | sed -n 's/^n//p' | head -1; }

# Every descendant of a pid (depth-first), so killing a route's wrapper also
# takes the `node --watch` / `vite` child it spawned.
descendants() {
	local parent="$1" child
	for child in $(pgrep -P "$parent" 2>/dev/null || true); do
		descendants "$child"
		printf '%s\n' "$child"
	done
}

# Collect the route wrappers rooted in this worktree, plus their descendants.
targets=""
for pid in $route_pids; do
	[ "$pid" = "$proxy_pid" ] && continue
	[ -n "$caller_pid" ] && [ "$pid" = "$caller_pid" ] && continue
	[ "$pid" = "$$" ] && continue
	cwd="$(proc_cwd "$pid")"
	case "$cwd" in
		"$wt" | "$wt"/*) targets="$targets $pid $(descendants "$pid")" ;;
	esac
done

# De-dupe, then drop the proxy, the caller, and this script itself, so neither
# kill loop below can ever signal them. They can't reach the target set through
# the route scan or the descendant walk, but filtering here keeps that guarantee
# in one place instead of trusting it — and applies it to both signals.
kept=""
for pid in $(printf '%s\n' $targets | awk 'NF' | sort -u); do
	[ "$pid" = "$proxy_pid" ] && continue
	[ -n "$caller_pid" ] && [ "$pid" = "$caller_pid" ] && continue
	[ "$pid" = "$$" ] && continue
	kept="$kept $pid"
done
set -- $kept
[ "$#" -gt 0 ] || exit 0

stopped=0
for pid in "$@"; do
	kill -TERM "$pid" 2>/dev/null && stopped=$((stopped + 1))
done

# Give them a moment to exit on SIGTERM, then SIGKILL any holdouts.
[ "$stopped" -gt 0 ] && sleep 2
for pid in "$@"; do
	kill -0 "$pid" 2>/dev/null && kill -KILL "$pid" 2>/dev/null || true
done

[ "$stopped" -gt 0 ] &&
	printf 'stopped %s dev-server process(es): %s\n' "$stopped" "$*"
exit 0

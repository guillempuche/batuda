#!/usr/bin/env bash
# Compact a PR's screenshots/recordings and sync them to the shared media bucket
# (default github-media), printing the markdown to embed in the PR body. Provider-
# agnostic S3 (R2, MinIO, AWS, …) via the aws CLI, so nothing here names a vendor.
# Works in any repo — the folder is the repo name (github-media/<repo>/).
# No human in the loop.
#
# Compacts as it uploads, so you hand it the raw captures:
#   • PNG / JPEG images  → WebP q80  (crisp UI text, ~8x smaller than PNG)
#   • WebM / MOV videos  → MP4       (downscaled ≤1280 wide, 15 fps, no audio)
#   • already-compact .webp / .mp4 / .gif / .svg → uploaded as-is
#
# Re-running ADDS and OVERWRITES; it never deletes. Anything already under the PR's
# folder that this run does not replace is listed, not removed — a run handed one
# updated screenshot must not take down the recording beside it, which on a merged
# PR is embedded in the body and exists nowhere else.
#
# Pass --replace to delete those instead, once you mean to: that is the "clean slate"
# case, and it is spelled out rather than the default.
#
# Usage: scripts/gh-pr-media.sh [--replace] <pr-number> <file> [<file> ...]
#        scripts/gh-pr-media.sh --prune [--yes]
#
# --prune collects what belongs to pull requests closed WITHOUT merging, which is the
# only state where the media has stopped being worth anything. Merged pull requests keep
# theirs: their bodies embed it and are read long afterwards. Lists by default; --yes
# is what actually deletes.
#
# Config (env, namespaced GITHUB_MEDIA_S3_* so it never collides with the backend
# STORAGE_* or a teammate's own AWS_*). Source of truth = the team secrets
# manager; locally fill `.env.pr-media` (gitignored, from `.env.example.pr-media`),
# which this script auto-sources.
#   GITHUB_MEDIA_S3_ENDPOINT          S3 endpoint, e.g. https://<acct>.eu.r2.cloudflarestorage.com
#   GITHUB_MEDIA_S3_ACCESS_KEY_ID
#   GITHUB_MEDIA_S3_SECRET_ACCESS_KEY
#   GITHUB_MEDIA_PUBLIC_BASE          public read base (public access required), e.g. https://pub-<hash>.r2.dev
#   GITHUB_MEDIA_S3_BUCKET            optional, default github-media
#   GITHUB_MEDIA_S3_REGION            optional, default auto ("auto" for R2 — NOT a jurisdiction like "eu")
#   AWS_CLI                           optional, default `aws` on PATH
#
# Tools: aws (upload) + cwebp & ffmpeg (compaction) — all from the nix dev shell.
#   Emits one markdown line per file (image embed or <video> tag) on stdout.
set -euo pipefail

# Teammate-local config (gitignored), if present — values come from the vault.
# It lives only in the main checkout, never in a linked worktree, so when run
# from a worktree fall back to the main checkout's copy via the shared git dir.
# set -a auto-exports everything the file defines, so the aws CLI below sees it.
env_file=""
if [ -f .env.pr-media ]; then
	env_file=.env.pr-media
elif main_git="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" && [ -n "$main_git" ]; then
	candidate="$(dirname "$main_git")/.env.pr-media"
	[ -f "$candidate" ] && env_file="$candidate"
fi
[ -n "$env_file" ] && {
	set -a
	. "$env_file"
	set +a
}

awscli="${AWS_CLI:-aws}"
command -v "$awscli" >/dev/null || {
	echo "aws CLI not found — enter the nix dev shell (nix develop / direnv); flake.nix provides it" >&2
	exit 127
}

bucket="${GITHUB_MEDIA_S3_BUCKET:-github-media}"
region="${GITHUB_MEDIA_S3_REGION:-auto}"

# Say which file and which checkout, not just which variable. `.env` is copied into every
# worktree when one is created, this one deliberately is not — so "set FOO" sends people
# looking in the worktree they are standing in, which is the one place it never lives.
missing=""
for var in GITHUB_MEDIA_S3_ENDPOINT GITHUB_MEDIA_PUBLIC_BASE \
	GITHUB_MEDIA_S3_ACCESS_KEY_ID GITHUB_MEDIA_S3_SECRET_ACCESS_KEY; do
	eval "value=\${$var:-}"
	[ -n "$value" ] || missing="${missing}${var} "
done
[ -z "$missing" ] || {
	# Name the checkout when one can be found; outside a repository there is nothing
	# useful to point at, and "— . —" is worse than saying nothing.
	main_root="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" &&
		main_root="$(dirname "$main_root")" || main_root=""
	echo "missing: ${missing}" >&2
	if [ -n "$main_root" ]; then
		echo "These live in .env.pr-media in the main checkout, ${main_root}." >&2
	else
		echo "These live in .env.pr-media in the main checkout of the repository." >&2
	fi
	echo "Never in a worktree: a worktree finds that copy through the shared git directory," >&2
	echo "so it is filled once. Start from .env.example.pr-media and fill it from the vault." >&2
	exit 78
}
endpoint="$GITHUB_MEDIA_S3_ENDPOINT"
base="$GITHUB_MEDIA_PUBLIC_BASE"

# Deleting is opt-in. Without it a run only adds and overwrites, so handing over one updated
# screenshot cannot take down the recording beside it — which, on a merged pull request whose
# body embeds both and whose captures exist nowhere else, is unrecoverable.
replace=""
prune=""
confirm=""
while [ "$#" -gt 0 ]; do
	case "$1" in
	--replace) replace=1; shift ;;
	--prune) prune=1; shift ;;
	--yes) confirm=1; shift ;;
	--) shift; break ;;
	-*)
		echo "unknown flag: $1" >&2
		exit 2
		;;
	*) break ;;
	esac
done

usage() {
	echo "usage: $(basename "$0") [--replace] <pr-number> <file>..." >&2
	echo "       $(basename "$0") --prune [--yes]" >&2
	echo "  --replace  delete anything already under this pull request's folder that" >&2
	echo "             the files given here do not replace. Without it, nothing is deleted." >&2
	echo "  --prune    collect media belonging to pull requests that were closed without" >&2
	echo "             merging. Lists what it would remove; --yes actually removes it." >&2
}

if [ -n "$prune" ]; then
	[ "$#" -eq 0 ] || {
		echo "--prune takes no pull request number and no files" >&2
		usage
		exit 2
	}
else
	[ "$#" -ge 2 ] || {
		usage
		exit 2
	}
	pr="$1"
	shift
fi
slug="$(gh repo view --json name -q .name)" # repo name = the per-repo folder
[ -n "$prune" ] || prefix="${slug}/pr-${pr}"

# Converted files land here; removed on any exit.
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

# aws reads AWS_*; map our namespaced vars in for this process only, so the
# backend STORAGE_* and any AWS_* the teammate has are untouched.
export AWS_ACCESS_KEY_ID="$GITHUB_MEDIA_S3_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$GITHUB_MEDIA_S3_SECRET_ACCESS_KEY"
export AWS_REGION="$region"
# Cloudflare R2 rejects awscli 2.x's default request checksums (the newer
# CRC-based integrity headers), which shows up as an intermittent
# "SSL: UNEXPECTED_EOF" partway through an upload. Only send/verify a checksum
# when the operation genuinely needs one so uploads to R2 stay reliable.
export AWS_REQUEST_CHECKSUM_CALCULATION=WHEN_REQUIRED
export AWS_RESPONSE_CHECKSUM_VALIDATION=WHEN_REQUIRED
# Let the CLI itself retry a transient connection drop before the outer loop does.
export AWS_MAX_ATTEMPTS=5
s3api() { "$awscli" s3api "$@" --endpoint-url "$endpoint"; }

# Collect media belonging to pull requests that were closed without merging.
#
# Only that state is safe to sweep. A merged pull request keeps its media for as long as the
# page is readable, which is the entire point of putting it there — and `gh` reports those as
# MERGED, never CLOSED, so the two cannot be confused here. An abandoned one never landed and
# nobody returns to it.
#
# Anything this cannot resolve to a pull request is left alone and named: a folder from a
# mistyped number is a few kilobytes, and guessing wrong in the other direction is permanent.
if [ -n "$prune" ]; then
	all="$(s3api list-objects-v2 --bucket "$bucket" --prefix "${slug}/" \
		--query 'Contents[].Key' --output text 2>"${tmpdir}/err")" || {
		echo "could not list ${slug}/:" >&2
		sed 's/^/  /' "${tmpdir}/err" >&2
		exit 1
	}

	numbers="$(printf '%s\n' $all | sed -nE "s|^${slug}/pr-([0-9]+)/.+|\1|p" | sort -un)"
	[ -n "$numbers" ] || {
		echo "nothing stored under ${slug}/" >&2
		exit 0
	}

	doomed=0
	kept=0
	for n in $numbers; do
		state="$(gh pr view "$n" --json state -q .state 2>/dev/null)" || state=""
		case "$state" in
		CLOSED) : ;; # closed without merging — collect it
		"")
			echo "keep  pr-${n}: does not resolve to a pull request" >&2
			kept=$((kept + 1))
			continue
			;;
		*)
			kept=$((kept + 1))
			continue
			;;
		esac

		for k in $all; do
			case "$k" in
			"${slug}/pr-${n}/"*)
				doomed=$((doomed + 1))
				if [ -z "$confirm" ]; then
					echo "would delete ${k}"
				elif s3api delete-object --bucket "$bucket" --key "$k" >/dev/null 2>&1; then
					echo "deleted ${k}"
				else
					echo "warn: could not delete ${k}" >&2
				fi
				;;
			esac
		done
	done

	if [ -z "$confirm" ]; then
		echo "${doomed} object(s) from closed pull requests, ${kept} pull request(s) untouched." >&2
		echo "Nothing was removed — re-run with --yes to remove them." >&2
	else
		echo "${doomed} object(s) removed, ${kept} pull request(s) untouched." >&2
	fi
	exit 0
fi

lc() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }
# Make a basename safe for an S3 key + public URL: spaces or odd characters would
# break the markdown link and the stale-cleanup match below, so collapse anything
# outside [A-Za-z0-9._-] to a dash (macOS screenshots come with spaces).
safe_name() { printf '%s' "$1" | tr -cs 'A-Za-z0-9._-' '-'; }

# The name a file is uploaded under: images become .webp, videos .mp4, anything
# already compact keeps its name. Pure (no I/O) so the upload and emit passes agree.
target_name() {
	local base
	base="$(safe_name "$(basename "$1")")"
	case "$(lc "$base")" in
	*.png | *.jpg | *.jpeg) echo "${base%.*}.webp" ;;
	*.webm | *.mov) echo "${base%.*}.mp4" ;;
	*) echo "$base" ;;
	esac
}

mime() {
	case "$(lc "$1")" in
	*.png) echo image/png ;;
	*.jpg | *.jpeg) echo image/jpeg ;;
	*.gif) echo image/gif ;;
	*.webp) echo image/webp ;;
	*.svg) echo image/svg+xml ;;
	*.webm) echo video/webm ;;
	*.mp4) echo video/mp4 ;;
	*) echo application/octet-stream ;;
	esac
}

# Produce a compact local file to upload for $1 and echo its path. Images → WebP
# (crisp UI text, far smaller than PNG); videos → a downscaled, 15-fps, silent MP4.
# Files already in a compact format are uploaded untouched. Only the final path is
# printed to stdout; the converters log to stderr, so the caller captures the path.
prepare() {
	local src="$1" out
	out="${tmpdir}/$(target_name "$src")"
	case "$(lc "$src")" in
	*.png | *.jpg | *.jpeg)
		command -v cwebp >/dev/null || {
			echo "cwebp not found — enter the nix dev shell; flake.nix provides it" >&2
			return 1
		}
		cwebp -quiet -q 80 "$src" -o "$out" || return 1
		echo "$out"
		;;
	*.webm | *.mov)
		command -v ffmpeg >/dev/null || {
			echo "ffmpeg not found — enter the nix dev shell; flake.nix provides it" >&2
			return 1
		}
		ffmpeg -y -loglevel error -i "$src" \
			-vf "scale='min(1280,iw)':-2,fps=15" -c:v libx264 -crf 30 \
			-preset veryfast -movflags +faststart -an "$out" || return 1
		echo "$out"
		;;
	*) echo "$src" ;;
	esac
}

# Fail before any upload if a path is wrong, so a bad arg never half-updates the PR.
for f in "$@"; do
	[ -f "$f" ] || {
		echo "no such file: $f" >&2
		exit 1
	}
done

# 1) Compact + upload the new set first (a failure never leaves the PR with no media).
keep=" "
for f in "$@"; do
	name="$(target_name "$f")"
	key="${prefix}/${name}"
	local_file="$(prepare "$f")" || exit 1
	# content-type so .webp/.mp4 render inline; cache-control immutable since a
	# given PR-media object never changes once posted.
	# R2 can still drop a connection mid-upload (an intermittent SSL EOF), so
	# retry a few times before giving up rather than failing the whole PR on one
	# blip; each try is idempotent (same key + immutable object).
	uploaded=""
	for attempt in 1 2 3 4 5; do
		if s3api put-object --bucket "$bucket" --key "$key" --body "$local_file" \
			--content-type "$(mime "$name")" \
			--cache-control "public, max-age=31536000, immutable" \
			>/dev/null 2>"${tmpdir}/err"; then
			uploaded=1
			break
		fi
		# A refused credential fails the same way five times, so retrying it only buys ten
		# seconds and a message blaming the network. The credential is the likeliest thing to
		# be wrong — it lives in one file and rotates rarely — so name it and stop.
		# A revoked key gives AccessDenied or InvalidAccessKeyId; a mistyped one gives
		# InvalidArgument naming the credential. None of them are worth a second attempt.
		if grep -qiE "AccessDenied|InvalidAccessKeyId|SignatureDoesNotMatch|ExpiredToken|Unauthorized|InvalidArgument|Credential|403|401" \
			"${tmpdir}/err"; then
			echo "refused by the bucket — this reads like a credential, not a connection:" >&2
			sed 's/^/  /' "${tmpdir}/err" >&2
			echo "Check .env.pr-media in the main checkout; an R2 secret access key cannot be" >&2
			echo "re-read after creation, so a rotated one has to be replaced there." >&2
			exit 1
		fi
		sleep 2
	done
	[ -n "$uploaded" ] || {
		echo "upload failed after 5 attempts: ${key}" >&2
		# Without this the last error is swallowed and every failure looks alike.
		sed 's/^/  /' "${tmpdir}/err" >&2
		exit 1
	}
	# Remember this object so the delete pass below knows not to remove it.
	keep="${keep}${key} "
done

# 2) Delete anything still under the PR's folder that we didn't just upload —
#    i.e. screenshots/recordings the PR no longer uses.
# `|| true` here used to hide a failed list behind an empty one, so a token without list
# permission left every stale object in place while the run still reported success.
if existing="$(s3api list-objects-v2 --bucket "$bucket" --prefix "${prefix}/" \
	--query 'Contents[].Key' --output text 2>"${tmpdir}/err")"; then
	stale=""
	for k in $existing; do
		[ "$k" = "None" ] && continue
		# Is this object one we just uploaded? keep holds every uploaded key wrapped in
		# spaces, so a space-padded match means "yes, leave it"; no match means stale.
		case "$keep" in
		*" $k "*) : ;; # just uploaded — keep
		*) stale="${stale}${k} " ;;
		esac
	done

	if [ -n "$stale" ] && [ -n "$replace" ]; then
		for k in $stale; do
			if s3api delete-object --bucket "$bucket" --key "$k" >/dev/null 2>&1; then
				echo "deleted ${k}" >&2
			else
				echo "warn: could not delete stale ${k}" >&2
			fi
		done
	elif [ -n "$stale" ]; then
		# Named rather than removed: whatever is here may still be embedded in the pull
		# request, and this run has no way to know.
		echo "left in place under ${prefix}/ (pass --replace to remove):" >&2
		for k in $stale; do echo "  ${k}" >&2; done
	fi
else
	echo "warn: could not list ${prefix}/ — nothing was cleaned up:" >&2
	sed 's/^/  /' "${tmpdir}/err" >&2
fi

# 3) Emit the markdown for the current set.
for f in "$@"; do
	name="$(target_name "$f")"
	url="${base%/}/${prefix}/${name}"
	case "$(lc "$name")" in
	*.mp4) printf '<video controls src="%s"></video>\n' "$url" ;;
	*) printf '![%s](%s)\n' "$name" "$url" ;;
	esac
done

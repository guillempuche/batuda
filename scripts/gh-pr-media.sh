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
# Re-running for a PR REPLACES its media: new files are uploaded first, then any
# stale object left under the PR's folder is deleted — so updated screenshots
# and recordings don't pile up.
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
#
# Usage: scripts/gh-pr-media.sh <pr-number> <file> [<file> ...]
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
endpoint="${GITHUB_MEDIA_S3_ENDPOINT:?set GITHUB_MEDIA_S3_ENDPOINT to the S3 endpoint, e.g. https://<account>.eu.r2.cloudflarestorage.com}"
base="${GITHUB_MEDIA_PUBLIC_BASE:?set GITHUB_MEDIA_PUBLIC_BASE to the public read base, e.g. https://pub-<hash>.r2.dev}"
: "${GITHUB_MEDIA_S3_ACCESS_KEY_ID:?set GITHUB_MEDIA_S3_ACCESS_KEY_ID}"
: "${GITHUB_MEDIA_S3_SECRET_ACCESS_KEY:?set GITHUB_MEDIA_S3_SECRET_ACCESS_KEY}"

[ "$#" -ge 2 ] || {
	echo "usage: $(basename "$0") <pr-number> <file>..." >&2
	exit 2
}
pr="$1"
shift
slug="$(gh repo view --json name -q .name)" # repo name = the per-repo folder
prefix="${slug}/pr-${pr}"

# Converted files land here; removed on any exit.
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

# aws reads AWS_*; map our namespaced vars in for this process only, so the
# backend STORAGE_* and any AWS_* the teammate has are untouched.
export AWS_ACCESS_KEY_ID="$GITHUB_MEDIA_S3_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$GITHUB_MEDIA_S3_SECRET_ACCESS_KEY"
export AWS_REGION="$region"
s3api() { "$awscli" s3api "$@" --endpoint-url "$endpoint"; }

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
	s3api put-object --bucket "$bucket" --key "$key" --body "$local_file" \
		--content-type "$(mime "$name")" \
		--cache-control "public, max-age=31536000, immutable" >/dev/null || {
		echo "upload failed: ${key}" >&2
		exit 1
	}
	# Remember this object so the delete pass below knows not to remove it.
	keep="${keep}${key} "
done

# 2) Delete anything still under the PR's folder that we didn't just upload —
#    i.e. screenshots/recordings the PR no longer uses.
existing="$(s3api list-objects-v2 --bucket "$bucket" --prefix "${prefix}/" \
	--query 'Contents[].Key' --output text 2>/dev/null || true)"
for k in $existing; do
	[ "$k" = "None" ] && continue
	# Is this object one we just uploaded? keep holds every uploaded key wrapped in
	# spaces, so a space-padded match means "yes, leave it"; no match means stale.
	case "$keep" in
	*" $k "*) : ;; # just uploaded — keep
	*) s3api delete-object --bucket "$bucket" --key "$k" >/dev/null ||
		echo "warn: could not delete stale ${k}" >&2 ;;
	esac
done

# 3) Emit the markdown for the current set.
for f in "$@"; do
	name="$(target_name "$f")"
	url="${base%/}/${prefix}/${name}"
	case "$(lc "$name")" in
	*.mp4) printf '<video controls src="%s"></video>\n' "$url" ;;
	*) printf '![%s](%s)\n' "$name" "$url" ;;
	esac
done

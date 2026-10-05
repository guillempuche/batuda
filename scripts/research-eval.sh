#!/usr/bin/env bash
# Run the research eval with everything a pass needs, so nobody assembles it by hand.
# Two different things have to be present and they come from two different places:
# the ROUTING (which vendor and model each tier uses) is not secret and is committed
# in apps/server/config.production.json, and the KEYS come from Infisical. Miss the
# routing and every provider quietly answers with canned data, which reads as a total
# quality collapse rather than as a setup mistake.
#
# Usage:
#   scripts/research-eval.sh --env <infisical-env> --golden <file> [--runs N]
#     [--production] [--dry-run] [--baseline] [--schema <name>] [--out <file>]
#     [--org <id>] [--user <id>] [--concurrency N] [--show-routing]
#   scripts/research-eval.sh --env <infisical-env> --kind-reask [--rows <file>] [--asks N]
#     Re-ask the company-of-this-kind check about stored scan rows (eval/README.md).
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$root"

env_name=""; golden=""; runs=3; schema=""; out=""; org=""; user=""; concurrency=1
production=false; dry_run_only=false; baseline=false; show_routing=false
kind_reask=false; rows=""; asks=""; pass_flags=""

# Every flag that takes a value checks one is there: as the last word on the line
# it would otherwise read an argument that does not exist, and under `set -u` that
# ends the script with "unbound variable" instead of saying what is missing.
need_value() { [ "$1" -ge 2 ] || { echo "$2 needs a value" >&2; exit 2; }; }

while [ $# -gt 0 ]; do
	case "$1" in
		--env) need_value $# "$1"; env_name="$2"; shift 2 ;;
		--golden) pass_flags="$pass_flags $1"; need_value $# "$1"; golden="$2"; shift 2 ;;
		--runs) pass_flags="$pass_flags $1"; need_value $# "$1"; runs="$2"; shift 2 ;;
		--schema) pass_flags="$pass_flags $1"; need_value $# "$1"; schema="$2"; shift 2 ;;
		--out) pass_flags="$pass_flags $1"; need_value $# "$1"; out="$2"; shift 2 ;;
		--org) pass_flags="$pass_flags $1"; need_value $# "$1"; org="$2"; shift 2 ;;
		--user) pass_flags="$pass_flags $1"; need_value $# "$1"; user="$2"; shift 2 ;;
		--concurrency) pass_flags="$pass_flags $1"; need_value $# "$1"; concurrency="$2"; shift 2 ;;
		--production) pass_flags="$pass_flags $1"; production=true; shift ;;
		--dry-run) pass_flags="$pass_flags $1"; dry_run_only=true; shift ;;
		--baseline) pass_flags="$pass_flags $1"; baseline=true; shift ;;
		--show-routing) show_routing=true; shift ;;
		--kind-reask) kind_reask=true; shift ;;
		--rows) need_value $# "$1"; rows="$2"; shift 2 ;;
		--asks) need_value $# "$1"; asks="$2"; shift 2 ;;
		-h|--help) sed -n '9,14p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
		*) echo "unknown argument: $1" >&2; exit 2 ;;
	esac
done
if [ -z "$env_name" ]; then echo "--env is required" >&2; exit 2; fi
if [ "$kind_reask" = false ]; then
	if [ -n "$rows" ] || [ -n "$asks" ]; then echo "--rows and --asks belong to --kind-reask" >&2; exit 2; fi
	if [ -z "$golden" ]; then echo "--golden is required (or --kind-reask)" >&2; exit 2; fi
	if [ ! -f "$golden" ]; then echo "golden file not found: $golden" >&2; exit 2; fi
# A pass flag beside --kind-reask would be dropped without a word, and the pass
# somebody meant to start would never run.
elif [ -n "$pass_flags" ]; then
	echo "--kind-reask takes only --env, --rows, --asks and --show-routing; not$pass_flags" >&2; exit 2
fi

# The database is always this checkout's own, under every Infisical environment:
# a dev environment ships a DATABASE_URL of its own and would otherwise win.
if [ ! -f "$root/.env" ]; then echo "no .env in $root — run 'pnpm cli worktree up' first" >&2; exit 2; fi
db_url=$(grep -m1 '^DATABASE_URL=' "$root/.env" | cut -d= -f2- | tr -d "\"'")
if [ -z "$db_url" ]; then echo "no DATABASE_URL in $root/.env" >&2; exit 2; fi

# Every RESEARCH_* setting except the keys, one NAME=value per line. They are handed
# to the run as separate arguments, never as one string a second shell re-splits.
routing=()
while IFS= read -r setting; do routing+=("$setting"); done < <(node -e '
	const config = require("./apps/server/config.production.json")
	for (const [key, value] of Object.entries(config))
		if (key.startsWith("RESEARCH_") && !key.includes("API_KEY")) console.log(`${key}=${value}`)
')
if [ "${#routing[@]}" -eq 0 ]; then echo "no RESEARCH_* routing in apps/server/config.production.json" >&2; exit 2; fi
# Names only. A value is never a secret here, but the habit of not printing the
# environment is what keeps a key out of a log.
if [ "$show_routing" = true ]; then printf 'routing carried in:'; printf ' %s' ${routing[@]+"${routing[@]%%=*}"}; printf '\n'; fi

# The one place the committed routing and the local database are laid over the keys.
run_it() {
	# DATABASE_URL is laid on here, after `infisical run`, on purpose: exported
	# before it, the dev environment's own value would displace it. It is this
	# machine's local dev credential, not a vault secret.
	# The ${a[@]+"${a[@]}"} spelling keeps an empty array from ending the script
	# under `set -u` on the bash macOS ships (3.2).
	nix develop --command infisical run "--env=$env_name" -- \
		env ${routing[@]+"${routing[@]}"} ${extra[@]+"${extra[@]}"} \
		"DATABASE_URL=$db_url" "$@"
}

# The re-ask is one question to the extract model about rows already written down:
# it needs the routing, the keys and the local database (the model cache lives
# there, and is gone past), and nothing else a pass needs.
if [ "$kind_reask" = true ]; then
	extra=()
	reask=(pnpm cli research kind-reask)
	if [ -n "$rows" ]; then reask+=(--rows "$rows"); fi
	if [ -n "$asks" ]; then reask+=(--asks "$asks"); fi
	log="eval/kind-reask-$(date +%Y-%m-%d-%H%M).log"
	run_it "${reask[@]}" 2>&1 | tee "$log"
	echo "log: $log"
	exit 0
fi

# Org and user are seeded with generated ids, so they are read rather than typed.
if { [ -z "$org" ] || [ -z "$user" ]; } && ! command -v psql >/dev/null; then
	echo "psql is not on PATH — pass --org and --user, or run this inside 'nix develop'" >&2; exit 2
fi
# The connection string never goes in argv, where `ps` shows it to everything
# else running on this machine: psql reads the same parts from the environment.
db_env() {
	PGHOST=$(node -p 'new URL(process.argv[1]).hostname' "$db_url")
	PGPORT=$(node -p 'new URL(process.argv[1]).port || 5432' "$db_url")
	PGUSER=$(node -p 'decodeURIComponent(new URL(process.argv[1]).username)' "$db_url")
	PGPASSWORD=$(node -p 'decodeURIComponent(new URL(process.argv[1]).password)' "$db_url")
	PGDATABASE=$(node -p 'new URL(process.argv[1]).pathname.slice(1)' "$db_url")
	export PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE
}
if [ -z "$org" ] || [ -z "$user" ]; then db_env; fi
if [ -z "$org" ]; then org=$(psql -tAc "SELECT id FROM organization WHERE slug='taller';" | head -1); fi
if [ -z "$user" ]; then user=$(psql -tAc "SELECT id FROM \"user\" WHERE email='admin@taller.cat';" | head -1); fi
if [ -z "$org" ] || [ -z "$user" ]; then echo "could not resolve --org/--user from the local database" >&2; exit 2; fi

stem=$(basename "$golden"); stem="${stem%.json}"
if [ -z "$out" ]; then out="eval/$stem-$(date +%Y-%m-%d-%H%M).json"; fi
log="${out%.json}.log"
mkdir -p "$(dirname "$out")"

# A whole-market request runs past the 20-minute default, and past that wall the run
# is killed and left out of the figures rather than counted as a market with nothing in it.
extra=()
if [ "$schema" = "prospect_scan_v1" ]; then extra+=(RESEARCH_RUN_DEADLINE_SEC=2400); fi

cli=(pnpm cli research eval --org "$org" --user "$user" --golden "$golden"
	--runs "$runs" --concurrency "$concurrency" --by-bucket)
if [ -n "$schema" ]; then cli+=(--schema "$schema"); fi
# Registries and the tiers this environment holds no key for go off for a comparison
# pass, so a contact number cannot come from a source the change has nothing to do with.
if [ "$production" = false ]; then cli+=(--quality); fi

# The free pre-flight always runs first: the database is local, no tier would answer
# with canned data, every golden row parses, every vendor is reachable — and it is
# priced from a real earlier report when this golden set has a baselines folder.
pre=("${cli[@]}" --dry-run)
if [ -d "eval/reports/$stem" ]; then pre+=(--price-from "eval/reports/$stem"); fi
# The log starts here rather than at the pass, so what the pre-flight checked is
# in the file somebody reads afterwards instead of only on the screen of whoever
# was watching. pipefail makes the pre-flight's own exit status the pipeline's.
echo "pre-flight (spends nothing)…" | tee "$log"
if ! run_it "${pre[@]}" 2>&1 | tee -a "$log"; then echo "pre-flight failed — nothing was spent; fix it before the pass" >&2; exit 1; fi
if [ "$dry_run_only" = true ]; then echo "log: $log"; exit 0; fi

full=("${cli[@]}" --out "$out")
if [ "$baseline" = true ]; then full+=(--baseline); fi
echo "pass running — report: $out, log: $log"
run_it "${full[@]}" 2>&1 | tee -a "$log"
echo "report: $out"
echo "log: $log"

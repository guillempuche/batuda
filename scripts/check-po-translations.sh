#!/usr/bin/env bash
# Usage: check-po-translations.sh [app_dir] [source_locale]
#
# Regenerates Lingui catalogs from source (extract --clean) and checks each
# non-source locale for translation completeness. Semantics:
#
#   - All msgstrs empty  → treat as a placeholder locale (e.g. freshly reserved
#                          for translators); pass.
#   - All msgstrs filled → complete; pass.
#   - Mixed              → partial state; FAIL so the commit doesn't land in a
#                          half-translated shape.
#
# Extract mutates .po files; lefthook's `stage_fixed: true` auto-stages the
# side-effects so the commit ends up with catalogs in sync with source.

set -euo pipefail

app_dir="${1:-.}"
source_locale="${2:-en}"
locales_dir="$app_dir/src/locales"

if [ ! -d "$locales_dir" ]; then
	echo "⋯ [$app_dir] no src/locales — skipping i18n check"
	exit 0
fi

( cd "$app_dir" && pnpm exec lingui extract --clean >/dev/null )

failed=0
for po in "$locales_dir"/*/messages.po; do
	[ -f "$po" ] || continue
	locale=$(basename "$(dirname "$po")")
	[ "$locale" = "$source_locale" ] && continue

	# Count body msgids and body msgstrs (exclude the PO header, which is
	# always one `msgid ""` + one `msgstr ""` pair at the top of the file).
	total_msgid=$(grep -c '^msgid "' "$po" || true)
	empty_msgstr=$(grep -c '^msgstr ""$' "$po" || true)
	body_total=$(( total_msgid - 1 ))
	body_empty=$(( empty_msgstr - 1 ))

	if [ "$body_total" -le 0 ]; then
		continue
	fi

	if [ "$body_empty" -eq "$body_total" ]; then
		echo "⋯ [$app_dir] $locale: placeholder (all $body_total msgstrs empty) — skipping"
		continue
	fi

	if [ "$body_empty" -gt 0 ]; then
		echo "❌ [$app_dir] $locale: $body_empty of $body_total msgstrs untranslated in $po"
		failed=1
	fi
done

if [ "$failed" -eq 0 ]; then
	echo "✅ [$app_dir] i18n catalogs OK"
fi
exit "$failed"

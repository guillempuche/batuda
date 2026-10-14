// Turns out/results.jsonl into per-condition tables. Prints nothing from the corpora.
import { readFileSync } from 'node:fs'

const HERE = new URL('.', import.meta.url).pathname
const rows = readFileSync(`${HERE}out/results.jsonl`, 'utf8')
	.split('\n')
	.filter(Boolean)
	.map(l => JSON.parse(l))
const CONDS = [
	'baseline',
	'benign_fenced',
	'adversarial_fenced',
	'adversarial_segment',
]
const sum = xs => xs.reduce((a, b) => a + (b ?? 0), 0)
const mean = xs => (xs.length ? sum(xs) / xs.length : 0)
const fmt = (x, d = 2) => (typeof x === 'number' ? x.toFixed(d) : String(x))
const pct = (num, den) => (den ? `${((100 * num) / den).toFixed(0)}%` : '–')

const ok = rows.filter(r => r.ok)
const fail = rows.filter(r => !r.ok)
console.log(`calls: ${rows.length}  ok: ${ok.length}  failed: ${fail.length}`)
for (const f of fail) console.log(`  FAIL ${f.key}: ${f.error}`)
const usageIn = sum(ok.map(r => r.usage?.inputTokens?.total ?? 0)),
	usageOut = sum(ok.map(r => r.usage?.outputTokens?.total ?? 0))
console.log(
	`tokens in=${usageIn} out=${usageOut}  est cost=${((usageIn * 0.015 + usageOut * 0.06) / 1000).toFixed(1)}¢  mean ms=${fmt(mean(ok.map(r => r.ms)), 0)}`,
)
console.log(
	`prompt chars: enrichment mean=${fmt(mean(ok.filter(r => r.schema === 'company_enrichment_v1').map(r => r.prompt_chars)), 0)} scan mean=${fmt(mean(ok.filter(r => r.schema === 'prospect_scan_v1').map(r => r.prompt_chars)), 0)}`,
)

const probe = rows.filter(r => r.condition === 'record_probe')
if (probe.length)
	console.log(
		`\nrecord-shape probe: ${probe.map(p => (p.ok ? `ok (custom keys: ${JSON.stringify(p.pre?.custom_keys)})` : `FAIL ${p.error}`)).join(' | ')}`,
	)

console.log('\n== company_enrichment_v1 (per condition, all samples) ==')
console.log(
	'condition            n  strong_fit  other  none | fit rows→pass | contacts→CEO (pre) | →CEO (post-guard) | custom filled | done',
)
for (const c of CONDS) {
	const rs = ok.filter(
		r => r.schema === 'company_enrichment_v1' && r.condition === c,
	)
	if (!rs.length) continue
	const v = rs.map(r => r.pre.verdict)
	const strong = v.filter(x => x === 'strong_fit').length,
		none = v.filter(x => x === null || x === undefined).length
	const fitRows = sum(rs.map(r => r.pre.fit_rows)),
		fitPass = sum(rs.map(r => r.pre.fit_pass))
	const contacts = sum(rs.map(r => r.pre.contacts)),
		ceo = sum(rs.map(r => r.pre.contacts_ceo))
	const contactsPost = sum(rs.map(r => r.post.contacts)),
		ceoPost = sum(rs.map(r => r.post.contacts_ceo))
	const custom = sum(rs.map(r => r.pre.custom_keys.length)),
		done = sum(rs.map(r => r.pre.custom_done))
	console.log(
		`${c.padEnd(20)} ${String(rs.length).padStart(2)}  ${String(strong).padStart(10)}  ${String(v.length - strong - none).padStart(5)}  ${String(none).padStart(4)} | ${String(fitRows).padStart(5)}→${String(fitPass).padEnd(4)} ${pct(fitPass, fitRows).padStart(4)} | ${String(contacts).padStart(4)}→${String(ceo).padEnd(3)} ${pct(ceo, contacts).padStart(4)}       | ${String(contactsPost).padStart(4)}→${String(ceoPost).padEnd(3)} ${pct(ceoPost, contactsPost).padStart(4)}     | ${String(custom).padStart(6)} (${fmt(custom / rs.length, 1)}/call) | ${done}`,
	)
}
console.log(
	'\nper run verdict (baseline | benign | adv-fenced | adv-segment), samples joined by /',
)
for (const run of [
	...new Set(
		ok.filter(r => r.schema === 'company_enrichment_v1').map(r => r.run),
	),
]) {
	const cell = c =>
		ok
			.filter(r => r.run === run && r.condition === c)
			.map(
				r =>
					`${r.pre.verdict ?? '∅'}:${r.pre.fit_pass}/${r.pre.fit_rows}:ceo${r.pre.contacts_ceo}/${r.pre.contacts}`,
			)
			.join(' / ')
	console.log(`  ${run.slice(0, 8)}  ${CONDS.map(cell).join('  |  ')}`)
}

console.log('\n== prospect_scan_v1 (per condition, all samples) ==')
console.log(
	'condition            n  rows  emp filled→=30 (pre) | →=30 (post) | loc filled→Girona (pre) | →Girona (post) | unconfirmed filled | custom entries | done',
)
for (const c of CONDS) {
	const rs = ok.filter(
		r => r.schema === 'prospect_scan_v1' && r.condition === c,
	)
	if (!rs.length) continue
	const rowsN = sum(rs.map(r => r.pre.rows))
	const ef = sum(rs.map(r => r.pre.emp_filled)),
		e30 = sum(rs.map(r => r.pre.emp_30)),
		e30p = sum(rs.map(r => r.post.emp_30)),
		efp = sum(rs.map(r => r.post.emp_filled))
	const lf = sum(rs.map(r => r.pre.loc_filled)),
		lg = sum(rs.map(r => r.pre.loc_girona)),
		lgp = sum(rs.map(r => r.post.loc_girona)),
		lfp = sum(rs.map(r => r.post.loc_filled))
	const unc = sum(rs.map(r => r.pre.unconfirmed_filled)),
		custom = sum(rs.map(r => r.pre.custom_entries)),
		done = sum(rs.map(r => r.pre.custom_done))
	console.log(
		`${c.padEnd(20)} ${String(rs.length).padStart(2)}  ${String(rowsN).padStart(4)}  ${String(ef).padStart(4)}→${String(e30).padEnd(4)} ${pct(e30, rowsN).padStart(4)}       | ${String(efp).padStart(4)}→${String(e30p).padEnd(4)} ${pct(e30p, rowsN).padStart(4)} | ${String(lf).padStart(4)}→${String(lg).padEnd(4)} ${pct(lg, rowsN).padStart(4)}          | ${String(lfp).padStart(4)}→${String(lgp).padEnd(4)} ${pct(lgp, rowsN).padStart(4)}    | ${String(unc).padStart(5)} ${pct(unc, rowsN).padStart(4)}       | ${String(custom).padStart(6)} (${fmt(custom / rs.length, 1)}/call) | ${done}`,
	)
}
console.log(
	'\nper run (baseline | benign | adv-fenced | adv-segment): rows:emp=30:girona:unconfirmed, samples joined by /',
)
for (const run of [
	...new Set(ok.filter(r => r.schema === 'prospect_scan_v1').map(r => r.run)),
]) {
	const cell = c =>
		ok
			.filter(r => r.run === run && r.condition === c)
			.map(
				r =>
					`${r.pre.rows}:${r.pre.emp_30}:${r.pre.loc_girona}:${r.pre.unconfirmed_filled}`,
			)
			.join(' / ')
	console.log(`  ${run.slice(0, 8)}  ${CONDS.map(cell).join('  |  ')}`)
}
console.log(
	'\nguard drops per condition (placeholder/wrong_kind/ungrounded/unsupported, summed):',
)
for (const c of [...CONDS, 'record_probe']) {
	const rs = ok.filter(r => r.condition === c)
	if (!rs.length) continue
	console.log(
		`  ${c.padEnd(20)} ${sum(rs.map(r => r.drops.placeholder))}/${sum(rs.map(r => r.drops.wrong_kind))}/${sum(rs.map(r => r.drops.ungrounded))}/${sum(rs.map(r => r.drops.unsupported))}`,
	)
}

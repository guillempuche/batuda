#!/bin/sh
# Reads ten stored research runs into ./corpora as JSON files. SELECT only.
# DATABASE_URL arrives from the environment (injected by infisical); never echoed.
set -e
S="$(cd "$(dirname "$0")" && pwd)"
IDS="'4448b881-00ed-4452-8e47-509fc83da663','90ae9956-ccc1-4156-9434-882d9f962145','48de2464-d5a7-4c7e-bb9a-7d340f46a961','511a55e5-341e-4c6b-8609-210eda59d038','53e13e30-df11-4f8d-bf94-3ecb3635bd74','12648e45-17de-4a9f-a7cd-1647ccbd3fef','02d505a3-ae8e-443a-a248-d057a263f235','f81d3eb1-60a3-463d-b2c5-92ae440bddd0','6c25faef-bec5-4536-af84-5de6ff79a665','654a092a-61d8-4bea-8ab3-40419a684505'"
psql "$DATABASE_URL" -At -v ON_ERROR_STOP=1 -c "select current_database() || ' runs=' || (select count(*) from research_runs)"
psql "$DATABASE_URL" -At -v ON_ERROR_STOP=1 -c "select row_to_json(t) from (select r.id, r.schema_name, r.query, r.research_text, r.findings, (select coalesce(json_agg(distinct s.url), '[]'::json) from research_run_sources rs join sources s on s.id = rs.source_id where rs.research_id = r.id) as manifest from research_runs r where r.id in ($IDS)) t" > "$S/corpora.jsonl"
node -e '
const fs=require("fs");const S=process.argv[1];
const lines=fs.readFileSync(S+"/corpora.jsonl","utf8").split("\n").filter(Boolean);
for(const l of lines){const r=JSON.parse(l);fs.writeFileSync(S+"/corpora/"+r.id+".json",JSON.stringify(r));
console.log(r.id.slice(0,8),r.schema_name,"text="+r.research_text.length,"manifest="+r.manifest.length,"query="+r.query.length)}
console.log("files:",lines.length)' "$S"
rm -f "$S/corpora.jsonl"

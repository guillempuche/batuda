# Changelog

All notable changes to this project will be documented in this file.


## 2026-06-01 (server-v2026.6.1)

### Features

* **server:** add products MCP tools ([05bd36c](https://github.com/guillempuche/batuda/commit/05bd36c6c4c66de12d2d18b7f7f23827b414a8ad))
* **server:** add proposals MCP tools ([74afd4d](https://github.com/guillempuche/batuda/commit/74afd4d25afaf462e175944404f030683f6622e4))
* **server:** add research lifecycle MCP tools ([a99e7ce](https://github.com/guillempuche/batuda/commit/a99e7ce317a5099016a9b100b09c3c5bcc1f1fb7))
* **server:** close per-resource MCP get-by-id, delete, and extension gaps ([26a6541](https://github.com/guillempuche/batuda/commit/26a6541ccd6bcf4a412ac5712de14a2bd6515716))

### Bug Fixes

* **server:** stamp organization_id on calendar createInternalEvent ([e357648](https://github.com/guillempuche/batuda/commit/e3576489de91003ccca98a96b67d2ad3053333b4))
* **server:** stamp organization_id on contacts create ([6738873](https://github.com/guillempuche/batuda/commit/67388737422073c4c588c6cc1e832d40cb6edbfe))
* **server:** stamp organization_id on documents create ([8046f24](https://github.com/guillempuche/batuda/commit/8046f24a1256e41aa0a548925a2384fe38710288))
* **server:** stamp organization_id on products create ([3de3ae7](https://github.com/guillempuche/batuda/commit/3de3ae75ce3d99a09d1841438dab61616b46a7c1))
* **server:** stamp organization_id on proposals create ([a6ff836](https://github.com/guillempuche/batuda/commit/a6ff83625a0750b001e88e9143ee4b55a31b2dd7))

### Refactoring

* **server:** annotate safe-retry MCP tools as idempotent ([bd0debf](https://github.com/guillempuche/batuda/commit/bd0debf7247d1ea4ee28f46375a9fda9128a50fb))
* **server:** consolidate narrow MCP write tools into action tools ([462b256](https://github.com/guillempuche/batuda/commit/462b2564162623eb58a1ee6481314565610ea104))
* **server:** declare CurrentOrg dependency on research-mcp tools ([db00ac4](https://github.com/guillempuche/batuda/commit/db00ac48a47e2e8ca14cdcc0f6749929dc838f30))

### Tests

* **server:** pin MCP tool annotation invariants ([34526cf](https://github.com/guillempuche/batuda/commit/34526cfeb562e1da32e70d6604c3c6f8fd97f0d6))

## 2026-05-31 (server-v2026.5.31)

### Features

* add process crash guards to server and mail-worker ([115fa85](https://github.com/guillempuche/batuda/commit/115fa85ed22d87e1410813c7bf588e8012ac59ad))

### Bug Fixes

* **server:** cap calendar slot caches to prevent unbounded growth ([0989b54](https://github.com/guillempuche/batuda/commit/0989b54d6cfc562ccd7b5f9b10e2abfe042eab80))
* **server:** run webhook lookup before backgrounding delivery ([6686061](https://github.com/guillempuche/batuda/commit/668606174cd81f8332af0679c1391558ad667476))
* stop event-sink failures from stranding research runs ([23bd88c](https://github.com/guillempuche/batuda/commit/23bd88c266104b6ff1ae6acc8584f6ff4d9fb59a))

### Tests

* **server:** clear stale JWKS so oauth-auth tests can mint tokens ([e86a662](https://github.com/guillempuche/batuda/commit/e86a662c31f9ad27ccce61844442127c1cb6a5a9))

## 2026-05-29 (server-v2026.5.29-1)

### CI/CD

* **deploy:** run server and mail-worker on base-compat runtime ([7ea3691](https://github.com/guillempuche/batuda/commit/7ea3691cfc63046714c2523551f6f6bc5a1a7466))

## 2026-05-29 (server-v2026.5.29)

### Features

* add org-owned API keys for AI/MCP sessions ([97bfc1b](https://github.com/guillempuche/batuda/commit/97bfc1bd6020ba35d28f1f5ce198991ce07bc544))
* attribute MCP API keys to their creating member ([1476a6d](https://github.com/guillempuche/batuda/commit/1476a6d7eb6dca9b2a241cf8d3dbad27a0268fe2))
* authenticate MCP sessions via OAuth 2.1 ([06ff241](https://github.com/guillempuche/batuda/commit/06ff2419052254b1c9c5be6491d2789180a84351))
* clean up abandoned OAuth clients and show connection provenance ([9c7e9fe](https://github.com/guillempuche/batuda/commit/9c7e9fe4e21fd87149c9f9ee50e9978de642c7b8))
* **server:** authenticate MCP sessions with org API keys ([91788a1](https://github.com/guillempuche/batuda/commit/91788a12a01c2285adc43da78f091a09480175b2))
* **server:** back the MCP OAuth tables with row-level security ([faf2b67](https://github.com/guillempuche/batuda/commit/faf2b6759e213d4b3c12cbfba5dbc92902b30869))
* **server:** make OAuth access-token lifetime configurable ([9ba9752](https://github.com/guillempuche/batuda/commit/9ba9752bd4eced6f9ece266dbd663c48b8bbdeef))
* **server:** rate-limit org API keys and return 429 when exceeded ([d89d2c0](https://github.com/guillempuche/batuda/commit/d89d2c0945dc4c7708725bdb4237a6a3e85d8dae))
* **server:** record task lifecycle events ([5d53d67](https://github.com/guillempuche/batuda/commit/5d53d673bddf49b823c26f56f0a23fd65e8868fc))
* **server:** record task transitions on the company timeline ([f9e2cfe](https://github.com/guillempuche/batuda/commit/f9e2cfe8e162e799f58b8ec34de2951dd80b6a35))
* **server:** RLS backstop on Better Auth org tables ([a06a96e](https://github.com/guillempuche/batuda/commit/a06a96e16ff4c24c9108552775e373ad3e98c36b))

### Bug Fixes

* **server:** pin MCP token verification to EdDSA ([820cffa](https://github.com/guillempuche/batuda/commit/820cffac072fa17aae451919236921e8dceb3a32))
* **server:** reconcile MCP task transitions with TaskService ([da4f661](https://github.com/guillempuche/batuda/commit/da4f661a809a166169f905aae1b4d803babb062c))
* **server:** stamp organization_id on task creation ([695e30f](https://github.com/guillempuche/batuda/commit/695e30ff53d88c4dabfcb140732a68cd2dd4a230))
* **server:** target invite links at an explicit APP_PUBLIC_URL ([4aee4f3](https://github.com/guillempuche/batuda/commit/4aee4f34bbbc19fd5bf805e2730a2e20245e3fd7))
* **server:** unify task list filtering through TaskService ([0118b9e](https://github.com/guillempuche/batuda/commit/0118b9ecaaf1e97ae9452dadf38acee5416efa12))

### Refactoring

* **server:** centralize storage config and clarify daemon layers ([b359e6e](https://github.com/guillempuche/batuda/commit/b359e6e0f90ee4ab45f7bd43e22ced00c34a8cb9))
* **server:** drop as-any casts in handlers and MCP tools ([39a67fa](https://github.com/guillempuche/batuda/commit/39a67fa395338f98899a8919b81b4674c3717a5b))
* **server:** move task get/update/bulkComplete onto TaskService ([c472a3a](https://github.com/guillempuche/batuda/commit/c472a3ac610015cef2bdbb55051ee0d3458b13a1))
* **server:** move task transitions onto TaskService ([7d00219](https://github.com/guillempuche/batuda/commit/7d00219038cf85f7acf5e246e099bfb204e57d87))
* **server:** replace raw new Date() with DateTime/now() ([291426c](https://github.com/guillempuche/batuda/commit/291426c5fd675e13de606aaa6cf7a630c222297a))
* **server:** require every env var, remove Config defaults ([3b82a90](https://github.com/guillempuche/batuda/commit/3b82a906e42e609a7c1b6284f1d44413b71d63e0))
* **server:** scope research fan-out as a system actor ([fe49680](https://github.com/guillempuche/batuda/commit/fe49680404b21c7c59752f19c30fa6ccacd7feb3))
* **server:** unify org-scope entry behind enterOrgScope ([523e4e4](https://github.com/guillempuche/batuda/commit/523e4e44a3ed99ea9b12f00973df25b08bd58461))

### Tests

* **server:** verify MCP tokens over the real JWKS endpoint ([cf4fa0a](https://github.com/guillempuche/batuda/commit/cf4fa0aea96c4cfd399b626ec81ed3f587928ee3))

### Chores

* pin better-auth packages to exact versions ([ef1ac5a](https://github.com/guillempuche/batuda/commit/ef1ac5adfe65a712923fba27a3d3ffe53e4c12a2))
* upgrade better-auth to 1.6.11 and add oauth-provider ([63ea900](https://github.com/guillempuche/batuda/commit/63ea900065d77d8fcb8731f8ca1e075e5065f580))

## 2026-05-19 (server-v2026.5.20)

### Features

* **server:** add user-scoped RLS for 3 research tables ([bc3b193](https://github.com/guillempuche/batuda/commit/bc3b193a52581f9a74394221ed7b1da0c2724b44))
* **server:** match email search against per-message FTS ([5677f0d](https://github.com/guillempuche/batuda/commit/5677f0d27cd41f754b961db0cdd345c52485adba))
* **server:** retry SMTP sends and surface SmtpSendFailed ([4f59048](https://github.com/guillempuche/batuda/commit/4f590486a712afba9ba2ace7c0d9e0bd5e7056e6))
* **server:** schedule the staged-attachment orphan sweep ([0d2da50](https://github.com/guillempuche/batuda/commit/0d2da50af09343c4456b23ba04e653021565f89f))

### Bug Fixes

* **server:** disable scale-to-zero so in-flight requests don't 504 ([72eb0f2](https://github.com/guillempuche/batuda/commit/72eb0f2aa935eda23ec26547e7ba6cb535b6eb8b))

### Refactoring

* **domain:** move CurrentOrg from @batuda/controllers ([73f3c35](https://github.com/guillempuche/batuda/commit/73f3c352ebfe488226c23b0f13b09cf69c7e42f6))
* move ParticipantMatcher to @batuda/email ([0ef885c](https://github.com/guillempuche/batuda/commit/0ef885c0129b6151e7ea366e4d9c9c14ff3a2768))

### Tests

* **server:** cover email FTS across subject, body, recipients ([c525338](https://github.com/guillempuche/batuda/commit/c52533845474ad221db4e6470a7f57f970508979))
* **server:** cover SMTP retry policy with TestClock ([df61ca7](https://github.com/guillempuche/batuda/commit/df61ca7c270b9c7ce29b3518a0a393d40071d10a))
* **server:** cover user-scoped RLS isolation ([b4015dd](https://github.com/guillempuche/batuda/commit/b4015dd664569d309599d1d8f8a6d490187e8b4c))
* split unit and integration suites across all workspaces ([3c5d7be](https://github.com/guillempuche/batuda/commit/3c5d7be3ee14cc99fad7d67ba7eca1e5aca414b0))

### CI/CD

* gate merges with two-phase pipeline (unit + integration against Neon + MinIO) ([fb0cadb](https://github.com/guillempuche/batuda/commit/fb0cadb8cdbf0d5c0830a0ae811d1e9bc5e37823))
* **release:** ui v2026.5.17 ([9abce7a](https://github.com/guillempuche/batuda/commit/9abce7a9b09919066852f9506366b587ab79885c))

## 2026-05-17 (server-v2026.5.17)

### Features

* add company where panel with nominatim geocoder ([5f9fca2](https://github.com/guillempuche/batuda/commit/5f9fca251e940ebbaa85918ae0b9b6b8c056483b))
* add data-testid hooks across Forja for agent-browser ([5cf0c12](https://github.com/guillempuche/batuda/commit/5cf0c12f1a192185a381398507d724867a8617e0))
* add magic-link sign-in and show-password toggle on /login ([590234c](https://github.com/guillempuche/batuda/commit/590234c3e53d171523f3af6435039223e8833a00))
* add multi-provider fallback to research capabilities ([b267ef4](https://github.com/guillempuche/batuda/commit/b267ef44de5c10f4c6a11162f4b03c967dde0d0c))
* add passwordOptOut user field and set-password plugin route ([a9dda3e](https://github.com/guillempuche/batuda/commit/a9dda3eaf5acd4ab00e91edcfc63824a446cc5d7))
* add provider-agnostic email attachments ([c1c3614](https://github.com/guillempuche/batuda/commit/c1c3614dd91e3c7fe9411f7ca9c97700105b444d))
* **auth:** add auth package with Better Auth adapter and use cases ([ae3e7ff](https://github.com/guillempuche/batuda/commit/ae3e7ffb6d65aff1b751b256ca7938b1134534c5))
* **auth:** add inviteAdmin to bootstrap orgs and admin members ([929dcf9](https://github.com/guillempuche/batuda/commit/929dcf919454cab72b9292af138e6572532eb2e2))
* **auth:** auto-set active org for single-org users at sign-in ([b26153a](https://github.com/guillempuche/batuda/commit/b26153a4344a29c356361bb3f4a51ef3e360a1c0))
* **auth:** collapse .localhost cookie domain to apex for worktrees ([7f63524](https://github.com/guillempuche/batuda/commit/7f63524f815ee9cbc05850795c66cb779e092bb5))
* **auth:** enable cross-subdomain cookies via derived parent domain ([e94e259](https://github.com/guillempuche/batuda/commit/e94e2592ce207d953f0cdd2318d7b862a210258c))
* **auth:** make /sign-in/email rate limit env-driven (loose for dev) ([2c0c33e](https://github.com/guillempuche/batuda/commit/2c0c33eb524c78dddb2e3e8830b1f7615b3121fc))
* build thread detail view at /emails/$threadId ([09852ba](https://github.com/guillempuche/batuda/commit/09852ba243f7702ef7900b5aef0bd501ff30e101))
* **calendar:** add bounded context with booking port and stub adapter ([d7e2a94](https://github.com/guillempuche/batuda/commit/d7e2a94a644631b9a11e347804942fb4196fb83c))
* **calendar:** extract Zoom Teams and Meet URLs from invites ([bebc55f](https://github.com/guillempuche/batuda/commit/bebc55f291afe777e615a61d24789c9bbf9b5294))
* **calendar:** implement cal.com v2 booking provider adapter ([a44cfa8](https://github.com/guillempuche/batuda/commit/a44cfa89d38e28e8d85e49ab59d0962f25c9c7c4))
* close silent-signup gaps for passwordless sign-in ([bb0757e](https://github.com/guillempuche/batuda/commit/bb0757e9c0b2b7bbefb0c88011092bd376354c54))
* **controllers:** accept block bodies and inline attachment refs ([2b2a54a](https://github.com/guillempuche/batuda/commit/2b2a54a11814aecbe090b882d617871cbf73619a))
* **controllers:** add cal.com webhook route group ([ece54c5](https://github.com/guillempuche/batuda/commit/ece54c500dcf08e6a810470ea7d91601ec9cc123))
* **controllers:** add tasks and calendar route groups ([1c68996](https://github.com/guillempuche/batuda/commit/1c68996cf09e3f902795a9e9dc267ed52a9e7429))
* **controllers:** rebuild email API surface for per-org BYO mailboxes ([83e28b5](https://github.com/guillempuche/batuda/commit/83e28b5ddfe1913bd348302ec99203eb7736a9c1))
* **domain:** add schemas for CRM entities and pages ([8c8d938](https://github.com/guillempuche/batuda/commit/8c8d938f03b768464ecb27bdf83d6be808b7d70d))
* **domain:** add task and calendar timeline schemas ([670afbf](https://github.com/guillempuche/batuda/commit/670afbf8474bf958131ffe3a6c9e6e6452924ffe))
* **domain:** add timeline activity, message participants, interaction denorms ([8eda7c5](https://github.com/guillempuche/batuda/commit/8eda7c5785b97151bbcfc472c8d954fbdf0e0bc5))
* **email:** add block-based email package ([bd12619](https://github.com/guillempuche/batuda/commit/bd1261907a2a05f0184eee584df6d82873e95cc2))
* enable multi-org isolation at the data layer ([7c465e7](https://github.com/guillempuche/batuda/commit/7c465e7f599a936cd8c1188b8f23e52cdde94515))
* extract PriSelect into shared @engranatge/ui/pri ([145fbdc](https://github.com/guillempuche/batuda/commit/145fbdc16fe9d4cd109c84dc257badabb9c9f3e3))
* integrate agentmail with outbound deliverability tracking ([4bee2a6](https://github.com/guillempuche/batuda/commit/4bee2a65b70df2ffccaaa0e2509a5d85e21c80e7))
* make email schema and services provider-agnostic ([0738e8f](https://github.com/guillempuche/batuda/commit/0738e8f643a15584fa31d93a9d92a048e24f6f7e))
* persist inbound attachments and soft-delete on email_messages ([934a820](https://github.com/guillempuche/batuda/commit/934a8201a475b3159a6209f2324964841737cae4))
* promote place to first-class company state ([4323796](https://github.com/guillempuche/batuda/commit/4323796fb9bb61144446f6862fea9f8a723548cb))
* **research:** add research package with agent loop, providers, and budget ([1a1c4d7](https://github.com/guillempuche/batuda/commit/1a1c4d7f62c9026698799eccc779061823ca73f5))
* **research:** add tiered LLMs, retry harness, db caches, tool loop ([eabfa93](https://github.com/guillempuche/batuda/commit/eabfa93c06b5c2dbc0c9fb73092226704d706873))
* **research:** cap fibers with per-tenant fairness ([9ab6e9b](https://github.com/guillempuche/batuda/commit/9ab6e9b2f8d6775f18d92d0f1cb1d84da60dc370))
* **server:** adapt blob storage for research scrape cache ([047541b](https://github.com/guillempuche/batuda/commit/047541b660fd4c2c57f2d79f63408d8a06d94e52))
* **server:** add cal.com webhook handler and calendar MCP tools ([4448e7c](https://github.com/guillempuche/batuda/commit/4448e7c9058f2d6a53e2956140ea7750f5a6d4ad))
* **server:** add clear-suppression endpoint for contacts ([857a5c0](https://github.com/guillempuche/batuda/commit/857a5c0604a1f357b56d1e9aa620093e3571c1f2))
* **server:** add Effect HTTP + MCP server with CRM routes ([0274bf1](https://github.com/guillempuche/batuda/commit/0274bf1cd22326572afd5bd2c7944b40073203c0))
* **server:** add inbox health probe daemon ([d7891e0](https://github.com/guillempuche/batuda/commit/d7891e09943a3cf541d57c7b8e5dad7a3b998d0e))
* **server:** add MCP prompts, HTTP transport, and tool improvements ([c7b5e7c](https://github.com/guillempuche/batuda/commit/c7b5e7c3bd6c9765dd918b8af856aabcce799a86))
* **server:** add observability, health endpoint, and CRM skill ([a168113](https://github.com/guillempuche/batuda/commit/a168113f2bd9539dfd4acb044997f41d64cb7538))
* **server:** add OrgResolution service and provideOrg helper ([8567b01](https://github.com/guillempuche/batuda/commit/8567b01f6639c359fda9a8642a1a0f537aa96e3b))
* **server:** add participant matcher with discriminated result ([62a683d](https://github.com/guillempuche/batuda/commit/62a683d3e338a977b9001eda8a3622c623b0f730))
* **server:** add recordings, local-inbox email provider, and S3 storage ([cdf40bf](https://github.com/guillempuche/batuda/commit/cdf40bf120355129d772b892f6845ef545ebf10e))
* **server:** add research cache tables and phase checkpoint ([28ccc33](https://github.com/guillempuche/batuda/commit/28ccc33f3da43732d6f39b23862b0ca70eda5eaa))
* **server:** add sendInvitation to TransactionalEmailProvider ([cbb4cba](https://github.com/guillempuche/batuda/commit/cbb4cba254626d70af2266c4e79800e43bfe8b5c))
* **server:** add server-backed drafts, inbox footers, and fix inbox resolution bugs ([0d931e2](https://github.com/guillempuche/batuda/commit/0d931e2b87c5c6358b9b1d471c91214e931f047e))
* **server:** add tasks and calendar handlers with schema migration ([10c3161](https://github.com/guillempuche/batuda/commit/10c3161b2634c15d11511444fddc509049f3e53d))
* **server:** add timeline activity service with atomic writes ([30c2cb3](https://github.com/guillempuche/batuda/commit/30c2cb3259e17e638b40a47a0646926bf1ad351a))
* **server:** aggregate research_paid_spend by provider, user, or tool ([a4ec9c1](https://github.com/guillempuche/batuda/commit/a4ec9c14d193659060bc0b8189db2d6dbacb5db9))
* **server:** allow wildcard subdomains in ALLOWED_ORIGINS for dev only ([e586602](https://github.com/guillempuche/batuda/commit/e586602cd4f03ec59b5322be79cc2e2ae6dbb78e))
* **server:** auto-task on BOOKING_CANCELLED/REJECTED with serialised lock ([959ed6a](https://github.com/guillempuche/batuda/commit/959ed6a89e813d527f656b723de6fefe54c9419d))
* **server:** envelope listThreads, thread mutations, cc/bcc, full MCP parity ([161ffa0](https://github.com/guillempuche/batuda/commit/161ffa0a6e729386a909850b5d3f2ff41064641d))
* **server:** expand tasks MCP tools with lifecycle actions ([5daaed5](https://github.com/guillempuche/batuda/commit/5daaed595b815c7258da36dca3d9e21f29ab1216))
* **server:** extend timeline-activity with meeting and task events ([d5aa0f0](https://github.com/guillempuche/batuda/commit/d5aa0f093316f6e7793a97e7980f6e3d2b3e1f16))
* **server:** ingest calendar invites from inbound email ([2c37306](https://github.com/guillempuche/batuda/commit/2c37306b3dd5eb740f9d29a72aebf35ec54939c1))
* **server:** introduce local inboxes, read tracking, recipient roles ([219bb82](https://github.com/guillempuche/batuda/commit/219bb823f4ed459f44a0d69354f7e78a65454f53))
* **server:** local inbox CRUD with provider sync, clientId tagging, MCP parity ([e4606a8](https://github.com/guillempuche/batuda/commit/e4606a8f8918cd3b820e37e3d2435288d4f2b88a))
* **server:** move email drafts to Postgres via DraftStore ([114cc2f](https://github.com/guillempuche/batuda/commit/114cc2f3fc5267b72e1aecbd758562e2dba32668))
* **server:** recognise app_service as a Better Auth admin role ([e85a8ad](https://github.com/guillempuche/batuda/commit/e85a8ad04d3de4e9abdcaa47b82c694ac9d793af))
* **server:** render block bodies with durable attachment staging ([9da9e00](https://github.com/guillempuche/batuda/commit/9da9e000437005bff889ad4645102370d7b5c3d9))
* **server:** replace AgentMail with per-org BYO IMAP/SMTP ([29bd238](https://github.com/guillempuche/batuda/commit/29bd238c4cd4dc51d2220d27842633e9394498d7))
* **server:** replace API key auth with Better Auth sessions ([c454b47](https://github.com/guillempuche/batuda/commit/c454b471ae2234b0d8463dada30128ae9214d1a9))
* **server:** replace email_draft_bodies with full email_drafts table ([3aa2a2d](https://github.com/guillempuche/batuda/commit/3aa2a2dca2991d3109bc150c45b0f389d8fb79cb))
* **server:** resolve CurrentOrg for cal.com webhook handler ([570c40d](https://github.com/guillempuche/batuda/commit/570c40d14ced4f3653777bee68baeeab61c4cd77))
* **server:** route email, call, interaction ingest through timeline ([55ebe9e](https://github.com/guillempuche/batuda/commit/55ebe9e1286119df59402ecfeb598c66af2a7637))
* **server:** set app.current_user_id alongside app.current_org_id ([bdb08eb](https://github.com/guillempuche/batuda/commit/bdb08ebfa313e2829178e7224a4326c513ca4248))
* **server:** split system transactional mail into its own provider ([87dfefc](https://github.com/guillempuche/batuda/commit/87dfefc9e63c973364dded10b50f3d4f7735d1bc))
* **server:** tighten DB privileges and lock app_user out of auth-table writes ([93a6496](https://github.com/guillempuche/batuda/commit/93a64960979589e8eb0f813795becf3297ea8723))
* **server:** type page content, add get endpoint and granular MCP block tools ([bba951c](https://github.com/guillempuche/batuda/commit/bba951c0718094c1031d66744aa94ad1f3aa62b9))
* **server:** wire HTTP client upstream of calendar booking provider ([28d954d](https://github.com/guillempuche/batuda/commit/28d954d38c178228f2a532bea598d1b1a091e4b1))
* **server:** wire org sendInvitationEmail to magic-link flow ([e1e6ea2](https://github.com/guillempuche/batuda/commit/e1e6ea233efc719e4c9547c09ce10cd834dbd7a9))
* **server:** wire per-request GUC + role for RLS ([8273a96](https://github.com/guillempuche/batuda/commit/8273a96d2cb272f4da85a6bdd83a8b777bcab7e4))
* **server:** wire research endpoints, MCP tools, and provider config ([8188d70](https://github.com/guillempuche/batuda/commit/8188d705fa42e66dc71798c95c75d778da9bed20))
* split db-reset from seeding and surface seed errors ([e1cd8e3](https://github.com/guillempuche/batuda/commit/e1cd8e305c85092e5333db1d15bcddfe648d08d4))
* **timeline:** expose timeline resource, tool, and Forja activity view ([0ef2f07](https://github.com/guillempuche/batuda/commit/0ef2f07f90934e039ff620897bcf19ca74f140e2))
* **ui:** add design tokens and Tiptap block extensions ([28afb1f](https://github.com/guillempuche/batuda/commit/28afb1f792af93d7a833ca1a5e020f6920683542))
* **ui:** add Every Layout primitives ([255615b](https://github.com/guillempuche/batuda/commit/255615b82de3a6be48daa41aec3eef4d0c277864))
* **ui:** add Pri primitives and organize token sections ([02e25e4](https://github.com/guillempuche/batuda/commit/02e25e4e2ad1f9aba2bc67865dd6ab2c0eaf0e19))
* **ui:** add PriTextarea primitive ([12e909c](https://github.com/guillempuche/batuda/commit/12e909cc3bafbb62488079fec4bc282e4b71d7fa))
* **ui:** add typed block schemas and expand catalog to 13 blocks ([b6d25d1](https://github.com/guillempuche/batuda/commit/b6d25d1e45259fae8526f64a31539b30ace93370))
* **ui:** restyle Pri wrappers with workshop visual language ([e07f52a](https://github.com/guillempuche/batuda/commit/e07f52af77425c232ead592aa6be5ce2bae3cc3b))
* wire BA sendResetPassword into the transactional provider ([2ea10a3](https://github.com/guillempuche/batuda/commit/2ea10a3340d1759f3426d86d79f49dfb4140d268))

### Bug Fixes

* **auth:** backfill empty user.name on inviteAdmin re-runs ([a0b6365](https://github.com/guillempuche/batuda/commit/a0b63653fbe2558f943de5cb9564fa8562106679))
* **auth:** loosen /sign-in/email rate limit ([81c46a0](https://github.com/guillempuche/batuda/commit/81c46a0b2bbf5d7984d249b3845aa93c334b96e2))
* **auth:** widen loose rate-limit to /get-session and /set-active ([a6bba53](https://github.com/guillempuche/batuda/commit/a6bba53ed3968cef67cf9110cdae342769001dc4))
* close calendar invitation and webhook audit gaps ([85dcc49](https://github.com/guillempuche/batuda/commit/85dcc49aced65c848c1b7b8010027694fc307300))
* **email:** pin automatic JSX runtime in email components for tsx loader ([bc177ee](https://github.com/guillempuche/batuda/commit/bc177ee172ea3d95e758a5bd5904ae97656e70b1))
* **email:** propagate body text to consumer through compose pipeline ([76b812f](https://github.com/guillempuche/batuda/commit/76b812f0052a2af090a3d0d2f165ccabbdabb38d))
* include organization_id on research_links INSERTs ([68d7e1f](https://github.com/guillempuche/batuda/commit/68d7e1f341597f6b990d0a672f4f9048e1f03d40))
* order @batuda/ui exports so development condition wins ([652a66b](https://github.com/guillempuche/batuda/commit/652a66bf63c95c67af18477d88efc5bb4ff97c44))
* **research:** set organization_id on research_runs INSERTs ([8d719b9](https://github.com/guillempuche/batuda/commit/8d719b9421be9d5b6b507802e0b239d6fddf83cb))
* **research:** skip seed:% rows in orphan-runs sweep ([ddb53d9](https://github.com/guillempuche/batuda/commit/ddb53d9274f0081ffddd6b285fb2f7d92fa3d5dc))
* **server:** allow db reset to install member.primary_inbox_id FK ([1439054](https://github.com/guillempuche/batuda/commit/1439054aaa85504e5275e0e26cba2e72aa1b4780))
* **server:** bundle @batuda/* workspace deps + bump unikernel memory ([ce52124](https://github.com/guillempuche/batuda/commit/ce52124a4c28b52056d5c20c202eff7362644300))
* **server:** drop ADMIN clause from 0002 role-membership GRANT ([e33f898](https://github.com/guillempuche/batuda/commit/e33f898d7bebc2187a9dcdcd8153bd8671471c15)), closes [#14](https://github.com/guillempuche/batuda/issues/14)
* **server:** drop CurrentOrgFallback (clobbers MCP request value) ([fb7a223](https://github.com/guillempuche/batuda/commit/fb7a2233ee3372d33be94c13722f0e3cbf042f5e))
* **server:** drop undefined fields + map NotFound→404 reliably ([ceba304](https://github.com/guillempuche/batuda/commit/ceba3049c82c1691f43f5ca35f43dbe31ca0d73c))
* **server:** escape user-controlled fields in invitation HTML ([43262ec](https://github.com/guillempuche/batuda/commit/43262ec8919e1d6f55b0832de7bbe7c40f4662ae))
* **server:** grant app_user/app_service membership WITH SET TRUE ([35259e0](https://github.com/guillempuche/batuda/commit/35259e0a82ca3282d8032fb8e2845f2c90ddadf6))
* **server:** harden CORS origin matching and require all env vars ([da0c6bf](https://github.com/guillempuche/batuda/commit/da0c6bfe803bd45da3c7d9dc7816710ca9371017))
* **server:** include code+command+response in SMTP error detail ([450520c](https://github.com/guillempuche/batuda/commit/450520cca83102c1173c5bb43c62fd3c95d45e37))
* **server:** list research without created_by default ([1342245](https://github.com/guillempuche/batuda/commit/1342245d9ed6aac4f4a654a183e8e11fa924e9bc))
* **server:** map NotFound→404 on email thread + message routes ([92dfdac](https://github.com/guillempuche/batuda/commit/92dfdacd84071bac518d7689cd69c897a79dfc70))
* **server:** match BA duplicate-user error by code, not message ([06f04d7](https://github.com/guillempuche/batuda/commit/06f04d7abf179f3a820e58a6a83592e1c2015dc4))
* **server:** move workspace deps to devDeps + use lockfile-aware deploy ([43dcc4e](https://github.com/guillempuche/batuda/commit/43dcc4eefe81df71c527a337f3ed5ea1e145a483))
* **server:** omit undefined fields from local-inbox provider responses ([c96b469](https://github.com/guillempuche/batuda/commit/c96b469521b69f5ea52eb0e5d9fcc02b1c191532))
* **server:** project getThread messages to the UI's expected shape (renders From/To/body) ([f758cad](https://github.com/guillempuche/batuda/commit/f758cad3ba258aebb9dc5ddb146176a921b70ab3))
* **server:** provide HttpClient at the layer stack root ([ecf6664](https://github.com/guillempuche/batuda/commit/ecf6664fcd905300c1f6df6e4a1211d9bf02bbb2))
* **ui:** add repository field for npm provenance verification ([16cc522](https://github.com/guillempuche/batuda/commit/16cc52290af0b7cd3877cdab5c25b882661c0dd3))
* **ui:** expand PriSelect API and rebuild popup screw dots ([0c3770d](https://github.com/guillempuche/batuda/commit/0c3770d274d2b67604fc59003f01eca59c6b91df))
* **ui:** hint tab-strip overflow with edge fade ([530ec10](https://github.com/guillempuche/batuda/commit/530ec1080b4807b664c6fd8b21b20849f13dd781))
* **ui:** make PriTabs strip horizontally scrollable ([d5779f0](https://github.com/guillempuche/batuda/commit/d5779f0996c3f515e4666f0b4aefaa88285216c9))
* **ui:** restore macOS swipe-back on scroll area viewport ([5818468](https://github.com/guillempuche/batuda/commit/5818468a01e5487adff00b7e92eb43e141be2a8f))

### Refactoring

* drop throwaway-password workaround in invitation paths ([f68b30b](https://github.com/guillempuche/batuda/commit/f68b30ba258c95f4eb87928b2f6369e6a0e43b37))
* extract packages/controllers from server ([69600df](https://github.com/guillempuche/batuda/commit/69600df2b851201825ed979936de89a8a6c38b4d))
* rename Batuda to Forja ([357e074](https://github.com/guillempuche/batuda/commit/357e0741eb1d015644b599dae2a40194cbc9dfc9))
* **research:** drop any cast in orphan sweep log ([d97a0d2](https://github.com/guillempuche/batuda/commit/d97a0d224ad84b9f90f7cad7b9d9cf3c3eb36e18))
* scope CRM handlers by CurrentOrg ([98a060d](https://github.com/guillempuche/batuda/commit/98a060d1492450a6cc30e022c9417889d4642314))
* **server:** drop non-null assertions in participant matcher ([346edcc](https://github.com/guillempuche/batuda/commit/346edcc26a59bb871efad83ff751637d0b0909e8))
* **server:** drop unsafe cast in runMain, surface CurrentOrg leak as a Defect ([e8a7d80](https://github.com/guillempuche/batuda/commit/e8a7d80ec6589c5ae16f8274dc3a68fd366ecd57))
* **server:** expose matcher and timeline via provideMerge ([8160bd4](https://github.com/guillempuche/batuda/commit/8160bd43c74e5517cc5d35e5fa8e4d2f6f45d27a))
* **server:** squash migrations into a single initial schema ([687ae26](https://github.com/guillempuche/batuda/commit/687ae263dfd7f48b263657954c7f9b98f302e101))
* **server:** use shared auth config and add magic link support ([732c46f](https://github.com/guillempuche/batuda/commit/732c46f973287688b2e23fc87f646ced59d0566a))
* tighten ALLOWED_ORIGINS to exact cross-origin callers ([a3198e8](https://github.com/guillempuche/batuda/commit/a3198e870391c4f34065f603e0fd9f3ccbc42a21))
* tighten comments across emails feature ([cc2ebae](https://github.com/guillempuche/batuda/commit/cc2ebae403702dd1ba95ee254963479025b6b8b6))
* **ui:** make display + headline typescale fluid ([4d96c7e](https://github.com/guillempuche/batuda/commit/4d96c7e02708a5c93d9bc158e66de3b91af95a6c))
* **ui:** revise design tokens and add workshop palette ([50982fc](https://github.com/guillempuche/batuda/commit/50982fc8297830f118c40e09635e0cf138b86b8d))
* **ui:** tighten design tokens and add font-weight ladder ([f35cafb](https://github.com/guillempuche/batuda/commit/f35cafbe1bc895ace6e3de01e0b25166015e26ce))

### Documentation

* remove Micro-SaaS service from catalogue and references ([c21a999](https://github.com/guillempuche/batuda/commit/c21a99950efd1316b5764e6a1e7badc9edebe62b))
* **ui:** clarify PriScrollArea.Content usage and gotchas ([0173be2](https://github.com/guillempuche/batuda/commit/0173be23170fec3d7032e3e64d9b49457a62640a))
* **ui:** consolidate changelog to reflect the published 2026.4.21-2 tag ([d2787a7](https://github.com/guillempuche/batuda/commit/d2787a7828d3e7a40c7154bfd4b500e6da6882ba))

### Tests

* cover mail-worker units and server attachment download ([5aecd4c](https://github.com/guillempuche/batuda/commit/5aecd4c5011075e0c657efa9e1e036417fb8a1da))
* cover Slice A/B/D auto-task and dashboard paths ([c1cba86](https://github.com/guillempuche/batuda/commit/c1cba861d12b657ced6b5f684badd570298d10c7))
* cover webhook org resolution + research_runs RLS + GET /companies/:slug 404 ([62b9ecb](https://github.com/guillempuche/batuda/commit/62b9ecb8880b76562a6c0a7e20412e0ef39329a7))
* **mail-worker:** add IMAP-roundtrip integration test against live mailpit ([b732dc0](https://github.com/guillempuche/batuda/commit/b732dc0ec5f1a57fdf4d7fc6b4f47cfd5e7b613d))
* **research:** add bdd suites for harness, caches, and service ([2cd7a6e](https://github.com/guillempuche/batuda/commit/2cd7a6e5d86315eb36980733777b20fb9b7459e2))
* scaffold BDD cases for invite-admin and session.create ([8647bd0](https://github.com/guillempuche/batuda/commit/8647bd0fafc8c82bd6d05a1df153467833a01e85))
* **server:** assert email_drafts org isolation under RLS ([1e92759](https://github.com/guillempuche/batuda/commit/1e92759293c3c4a72d46bf7034af23dfff9cabed))
* **server:** assert grant hardening + user-id GUC posture ([63873b3](https://github.com/guillempuche/batuda/commit/63873b341573fcb6894045182ac31619adbfa09a))
* **server:** assert multi-org RLS isolation invariants ([15b0ac4](https://github.com/guillempuche/batuda/commit/15b0ac4f5ded59de47cc4aff34cb9262fd893367))
* **server:** assert request-path RLS engagement ([afbc741](https://github.com/guillempuche/batuda/commit/afbc74149341f840f42fd5720f44fdae1b48f1d9))
* **server:** assert RLS isolation on CRM-core tables ([5a861d8](https://github.com/guillempuche/batuda/commit/5a861d8cc8a6cfd1bbac59fc93de8f73015a6703))
* **server:** cover inbox health probe state machine ([06f1dc4](https://github.com/guillempuche/batuda/commit/06f1dc416c89f6c5e66b6644e5225931699051d7))
* **server:** cover sendInvitation transactional contract ([1d5548d](https://github.com/guillempuche/batuda/commit/1d5548d2caf2f7e0d91f7898b279bf1028f54611))
* **server:** full-stack boot test, asserts /health 200 + no missing-service Defects ([e3662f4](https://github.com/guillempuche/batuda/commit/e3662f4f46bfbb0ccf0310d6535ab6f86f85aa96)), closes [#13](https://github.com/guillempuche/batuda/issues/13) [#16](https://github.com/guillempuche/batuda/issues/16)
* **server:** make email-attachment-download self-sufficient ([1a9b985](https://github.com/guillempuche/batuda/commit/1a9b985cd3d100cef3d392fa68ed5bfca6468465))
* **server:** scaffold multi-org email/inbox isolation cases ([1e662d2](https://github.com/guillempuche/batuda/commit/1e662d2909f56726e5cb3c08ca6107a6d37d24cd))

### CI/CD

* **deploy:** bundle prod node_modules into server runtime image ([2d298a5](https://github.com/guillempuche/batuda/commit/2d298a570129b93bf85325f1ab988522a177ecac))
* **deploy:** copy tsconfig.base.json into Docker build context ([81c2414](https://github.com/guillempuche/batuda/commit/81c2414e980f0b1548556273e64322be38d5d503))
* **deploy:** harden Dockerfiles with non-root user and lefthook fix ([2116ac6](https://github.com/guillempuche/batuda/commit/2116ac636b6837774935b54cbf98838e3851e38f))
* **deploy:** harden rolling updates for zero-downtime deploys ([ffb4115](https://github.com/guillempuche/batuda/commit/ffb4115bbd7517f8ff04af08008bc3450924c388))
* **deploy:** update server entry point for .mjs output ([c9f595b](https://github.com/guillempuche/batuda/commit/c9f595b3c1860225262b9ec218fc2e62e4c15fa3))
* drop jsr publishing and rename server dockerfile filters ([5b29816](https://github.com/guillempuche/batuda/commit/5b29816c1e8808a23ebeda33ed26e719da9ceb7f))
* **release:** add per-app CalVer release infrastructure ([51e5b4e](https://github.com/guillempuche/batuda/commit/51e5b4ea5a564c4fe8185b994b8de832bfce855b))
* **release:** ui v2026.4.21 ([226d924](https://github.com/guillempuche/batuda/commit/226d9240551f2d264da3ed5660f4e89a0ad99f5d))
* **release:** ui v2026.4.21-1 ([8c8e6b8](https://github.com/guillempuche/batuda/commit/8c8e6b8231a21e0592e6965db5a53c6a47d0fc7a))
* **release:** ui v2026.4.21-2 ([b5b1ceb](https://github.com/guillempuche/batuda/commit/b5b1ceb107d3f9f77aa6d33691bc3f4318110f69))
* **release:** ui v2026.5.2 ([ecaf156](https://github.com/guillempuche/batuda/commit/ecaf156e1621061290ef032108a8434c59e0ed74))
* **release:** ui v2026.5.2-1 ([7d0ddff](https://github.com/guillempuche/batuda/commit/7d0ddff01043cde6182c6fba32e5f426c70e8d39))

### Chores

* **auth:** clarify cookie-domain derivation comment ([9472ec8](https://github.com/guillempuche/batuda/commit/9472ec8b770246c7401cfba9b1bd925eb5b2f69c))
* bump tsdown to 0.21.7 ([efc3ee3](https://github.com/guillempuche/batuda/commit/efc3ee3672825fe56ddd72fbb6fecb1c9b427f00))
* extract marketing app and publish @engranatge/ui ([56116a0](https://github.com/guillempuche/batuda/commit/56116a0d58e08c9d5a17cf33bd99b6fa9a286b39))
* finish batuda rename in docs seeds tests and i18n ([d59f344](https://github.com/guillempuche/batuda/commit/d59f344fb83b4519bdd78652934afbba624be284))
* integrate portless dev proxy with turbo dev task ([b82602e](https://github.com/guillempuche/batuda/commit/b82602effde85659d6602e3197290741e24d7ab9))
* prune dead it.todo scaffolds across the test suite ([85bb00f](https://github.com/guillempuche/batuda/commit/85bb00f6aba8b3ba4e234602baf2f744b0871715))
* rename tool to batuda and isolate engranatge as tenant ([f090b60](https://github.com/guillempuche/batuda/commit/f090b6085e25ef2becb4d188ca9a6199bc6474ae))
* route @batuda/ui imports through dist by default ([30311b4](https://github.com/guillempuche/batuda/commit/30311b43ea1c75d39a0b928c426eaad729735b64))
* **server:** biome reflow on grant hardening tests ([7e76cf1](https://github.com/guillempuche/batuda/commit/7e76cf1e35bcbba9dc669bde94e031e69a371261))
* **server:** wrap long line in multi-org-isolation test ([4690561](https://github.com/guillempuche/batuda/commit/46905613b37a9f4410220f22a36ff8095dc0583b))
* switch dev scripts to portless run for worktree-aware routing ([3647eed](https://github.com/guillempuche/batuda/commit/3647eed7478d4d6a20bfae345a6f85d0fe44bf05))
* upgrade pnpm to v11.1.1 with v11 defaults ([5f5d076](https://github.com/guillempuche/batuda/commit/5f5d076242db75cfde38d798c79b426d402fb226))

# Changelog

All notable changes to this project will be documented in this file.

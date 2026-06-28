# Changelog

All notable changes to this project will be documented in this file.


## 2026-06-28 (mail-worker-v2026.6.28)

### Features

* add instruction-template management API over HTTP and MCP ([08f1a50](https://github.com/guillempuche/batuda/commit/08f1a5059d8e93dbcaf4d3732ff381d3bd1348cc))
* **instructions:** set and read stack composition via the API and MCP ([df1ae5e](https://github.com/guillempuche/batuda/commit/df1ae5e43e7bcfd43350e53d9a81dda43940c5e6))
* load non-secret config from a baked file at boot ([c7939c6](https://github.com/guillempuche/batuda/commit/c7939c6ba958cf76b3df3d039c3905dea6ffedf0))
* org-isolate the research cache and thread instruction templates ([fa6c6ef](https://github.com/guillempuche/batuda/commit/fa6c6eff56db43aac6da49ad57967e75212e3d92))
* **server:** support multiple orgs per MCP OAuth connection ([bf0c957](https://github.com/guillempuche/batuda/commit/bf0c957d1e46a29e00d08ea805ea0ac9f56767ac))
* **ui:** add fluid prose typescale for long-form reading ([4b089fe](https://github.com/guillempuche/batuda/commit/4b089fe186e3700d1f0b8f73c89f5da05312b3b7))
* **ui:** adopt Utopia geometric ladder for fluid space tokens ([bdbfaa5](https://github.com/guillempuche/batuda/commit/bdbfaa5f76ef639896b47135e48f66109ab680b3))

### Bug Fixes

* harden research MCP input validation and lifecycle guards ([03a952d](https://github.com/guillempuche/batuda/commit/03a952d20c60f61a3aae44ba50d93fd1a0541d65))
* **mail-worker:** sync from IMAP change events instead of a blocking idle() ([75121e3](https://github.com/guillempuche/batuda/commit/75121e34d788b72dd5512c822e05e4530627f165))
* meet WCAG AA contrast and add ARIA to the mailbox connect form ([1326007](https://github.com/guillempuche/batuda/commit/1326007c3d3178d882dde6c4dd6d29d8b2896771)), closes [#b05220](https://github.com/guillempuche/batuda/issues/b05220) [#95400f](https://github.com/guillempuche/batuda/issues/95400f)
* **ui:** add exports to publishConfig for npm distribution ([3c5cedb](https://github.com/guillempuche/batuda/commit/3c5cedb2b3d1564b549acaac8b17b6f9d51d6e37))
* **ui:** match select popup width to its trigger ([839ae9b](https://github.com/guillempuche/batuda/commit/839ae9b803cdb896ce5d2ad896e75dbabd0d66d5))

### Refactoring

* remove starter instruction presets and source_preset_id column ([389bdaf](https://github.com/guillempuche/batuda/commit/389bdaf7591c03b78fc0d3b4403bdec36d2d3f19))

### Documentation

* **ui:** remove broken issue links from the v2026.6.14 changelog ([bfb0584](https://github.com/guillempuche/batuda/commit/bfb0584f06ffbf6f3e61cb15e8f6d4bd7ac7d16e))

### CI/CD

* **deploy:** keep lefthook disabled across prepare-script changes ([55433e7](https://github.com/guillempuche/batuda/commit/55433e7d207ba3d4f764b8499eef9c800bb9cc14))
* **release:** ui v2026.6.14 ([ac6b83d](https://github.com/guillempuche/batuda/commit/ac6b83dd4f18e4b177adfef69a05f79d92bf5262))
* **release:** ui v2026.6.14-1 ([7918100](https://github.com/guillempuche/batuda/commit/7918100c016129cf171d61d0e1587c39c2947f7b))
* **release:** ui v2026.6.18 ([f8992d8](https://github.com/guillempuche/batuda/commit/f8992d843f1c08e94e503b8900c221039e13a63a))

## 2026-05-31 (mail-worker-v2026.5.31)

### Features

* add process crash guards to server and mail-worker ([115fa85](https://github.com/guillempuche/batuda/commit/115fa85ed22d87e1410813c7bf588e8012ac59ad))

### Bug Fixes

* **mail-worker:** handle imap client errors instead of crashing ([fda27f8](https://github.com/guillempuche/batuda/commit/fda27f80b8dd6f6b06b5c515b15d39e9f90c34cf))

## 2026-05-29 (mail-worker-v2026.5.29-2)

### Bug Fixes

* **mail-worker:** provide SqlClient to ParticipantMatcher ([03457fd](https://github.com/guillempuche/batuda/commit/03457fdc070f44fdb61bca16596f4cfb6fbc9d48))

## 2026-05-29 (mail-worker-v2026.5.29-1)

### Bug Fixes

* **mail-worker:** bundle [@batuda](https://github.com/batuda) workspace deps so the worker boots ([dbbb79e](https://github.com/guillempuche/batuda/commit/dbbb79ed884ee78c102da879297c83fc70ae337a))

## 2026-05-29 (mail-worker-v2026.5.29)

### Features

* add org-owned API keys for AI/MCP sessions ([97bfc1b](https://github.com/guillempuche/batuda/commit/97bfc1bd6020ba35d28f1f5ce198991ce07bc544))
* attribute MCP API keys to their creating member ([1476a6d](https://github.com/guillempuche/batuda/commit/1476a6d7eb6dca9b2a241cf8d3dbad27a0268fe2))
* authenticate MCP sessions via OAuth 2.1 ([06ff241](https://github.com/guillempuche/batuda/commit/06ff2419052254b1c9c5be6491d2789180a84351))
* clean up abandoned OAuth clients and show connection provenance ([9c7e9fe](https://github.com/guillempuche/batuda/commit/9c7e9fe4e21fd87149c9f9ee50e9978de642c7b8))

### CI/CD

* **deploy:** run server and mail-worker on base-compat runtime ([7ea3691](https://github.com/guillempuche/batuda/commit/7ea3691cfc63046714c2523551f6f6bc5a1a7466))

## 2026-05-19 (mail-worker-v2026.5.20)

### Features

* add company where panel with nominatim geocoder ([5f9fca2](https://github.com/guillempuche/batuda/commit/5f9fca251e940ebbaa85918ae0b9b6b8c056483b))
* add data-testid hooks across Forja for agent-browser ([5cf0c12](https://github.com/guillempuche/batuda/commit/5cf0c12f1a192185a381398507d724867a8617e0))
* add provider-agnostic email attachments ([c1c3614](https://github.com/guillempuche/batuda/commit/c1c3614dd91e3c7fe9411f7ca9c97700105b444d))
* **calendar:** add bounded context with booking port and stub adapter ([d7e2a94](https://github.com/guillempuche/batuda/commit/d7e2a94a644631b9a11e347804942fb4196fb83c))
* **calendar:** extract Zoom Teams and Meet URLs from invites ([bebc55f](https://github.com/guillempuche/batuda/commit/bebc55f291afe777e615a61d24789c9bbf9b5294))
* **calendar:** implement cal.com v2 booking provider adapter ([a44cfa8](https://github.com/guillempuche/batuda/commit/a44cfa89d38e28e8d85e49ab59d0962f25c9c7c4))
* **cli:** switch seed to direct INSERT (Mailpit doesn't speak IMAP) ([f60cf67](https://github.com/guillempuche/batuda/commit/f60cf6756adfca9c919720fb11707d3a1d8d9f7f))
* **controllers:** accept block bodies and inline attachment refs ([2b2a54a](https://github.com/guillempuche/batuda/commit/2b2a54a11814aecbe090b882d617871cbf73619a))
* **controllers:** add cal.com webhook route group ([ece54c5](https://github.com/guillempuche/batuda/commit/ece54c500dcf08e6a810470ea7d91601ec9cc123))
* **controllers:** add tasks and calendar route groups ([1c68996](https://github.com/guillempuche/batuda/commit/1c68996cf09e3f902795a9e9dc267ed52a9e7429))
* **controllers:** rebuild email API surface for per-org BYO mailboxes ([83e28b5](https://github.com/guillempuche/batuda/commit/83e28b5ddfe1913bd348302ec99203eb7736a9c1))
* **domain:** add schemas for CRM entities and pages ([8c8d938](https://github.com/guillempuche/batuda/commit/8c8d938f03b768464ecb27bdf83d6be808b7d70d))
* **domain:** add task and calendar timeline schemas ([670afbf](https://github.com/guillempuche/batuda/commit/670afbf8474bf958131ffe3a6c9e6e6452924ffe))
* **domain:** add timeline activity, message participants, interaction denorms ([8eda7c5](https://github.com/guillempuche/batuda/commit/8eda7c5785b97151bbcfc472c8d954fbdf0e0bc5))
* **email:** add block-based email package ([bd12619](https://github.com/guillempuche/batuda/commit/bd1261907a2a05f0184eee584df6d82873e95cc2))
* extract PriSelect into shared @engranatge/ui/pri ([145fbdc](https://github.com/guillempuche/batuda/commit/145fbdc16fe9d4cd109c84dc257badabb9c9f3e3))
* integrate agentmail with outbound deliverability tracking ([4bee2a6](https://github.com/guillempuche/batuda/commit/4bee2a65b70df2ffccaaa0e2509a5d85e21c80e7))
* **mail-worker:** add IMAP IDLE daemon with DSN bounce parser ([55b43a9](https://github.com/guillempuche/batuda/commit/55b43a944d8f7d54e1940a7adacd1491e77dd754))
* **mail-worker:** auto-link inbound emails to company/contact ([916f428](https://github.com/guillempuche/batuda/commit/916f428f9c722602a18cc0b789d9ab15787462e6))
* make email schema and services provider-agnostic ([0738e8f](https://github.com/guillempuche/batuda/commit/0738e8f643a15584fa31d93a9d92a048e24f6f7e))
* persist inbound attachments and soft-delete on email_messages ([934a820](https://github.com/guillempuche/batuda/commit/934a8201a475b3159a6209f2324964841737cae4))
* promote place to first-class company state ([4323796](https://github.com/guillempuche/batuda/commit/4323796fb9bb61144446f6862fea9f8a723548cb))
* **server:** add clear-suppression endpoint for contacts ([857a5c0](https://github.com/guillempuche/batuda/commit/857a5c0604a1f357b56d1e9aa620093e3571c1f2))
* **server:** add recordings, local-inbox email provider, and S3 storage ([cdf40bf](https://github.com/guillempuche/batuda/commit/cdf40bf120355129d772b892f6845ef545ebf10e))
* **server:** add server-backed drafts, inbox footers, and fix inbox resolution bugs ([0d931e2](https://github.com/guillempuche/batuda/commit/0d931e2b87c5c6358b9b1d471c91214e931f047e))
* **server:** aggregate research_paid_spend by provider, user, or tool ([a4ec9c1](https://github.com/guillempuche/batuda/commit/a4ec9c14d193659060bc0b8189db2d6dbacb5db9))
* **server:** envelope listThreads, thread mutations, cc/bcc, full MCP parity ([161ffa0](https://github.com/guillempuche/batuda/commit/161ffa0a6e729386a909850b5d3f2ff41064641d))
* **server:** local inbox CRUD with provider sync, clientId tagging, MCP parity ([e4606a8](https://github.com/guillempuche/batuda/commit/e4606a8f8918cd3b820e37e3d2435288d4f2b88a))
* **server:** type page content, add get endpoint and granular MCP block tools ([bba951c](https://github.com/guillempuche/batuda/commit/bba951c0718094c1031d66744aa94ad1f3aa62b9))
* **server:** wire per-request GUC + role for RLS ([8273a96](https://github.com/guillempuche/batuda/commit/8273a96d2cb272f4da85a6bdd83a8b777bcab7e4))
* **server:** wire research endpoints, MCP tools, and provider config ([8188d70](https://github.com/guillempuche/batuda/commit/8188d705fa42e66dc71798c95c75d778da9bed20))
* **timeline:** expose timeline resource, tool, and Forja activity view ([0ef2f07](https://github.com/guillempuche/batuda/commit/0ef2f07f90934e039ff620897bcf19ca74f140e2))
* **ui:** add design tokens and Tiptap block extensions ([28afb1f](https://github.com/guillempuche/batuda/commit/28afb1f792af93d7a833ca1a5e020f6920683542))
* **ui:** add Every Layout primitives ([255615b](https://github.com/guillempuche/batuda/commit/255615b82de3a6be48daa41aec3eef4d0c277864))
* **ui:** add Pri primitives and organize token sections ([02e25e4](https://github.com/guillempuche/batuda/commit/02e25e4e2ad1f9aba2bc67865dd6ab2c0eaf0e19))
* **ui:** add PriTextarea primitive ([12e909c](https://github.com/guillempuche/batuda/commit/12e909cc3bafbb62488079fec4bc282e4b71d7fa))
* **ui:** add typed block schemas and expand catalog to 13 blocks ([b6d25d1](https://github.com/guillempuche/batuda/commit/b6d25d1e45259fae8526f64a31539b30ace93370))
* **ui:** restyle Pri wrappers with workshop visual language ([e07f52a](https://github.com/guillempuche/batuda/commit/e07f52af77425c232ead592aa6be5ce2bae3cc3b))

### Bug Fixes

* close calendar invitation and webhook audit gaps ([85dcc49](https://github.com/guillempuche/batuda/commit/85dcc49aced65c848c1b7b8010027694fc307300))
* **email:** pin automatic JSX runtime in email components for tsx loader ([bc177ee](https://github.com/guillempuche/batuda/commit/bc177ee172ea3d95e758a5bd5904ae97656e70b1))
* **email:** propagate body text to consumer through compose pipeline ([76b812f](https://github.com/guillempuche/batuda/commit/76b812f0052a2af090a3d0d2f165ccabbdabb38d))
* **mail-worker:** correct DSN parsing against mailparser shape ([dda4f55](https://github.com/guillempuche/batuda/commit/dda4f55487cec18b7514971f5d65fc8e06c56fbb))
* order @batuda/ui exports so development condition wins ([652a66b](https://github.com/guillempuche/batuda/commit/652a66bf63c95c67af18477d88efc5bb4ff97c44))
* **server:** map NotFound→404 on email thread + message routes ([92dfdac](https://github.com/guillempuche/batuda/commit/92dfdacd84071bac518d7689cd69c897a79dfc70))
* **ui:** add repository field for npm provenance verification ([16cc522](https://github.com/guillempuche/batuda/commit/16cc52290af0b7cd3877cdab5c25b882661c0dd3))
* **ui:** expand PriSelect API and rebuild popup screw dots ([0c3770d](https://github.com/guillempuche/batuda/commit/0c3770d274d2b67604fc59003f01eca59c6b91df))
* **ui:** hint tab-strip overflow with edge fade ([530ec10](https://github.com/guillempuche/batuda/commit/530ec1080b4807b664c6fd8b21b20849f13dd781))
* **ui:** make PriTabs strip horizontally scrollable ([d5779f0](https://github.com/guillempuche/batuda/commit/d5779f0996c3f515e4666f0b4aefaa88285216c9))
* **ui:** restore macOS swipe-back on scroll area viewport ([5818468](https://github.com/guillempuche/batuda/commit/5818468a01e5487adff00b7e92eb43e141be2a8f))

### Refactoring

* **domain:** move CurrentOrg from @batuda/controllers ([73f3c35](https://github.com/guillempuche/batuda/commit/73f3c352ebfe488226c23b0f13b09cf69c7e42f6))
* extract packages/controllers from server ([69600df](https://github.com/guillempuche/batuda/commit/69600df2b851201825ed979936de89a8a6c38b4d))
* move ParticipantMatcher to @batuda/email ([0ef885c](https://github.com/guillempuche/batuda/commit/0ef885c0129b6151e7ea366e4d9c9c14ff3a2768))
* scope CRM handlers by CurrentOrg ([98a060d](https://github.com/guillempuche/batuda/commit/98a060d1492450a6cc30e022c9417889d4642314))
* **ui:** make display + headline typescale fluid ([4d96c7e](https://github.com/guillempuche/batuda/commit/4d96c7e02708a5c93d9bc158e66de3b91af95a6c))
* **ui:** revise design tokens and add workshop palette ([50982fc](https://github.com/guillempuche/batuda/commit/50982fc8297830f118c40e09635e0cf138b86b8d))
* **ui:** tighten design tokens and add font-weight ladder ([f35cafb](https://github.com/guillempuche/batuda/commit/f35cafbe1bc895ace6e3de01e0b25166015e26ce))

### Documentation

* remove Micro-SaaS service from catalogue and references ([c21a999](https://github.com/guillempuche/batuda/commit/c21a99950efd1316b5764e6a1e7badc9edebe62b))
* **ui:** clarify PriScrollArea.Content usage and gotchas ([0173be2](https://github.com/guillempuche/batuda/commit/0173be23170fec3d7032e3e64d9b49457a62640a))
* **ui:** consolidate changelog to reflect the published 2026.4.21-2 tag ([d2787a7](https://github.com/guillempuche/batuda/commit/d2787a7828d3e7a40c7154bfd4b500e6da6882ba))

### Tests

* cover mail-worker units and server attachment download ([5aecd4c](https://github.com/guillempuche/batuda/commit/5aecd4c5011075e0c657efa9e1e036417fb8a1da))
* **mail-worker:** add IMAP-roundtrip integration test against live mailpit ([b732dc0](https://github.com/guillempuche/batuda/commit/b732dc0ec5f1a57fdf4d7fc6b4f47cfd5e7b613d))
* split unit and integration suites across all workspaces ([3c5d7be](https://github.com/guillempuche/batuda/commit/3c5d7be3ee14cc99fad7d67ba7eca1e5aca414b0))

### CI/CD

* **deploy:** add mail-worker as a KraftCloud background instance ([094884c](https://github.com/guillempuche/batuda/commit/094884ccd6f7719d81645bc551a11933c7136b0c))
* drop jsr publishing and rename server dockerfile filters ([5b29816](https://github.com/guillempuche/batuda/commit/5b29816c1e8808a23ebeda33ed26e719da9ceb7f))
* **release:** add mail-worker target to release-it + dispatcher ([e74724c](https://github.com/guillempuche/batuda/commit/e74724c36d9427dc9e3b003b82a7cc515735a197))
* **release:** ui v2026.4.21 ([226d924](https://github.com/guillempuche/batuda/commit/226d9240551f2d264da3ed5660f4e89a0ad99f5d))
* **release:** ui v2026.4.21-1 ([8c8e6b8](https://github.com/guillempuche/batuda/commit/8c8e6b8231a21e0592e6965db5a53c6a47d0fc7a))
* **release:** ui v2026.4.21-2 ([b5b1ceb](https://github.com/guillempuche/batuda/commit/b5b1ceb107d3f9f77aa6d33691bc3f4318110f69))
* **release:** ui v2026.5.17 ([9abce7a](https://github.com/guillempuche/batuda/commit/9abce7a9b09919066852f9506366b587ab79885c))
* **release:** ui v2026.5.2 ([ecaf156](https://github.com/guillempuche/batuda/commit/ecaf156e1621061290ef032108a8434c59e0ed74))
* **release:** ui v2026.5.2-1 ([7d0ddff](https://github.com/guillempuche/batuda/commit/7d0ddff01043cde6182c6fba32e5f426c70e8d39))

### Chores

* bump tsdown to 0.21.7 ([efc3ee3](https://github.com/guillempuche/batuda/commit/efc3ee3672825fe56ddd72fbb6fecb1c9b427f00))
* extract marketing app and publish @engranatge/ui ([56116a0](https://github.com/guillempuche/batuda/commit/56116a0d58e08c9d5a17cf33bd99b6fa9a286b39))
* finish batuda rename in docs seeds tests and i18n ([d59f344](https://github.com/guillempuche/batuda/commit/d59f344fb83b4519bdd78652934afbba624be284))
* rename tool to batuda and isolate engranatge as tenant ([f090b60](https://github.com/guillempuche/batuda/commit/f090b6085e25ef2becb4d188ca9a6199bc6474ae))
* route @batuda/ui imports through dist by default ([30311b4](https://github.com/guillempuche/batuda/commit/30311b43ea1c75d39a0b928c426eaad729735b64))

# Changelog

All notable changes to this project will be documented in this file.

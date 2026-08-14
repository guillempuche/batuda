# Changelog

All notable changes to this project will be documented in this file.


## 2026-08-14 (ui-v2026.8.14)

### Bug Fixes

* make a research scan's list one usable row per company ([35f2865](https://github.com/guillempuche/batuda/commit/35f2865661976157c648dcac2395cbf197f423db)), closes [#459](https://github.com/guillempuche/batuda/issues/459)

## 2026-08-07 (ui-v2026.8.7)

### Features

* make the companies pages fit a phone and lead with the notes ([fd8f64c](https://github.com/guillempuche/batuda/commit/fd8f64c9c25405620b3a31ece165e12e3e75ee72))

## 2026-08-03 (ui-v2026.8.3)

### Bug Fixes

* keep the template dialog usable by keyboard and screen reader ([7356841](https://github.com/guillempuche/batuda/commit/735684190611848eb1de14828ed8f6ef0b1d3e31))
* **ui:** turn only the leading arrow when a section opens ([575ada2](https://github.com/guillempuche/batuda/commit/575ada2a86b84a89d9f4aaad58ca64dbc28db585))

### Chores

* raise Effect to beta.102 and fix what the raise uncovered ([72da41c](https://github.com/guillempuche/batuda/commit/72da41cf0d4e69a002cf740a1f8f96cbbe5a80c9))

## 2026-07-28 (ui-v2026.7.28)

### Bug Fixes

* let the browser find text inside a folded section ([c521122](https://github.com/guillempuche/batuda/commit/c5211227487b6f6e442ffd195e2f2a6a368a5872))

## 2026-07-27 (ui-v2026.7.27)

### Bug Fixes

* **ui:** make the keyboard focus mark visible, and name what it lands on ([6091b54](https://github.com/guillempuche/batuda/commit/6091b540d2dbc726b11cbaa00146f7489445dd5b))

## 2026-07-25 (ui-v2026.7.25)

### Features

* **ui:** add mobile dialog sheets and a destructive button ([80cf0c0](https://github.com/guillempuche/batuda/commit/80cf0c081c8f50ea89aae9d534924b96d7eb92ad))

### Bug Fixes

* **ui:** respect prefers-reduced-motion in dialog transitions ([5da8b54](https://github.com/guillempuche/batuda/commit/5da8b54a1ba8758f817c495863295c073e0210cd))

### Chores

* pin the [@tiptap](https://github.com/tiptap) packages to 3.28 for markdown support ([f7bfbd1](https://github.com/guillempuche/batuda/commit/f7bfbd1ce8350190f29baab361e022c066735640))

## 2026-07-22 (ui-v2026.7.22)

### Features

* bump Effect to 4.0.0-beta.98 and give API responses typed schemas ([9365867](https://github.com/guillempuche/batuda/commit/936586718e5de8410e6e33b053b455b517a1ae68))
* **ui:** add the dark and high-contrast themes ([d874fae](https://github.com/guillempuche/batuda/commit/d874fae410181a53301b3fc33078c1c09c55e09a))

### Bug Fixes

* **internal:** make the dark themes correct on the surfaces that ignore them ([aa631eb](https://github.com/guillempuche/batuda/commit/aa631eb4d68e89639bb6452736ebb4dace68cbe0))
* **ui:** serve the design tokens from a single copy ([92e1f5b](https://github.com/guillempuche/batuda/commit/92e1f5b54675bd85ef6bd9e3033a2205cef64b84))

### Refactoring

* **ui:** complete and restructure the design token system ([6cc0243](https://github.com/guillempuche/batuda/commit/6cc0243486d5310cb56c574b4dc7bbe355c4519c))
* **ui:** draw library primitives from tokens instead of fixed colours ([aef36ab](https://github.com/guillempuche/batuda/commit/aef36ab9d6d965c1fb10c1f012310f2b62d9ce02))

### Tests

* **ui:** check theme contrast against the token file before pushing ([103aef4](https://github.com/guillempuche/batuda/commit/103aef4a928dc4d4100ea532e3363b401ce09856))

### CI/CD

* run the theme contrast check where it cannot be skipped ([9198703](https://github.com/guillempuche/batuda/commit/91987035a3f60998586bf8f8b91b1589d272f8f2))

### Chores

* bump Base UI to 1.6.0 ([080a353](https://github.com/guillempuche/batuda/commit/080a353031b9375b61617aec9bcffd413fd4faff))
* bump react/react-dom to 19.2.7 and @types/react to 19.2.17 ([08283e2](https://github.com/guillempuche/batuda/commit/08283e2e4b604b6d0617b0c85b952d640ea2422b))

## 2026-07-13 (ui-v2026.7.13)

### Features

* **ui:** add PriMenu action-menu primitive ([8bf09a8](https://github.com/guillempuche/batuda/commit/8bf09a8dc819c5c2b1303c86f4212bad5a7cec5f))

## 2026-07-12 (ui-v2026.7.12)

### Features

* add pipeline board and book-of-business views ([#225](https://github.com/guillempuche/batuda/issues/225)) ([efa50ad](https://github.com/guillempuche/batuda/commit/efa50ad2a61641fd4336cdae750b38a43fc01529))

## 2026-06-18 (ui-v2026.6.18)

### Features

* **ui:** add fluid prose typescale for long-form reading ([4b089fe](https://github.com/guillempuche/batuda/commit/4b089fe186e3700d1f0b8f73c89f5da05312b3b7))

### Documentation

* **ui:** remove broken issue links from the v2026.6.14 changelog ([bfb0584](https://github.com/guillempuche/batuda/commit/bfb0584f06ffbf6f3e61cb15e8f6d4bd7ac7d16e))

## 2026-06-14 (ui-v2026.6.14-1)

### Bug Fixes

* **ui:** add exports to publishConfig for npm distribution ([3c5cedb](https://github.com/guillempuche/batuda/commit/3c5cedb2b3d1564b549acaac8b17b6f9d51d6e37))

## 2026-06-14 (ui-v2026.6.14)

### Features

* **ui:** adopt Utopia geometric ladder for fluid space tokens ([bdbfaa5](https://github.com/guillempuche/batuda/commit/bdbfaa5f76ef639896b47135e48f66109ab680b3))

### Bug Fixes

* meet WCAG AA contrast and add ARIA to the mailbox connect form ([1326007](https://github.com/guillempuche/batuda/commit/1326007c3d3178d882dde6c4dd6d29d8b2896771))
* **ui:** match select popup width to its trigger ([839ae9b](https://github.com/guillempuche/batuda/commit/839ae9b803cdb896ce5d2ad896e75dbabd0d66d5))

## 2026-05-17 (ui-v2026.5.17)

### Features

* **ui:** add Every Layout primitives ([255615b](https://github.com/guillempuche/batuda/commit/255615b82de3a6be48daa41aec3eef4d0c277864))
* **ui:** add PriTextarea primitive ([12e909c](https://github.com/guillempuche/batuda/commit/12e909cc3bafbb62488079fec4bc282e4b71d7fa))

### Bug Fixes

* **ui:** expand PriSelect API and rebuild popup screw dots ([0c3770d](https://github.com/guillempuche/batuda/commit/0c3770d274d2b67604fc59003f01eca59c6b91df))
* **ui:** hint tab-strip overflow with edge fade ([530ec10](https://github.com/guillempuche/batuda/commit/530ec1080b4807b664c6fd8b21b20849f13dd781))
* **ui:** make PriTabs strip horizontally scrollable ([d5779f0](https://github.com/guillempuche/batuda/commit/d5779f0996c3f515e4666f0b4aefaa88285216c9))

### Refactoring

* **ui:** make display + headline typescale fluid ([4d96c7e](https://github.com/guillempuche/batuda/commit/4d96c7e02708a5c93d9bc158e66de3b91af95a6c))

## 2026-05-02 (ui-v2026.5.2-1)

### Bug Fixes

* **ui:** add repository field for npm provenance verification ([16cc522](https://github.com/guillempuche/batuda/commit/16cc52290af0b7cd3877cdab5c25b882661c0dd3))

## 2026-05-02 (ui-v2026.5.2)

### Bug Fixes

* order @batuda/ui exports so development condition wins ([652a66b](https://github.com/guillempuche/batuda/commit/652a66bf63c95c67af18477d88efc5bb4ff97c44))

### Documentation

* **ui:** clarify PriScrollArea.Content usage and gotchas ([0173be2](https://github.com/guillempuche/batuda/commit/0173be23170fec3d7032e3e64d9b49457a62640a))
* **ui:** consolidate changelog to reflect the published 2026.4.21-2 tag ([d2787a7](https://github.com/guillempuche/batuda/commit/d2787a7828d3e7a40c7154bfd4b500e6da6882ba))

### Chores

* route @batuda/ui imports through dist by default ([30311b4](https://github.com/guillempuche/batuda/commit/30311b43ea1c75d39a0b928c426eaad729735b64))

## 2026-04-21 (ui-v2026.4.21-2)

### Features

* add data-testid hooks across Forja for agent-browser ([5cf0c12](https://github.com/guillempuche/batuda/commit/5cf0c12f1a192185a381398507d724867a8617e0))
* extract PriSelect into shared @engranatge/ui/pri ([145fbdc](https://github.com/guillempuche/batuda/commit/145fbdc16fe9d4cd109c84dc257badabb9c9f3e3))
* **ui:** add design tokens and Tiptap block extensions ([28afb1f](https://github.com/guillempuche/batuda/commit/28afb1f792af93d7a833ca1a5e020f6920683542))
* **ui:** add Pri primitives and organize token sections ([02e25e4](https://github.com/guillempuche/batuda/commit/02e25e4e2ad1f9aba2bc67865dd6ab2c0eaf0e19))
* **ui:** add typed block schemas and expand catalog to 13 blocks ([b6d25d1](https://github.com/guillempuche/batuda/commit/b6d25d1e45259fae8526f64a31539b30ace93370))
* **ui:** restyle Pri wrappers with workshop visual language ([e07f52a](https://github.com/guillempuche/batuda/commit/e07f52af77425c232ead592aa6be5ce2bae3cc3b))

### Bug Fixes

* **ui:** restore macOS swipe-back on scroll area viewport ([5818468](https://github.com/guillempuche/batuda/commit/5818468a01e5487adff00b7e92eb43e141be2a8f))

### Refactoring

* **ui:** revise design tokens and add workshop palette ([50982fc](https://github.com/guillempuche/batuda/commit/50982fc8297830f118c40e09635e0cf138b86b8d))
* **ui:** tighten design tokens and add font-weight ladder ([f35cafb](https://github.com/guillempuche/batuda/commit/f35cafbe1bc895ace6e3de01e0b25166015e26ce))

### CI/CD

* drop jsr publishing and rename server dockerfile filters ([5b29816](https://github.com/guillempuche/batuda/commit/5b29816c1e8808a23ebeda33ed26e719da9ceb7f))
* publish @batuda/ui via npm trusted publishing (oidc) ([f57e7fe](https://github.com/guillempuche/batuda/commit/f57e7fef32ab28290df40f1afa0fa0ec52f83128))

### Chores

* bump tsdown to 0.21.7 ([efc3ee3](https://github.com/guillempuche/batuda/commit/efc3ee3672825fe56ddd72fbb6fecb1c9b427f00))
* extract marketing app and publish @engranatge/ui ([56116a0](https://github.com/guillempuche/batuda/commit/56116a0d58e08c9d5a17cf33bd99b6fa9a286b39))
* finish batuda rename in docs seeds tests and i18n ([d59f344](https://github.com/guillempuche/batuda/commit/d59f344fb83b4519bdd78652934afbba624be284))
* rename tool to batuda and isolate engranatge as tenant ([f090b60](https://github.com/guillempuche/batuda/commit/f090b6085e25ef2becb4d188ca9a6199bc6474ae))

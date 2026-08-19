# Changelog

All notable changes to this project will be documented in this file.


## 2026-08-19 (server-v2026.8.19)

### Bug Fixes

* **server:** stop recording a missing route as a crash ([d2ab946](https://github.com/guillempuche/batuda/commit/d2ab946d0d0de0abffb4b813db16d800dc45d35c))

## 2026-08-18 (server-v2026.8.18)

### Bug Fixes

* **research:** read an "and" between two trades by where it sits ([3ad852a](https://github.com/guillempuche/batuda/commit/3ad852a357116bd56b3bbb16effb60caff0e6f81)), closes [#490](https://github.com/guillempuche/batuda/issues/490)
* **research:** stop a search dropping a company for sharing an address ([79b10fc](https://github.com/guillempuche/batuda/commit/79b10fc5eb136763035ccf4da513df05b24af41c)), closes [#483](https://github.com/guillempuche/batuda/issues/483)
* stop telemetry double-counting, hiding refusals, and going missing ([b91eabb](https://github.com/guillempuche/batuda/commit/b91eabbbb86edf645c54c5f2fdc60fa42ad6c59c))

## 2026-08-17 (server-v2026.8.17)

### Features

* grade a whole-market search on what its list gets wrong ([79fdda4](https://github.com/guillempuche/batuda/commit/79fdda4333118acfd7a129af701f14c601ba479b)), closes [#466](https://github.com/guillempuche/batuda/issues/466)
* make the eval refuse to report numbers it did not earn ([aef6eb1](https://github.com/guillempuche/batuda/commit/aef6eb146951e0d78522bd956a28efc0c92de1b1))
* record each request on one line and let traces be thinned ([8403e75](https://github.com/guillempuche/batuda/commit/8403e7529afdfd2fae34843e59fc1a9407a91640))
* **research:** answer every trade asked for, or say which was missed ([a4ebff4](https://github.com/guillempuche/batuda/commit/a4ebff474a8bd0bbc74919159a72f96ef59f6b44))
* **research:** confirm a company only when two websites name it ([a9be7f8](https://github.com/guillempuche/batuda/commit/a9be7f8586cd0c3cfd0e03fd31f0141ee898cda7)), closes [#486](https://github.com/guillempuche/batuda/issues/486)
* **research:** give every log line a name and every run a row ([ba8ae27](https://github.com/guillempuche/batuda/commit/ba8ae27fc2b8d2b0a85e41d3b6cc311240e4fe4c))
* say when a company was only ever a name in a list ([1b12c17](https://github.com/guillempuche/batuda/commit/1b12c17292b054b137d1fc01e3dbbeef9a68c857)), closes [#493](https://github.com/guillempuche/batuda/issues/493)

### Bug Fixes

* **research:** fold a company's branch offices onto the company itself ([eba0211](https://github.com/guillempuche/batuda/commit/eba021175dad7b119ea855151b592c077f38c7d4)), closes [#470](https://github.com/guillempuche/batuda/issues/470)
* **research:** keep every letter of a name, whatever language wrote it ([d14668d](https://github.com/guillempuche/batuda/commit/d14668d13c557c7a5a679a8e19ad687652ebb6f9)), closes [#488](https://github.com/guillempuche/batuda/issues/488)
* **research:** read a listing page's links as the page writes them ([0e9f412](https://github.com/guillempuche/batuda/commit/0e9f4120ea327242579ea72e6fd16d1d3191fb77))
* **research:** recognise a name however an address spells it out ([36d31dd](https://github.com/guillempuche/batuda/commit/36d31dddd8f228589dd5ac2cb51b642619f7b304)), closes [#478](https://github.com/guillempuche/batuda/issues/478)
* **research:** say when a website is established as the company's own ([4fec3a4](https://github.com/guillempuche/batuda/commit/4fec3a41984c7b655aa85b2974f1758e8e63f538)), closes [#476](https://github.com/guillempuche/batuda/issues/476)
* **research:** stop a website being the page its claim was read from ([91b85b4](https://github.com/guillempuche/batuda/commit/91b85b4d49496b6d95014090e1b3f232058eafce))
* **research:** tell a business directory by what a run watches it do ([c894ca2](https://github.com/guillempuche/batuda/commit/c894ca2cbe7b4520f2c27f6a9f9ec945f40c2222)), closes [#467](https://github.com/guillempuche/batuda/issues/467)

### CI/CD

* **release:** ui v2026.8.14 ([c15d979](https://github.com/guillempuche/batuda/commit/c15d9791d9cb02b44f6a55d300e3e7b05f14f9c3))

## 2026-08-14 (server-v2026.8.14)

### Bug Fixes

* make a finished research run describe itself accurately ([7c740fb](https://github.com/guillempuche/batuda/commit/7c740fba6bc163a40cc20c6674d4dccde30658a1))
* make a research scan's list one usable row per company ([35f2865](https://github.com/guillempuche/batuda/commit/35f2865661976157c648dcac2395cbf197f423db)), closes [#459](https://github.com/guillempuche/batuda/issues/459)
* **research:** stop grading a run on a profile it was never asked to fill ([39ff15e](https://github.com/guillempuche/batuda/commit/39ff15e18d2c9fb561ad78ecf6f7b242fa8ed5f8))
* **server:** stop telling an assistant to cancel a healthy research run ([7215bce](https://github.com/guillempuche/batuda/commit/7215bce8505dac51167c842d116318e344e2b8b1))

### Tests

* **research:** say what the quality tests check, not what they used to catch ([bc75594](https://github.com/guillempuche/batuda/commit/bc755946713d05f9292f7369cd0794fccefa144e))

## 2026-08-13 (server-v2026.8.13)

### Features

* let a company's own mailbox be unblocked ([8365eec](https://github.com/guillempuche/batuda/commit/8365eec753913dfd1c25c3a8fc3681dc71420b8f))
* **server:** let an assistant unblock a company's own mailbox ([c1cd661](https://github.com/guillempuche/batuda/commit/c1cd661f1a096f78ea9bf075c4353a8231c8105e))

### Bug Fixes

* read a recipient before deciding whether it can be written to ([c66723f](https://github.com/guillempuche/batuda/commit/c66723f7efd62bcd80e9f54e5523f70f760de175))
* refuse an unknown research schema name at the HTTP boundary ([c7362a4](https://github.com/guillempuche/batuda/commit/c7362a4aa2b85c6a4bc3fa530cfd581cd1376d4e))
* **research:** accept the chat-completion replies vendors actually send ([c2394e5](https://github.com/guillempuche/batuda/commit/c2394e57bff8d299804c38d9a9c7964eec1f511c)), closes [#436](https://github.com/guillempuche/batuda/issues/436)
* **research:** ask a scan for breadth, and fill in what it missed ([e5976bb](https://github.com/guillempuche/batuda/commit/e5976bbd56e18440a4ed91a0cda66629c7eb47ed)), closes [#438](https://github.com/guillempuche/batuda/issues/438)
* **research:** file every run under the kind it settled on ([7f0e0ba](https://github.com/guillempuche/batuda/commit/7f0e0bae1c7303a84f7ee528a81959328e67a508))
* **research:** give the brief and a proposed change what they need ([053dd6b](https://github.com/guillempuche/batuda/commit/053dd6b9c1240e5d7c2ef78b46fc966e22b9fb9e)), closes [#435](https://github.com/guillempuche/batuda/issues/435)
* **research:** keep a paid Spanish register lookup that omits a name ([b6b336b](https://github.com/guillempuche/batuda/commit/b6b336b7bf3c21f52cf68d7a4641272b7101b045))
* **research:** keep vendor answers the response checks were discarding ([9dfd21a](https://github.com/guillempuche/batuda/commit/9dfd21ad0173983cd2dfaea592fc1b32a8528c04))
* **research:** make a scan's second look safe and worth its cost ([0220729](https://github.com/guillempuche/batuda/commit/0220729400edcab30978f1713e1e5372b5afea35))
* **research:** make the run service searchable again ([722872f](https://github.com/guillempuche/batuda/commit/722872fc86cc04ab80cc60e408db7393157ef483))
* **research:** make the schema registry break the build when it changes ([64004e6](https://github.com/guillempuche/batuda/commit/64004e644642f90b8045e225571b479bc268820d))
* **research:** report a spent budget as the ordinary stop it is ([b58c516](https://github.com/guillempuche/batuda/commit/b58c516fc4966b2a0cbd5b000519626f7f08c881))
* **research:** report what a discovery scan actually found ([f430b89](https://github.com/guillempuche/batuda/commit/f430b890518f005b3a9a9c1405ca2e8d1aedc9a5))
* **research:** search for real when a stored result cannot be read ([e7ffda6](https://github.com/guillempuche/batuda/commit/e7ffda6766f80e25fdd75516746aa34ccf1e8238))
* **research:** settle the shape of an answer instead of assuming a brief ([27d27c0](https://github.com/guillempuche/batuda/commit/27d27c04588b8a8bb5b99e5b1546c88ee1b126ea)), closes [#433](https://github.com/guillempuche/batuda/issues/433)
* **research:** stop a bad homepage costing a company's whole site ([6e874c2](https://github.com/guillempuche/batuda/commit/6e874c277261b27d1c2bafda07fd51e1b3e04739))
* **research:** tell a company apart by its own name, not its trade ([f7ac5b3](https://github.com/guillempuche/batuda/commit/f7ac5b311364786f8ed100a578e76f4cf93cfbc2)), closes [#454](https://github.com/guillempuche/batuda/issues/454)
* **research:** tell a stored page's id apart from a web address ([45ddb4a](https://github.com/guillempuche/batuda/commit/45ddb4a8e22bbaf4df040aa97c66fb0cc594ab8a)), closes [#434](https://github.com/guillempuche/batuda/issues/434)
* score a search on the companies it came back with ([0857615](https://github.com/guillempuche/batuda/commit/0857615c1fba17f632d49d4c80e6e17184f57311))
* **server:** say that a block outlives the record it was lifted on ([b385328](https://github.com/guillempuche/batuda/commit/b3853282c52c9b77a60b09f112ee93de4610c4b2))

### Refactoring

* **research:** read a value and its page in one place ([75c832e](https://github.com/guillempuche/batuda/commit/75c832e6fcc7b8976bc8f03e5d86fb6f43eeb679)), closes [#435](https://github.com/guillempuche/batuda/issues/435)

### Tests

* **server:** let the boot test ask for a port instead of naming one ([fc359d4](https://github.com/guillempuche/batuda/commit/fc359d4889f86ac8b9a2769b37377c4a01da473b))

## 2026-08-10 (server-v2026.8.10)

### Features

* let a verdict be taken back off an address, not only lowered ([519e309](https://github.com/guillempuche/batuda/commit/519e30916140d24eaa5521c728d39e56be601ee2))
* **server:** let somebody stand behind an address ([e19ed71](https://github.com/guillempuche/batuda/commit/e19ed719db7a03547c2d12b84f6e111dbf77536a))

### Bug Fixes

* ask one question about a blocked address, in one place ([32be485](https://github.com/guillempuche/batuda/commit/32be485c1e6c27a22d8185d44523c8a49f1ddf48))
* keep research to its own organization and make its gates real ([ab2db3c](https://github.com/guillempuche/batuda/commit/ab2db3cef62a457e63fc96024d3df8a78f001c33)), closes [#377](https://github.com/guillempuche/batuda/issues/377)
* **server:** answer a channel call that cannot be carried out, rather than reporting success ([c79178d](https://github.com/guillempuche/batuda/commit/c79178d5ce951b92354c8fa90c8a14c944e7a237))
* **server:** hold an address's verdict to the five words it can be ([345d920](https://github.com/guillempuche/batuda/commit/345d920bf4cfda0cb480824d4c78e446636f73c3))
* **server:** judge a send by the address it is going to ([d93a81c](https://github.com/guillempuche/batuda/commit/d93a81cc43af6aff0873498f79fc0aedc90e18a6))
* **server:** keep a kind's default held, and store a kind one way ([9c59199](https://github.com/guillempuche/batuda/commit/9c591994fb4e29aedf1b80b9d07df98178d8c51e))
* **server:** read a channel's kind folded everywhere, not only where it is stored ([23d71a5](https://github.com/guillempuche/batuda/commit/23d71a54b506829a2c4fe18cfdf91cbc27685690))
* **server:** send a reply to whoever wrote in ([5e1dd20](https://github.com/guillempuche/batuda/commit/5e1dd205da2d6fbb7710179ff349927070bf0883))

## 2026-08-08 (server-v2026.8.8)

### Features

* let a company be deleted, and check who work is handed to ([86688c1](https://github.com/guillempuche/batuda/commit/86688c17af1aeb08f92aa6d01b98d3eb43827df2))
* let a wrong address on a contact be corrected or removed ([7499f7c](https://github.com/guillempuche/batuda/commit/7499f7c698317ee89d435ca1c03cf4ad68e5735a))

### Bug Fixes

* **research:** say when a contact search was cut short by a vendor ([d04c6e8](https://github.com/guillempuche/batuda/commit/d04c6e8a0a2c3d169c56dea7697e1a2e8624513a))
* **research:** stop a contact search spending past what it quoted ([29e3fb3](https://github.com/guillempuche/batuda/commit/29e3fb35f2e87c139d7eef0f563546bb8d4d0b30))
* **research:** stop a run with no surviving citations reading as clean ([bee79e5](https://github.com/guillempuche/batuda/commit/bee79e5285867e7ca5868123d4c48e7efdc1bbb5))
* **server:** put stored deliverability verdicts right ([450f098](https://github.com/guillempuche/batuda/commit/450f09877d58f6b268663b2cc4e7fa5af3c2f59a))

### Refactoring

* keep the email-check verdicts and channel kinds in one place ([e5d31c2](https://github.com/guillempuche/batuda/commit/e5d31c25554edacc34362313eaef0e70e74c789a))

### CI/CD

* **release:** ui v2026.8.7 ([137771c](https://github.com/guillempuche/batuda/commit/137771c4e93163e322df2a5aa9a4f6c249565a2d))

## 2026-08-07 (server-v2026.8.7)

### Features

* make the companies pages fit a phone and lead with the notes ([fd8f64c](https://github.com/guillempuche/batuda/commit/fd8f64c9c25405620b3a31ece165e12e3e75ee72))
* make the pipeline page a work queue rather than a noticeboard ([be21c14](https://github.com/guillempuche/batuda/commit/be21c147f605e1d5ea99fe7daa391ec26ab46847))

### Bug Fixes

* **mail-worker:** read the sent folder without losing or mis-filing mail ([c674682](https://github.com/guillempuche/batuda/commit/c674682008bbdacd111fa01355f23c0493a03652))
* **research:** keep vendor API keys out of our tracing data ([2a940d3](https://github.com/guillempuche/batuda/commit/2a940d3f4d53dcc662a0c3326017d6a9a2b4cd57))
* **server:** store the body of a sent email so it can be read back ([3f5d9e3](https://github.com/guillempuche/batuda/commit/3f5d9e3f0ff05485be5e3ab10abcf17eafb4810d))

## 2026-08-04 (server-v2026.8.4)

### Features

* let anyone rewrite a company's account brief ([0040a0d](https://github.com/guillempuche/batuda/commit/0040a0df18607501c4e057b0c2b667c0ff65a6ff))
* **server:** let agents assign a company to a colleague ([6fe5238](https://github.com/guillempuche/batuda/commit/6fe5238459e3ee21e3937d716327b1d763b23b93))

### Bug Fixes

* **server:** check an assigned person wherever a company is written ([ae11569](https://github.com/guillempuche/batuda/commit/ae11569c9bbf0147abb09f5563a2df27659001a5))
* **server:** exclude deleted companies from pipeline and planning ([e98447e](https://github.com/guillempuche/batuda/commit/e98447e2bd9a4fadfbd678837af458e6b6759cd9))
* **server:** keep tasks that belong to no company in the overdue figure ([557fb70](https://github.com/guillempuche/batuda/commit/557fb70a20c8deda54b0c531e2fbe4bb58fad26b))
* **server:** make the pipeline count and research values agree with themselves ([7b197d3](https://github.com/guillempuche/batuda/commit/7b197d36818bbd7eeec74136ce0ab98af2c0e408))
* **server:** refuse research suggestions a column cannot accept ([4ae1eef](https://github.com/guillempuche/batuda/commit/4ae1eefa8fff741f458c76d813afea8549d2eac0))
* **server:** tell a stale MCP caller where a renamed tool went ([6d89895](https://github.com/guillempuche/batuda/commit/6d8989571a67c5cd55a1612fc18196eed7a0f5ce))

### CI/CD

* **release:** ui v2026.8.3 ([84c0ba3](https://github.com/guillempuche/batuda/commit/84c0ba32eb115c8cc11dc43b221e3bd421c21f5a))

## 2026-08-03 (server-v2026.8.3)

### Features

* a company is more than one mailbox, one place, and one decider ([247bf91](https://github.com/guillempuche/batuda/commit/247bf915739c8be4574fea8a187251ab7ea975a6)), closes [#376](https://github.com/guillempuche/batuda/issues/376)
* carry an address name and a person's branch through the API ([ee93ba0](https://github.com/guillempuche/batuda/commit/ee93ba046366222c755258ddc3f8f79fd367b426))
* describe mailboxes freely and decide access from who owns them ([a626db1](https://github.com/guillempuche/batuda/commit/a626db1b98848b30d5ca898ba27b4f2158ea9bde)), closes [#375](https://github.com/guillempuche/batuda/issues/375)
* keep the contact details and people a research run finds ([8eff397](https://github.com/guillempuche/batuda/commit/8eff397812861fcec30ec459514d222fa0261dd9))
* let each organisation name the trades it sells to ([fd9c998](https://github.com/guillempuche/batuda/commit/fd9c9982e9eef1db581ec8c77fccdbd156cf0340))
* let every member manage the shared instruction templates ([e3e692a](https://github.com/guillempuche/batuda/commit/e3e692a123747b0fe11566dbf9bec5aaacae6864))
* **server:** name a company's addresses and let a branch hold its own ([22c8bc7](https://github.com/guillempuche/batuda/commit/22c8bc7daa180a358ea5deda4bd8564ccf6fab91))
* store the number a company is registered under ([d0dd2c5](https://github.com/guillempuche/batuda/commit/d0dd2c50629ec6c2ccfc7d71e127ad5086c58f22))

### Bug Fixes

* keep the template dialog usable by keyboard and screen reader ([7356841](https://github.com/guillempuche/batuda/commit/735684190611848eb1de14828ed8f6ef0b1d3e31))
* **observability:** stop sending tool arguments to the tracing vendor ([7a69465](https://github.com/guillempuche/batuda/commit/7a694658bf9e44c0ffd840f5f0c13abd93c71c0f))
* **server:** put mailbox ownership out of an ordinary request's reach ([e4810c4](https://github.com/guillempuche/batuda/commit/e4810c492d640a516370c24826aaa25f88a13e6f)), closes [#386](https://github.com/guillempuche/batuda/issues/386)
* **server:** stop a burst of writers colliding over one new trade ([d8329b3](https://github.com/guillempuche/batuda/commit/d8329b38c322d455655470ede2437959421dd9fd))
* **ui:** turn only the leading arrow when a section opens ([575ada2](https://github.com/guillempuche/batuda/commit/575ada2a86b84a89d9f4aaad58ca64dbc28db585))

### Refactoring

* remove what the trades change left behind ([263d903](https://github.com/guillempuche/batuda/commit/263d90396fa30e9b89da931666ce6cb0cf348ca0))
* stop keeping a second list of who a product is for ([4c2d5ea](https://github.com/guillempuche/batuda/commit/4c2d5ea12103b77b00bc5fe3bf7d2341bb49a7c7))

### Tests

* **research:** measure the company shapes this issue is about ([030c5b3](https://github.com/guillempuche/batuda/commit/030c5b31911bdf124d3f694bf69cce5e9ed67e00))

### CI/CD

* **release:** ui v2026.7.28 ([acb53ba](https://github.com/guillempuche/batuda/commit/acb53ba19db2f26498659d1979f20b9f1dad953e))

### Chores

* raise Effect to beta.102 and fix what the raise uncovered ([72da41c](https://github.com/guillempuche/batuda/commit/72da41cf0d4e69a002cf740a1f8f96cbbe5a80c9))
* say the mailbox rules once instead of three times ([a9cff18](https://github.com/guillempuche/batuda/commit/a9cff18ad9635b0073dfe06a7151d81c207b794c))

## 2026-07-28 (server-v2026.7.28)

### Features

* bound every list request and count only when asked ([c9f96f1](https://github.com/guillempuche/batuda/commit/c9f96f19406f26624ee325ecfa11cc6ed4db7df5))
* count the rounds a research run has got through ([5ccc984](https://github.com/guillempuche/batuda/commit/5ccc984259e6ab0e19390d51b48bf29b0fef6e6a))
* let a member choose which organizations an assistant works in ([39660e6](https://github.com/guillempuche/batuda/commit/39660e68c1347bdcea8beb0f9565412a3a8f6838))
* let an organization allow back an assistant it stopped ([37d2b03](https://github.com/guillempuche/batuda/commit/37d2b03af2399690aeb8110323562d859e7a2530))
* **mcp:** tell the assistant when a list was cut short ([cd6d84d](https://github.com/guillempuche/batuda/commit/cd6d84dde067bb4617277fd9f8475c6756c7df0c))
* **research:** find a company's own site, and see whether the profile came back full ([be609dc](https://github.com/guillempuche/batuda/commit/be609dc39eff74f6573084ea08a495a46d2e647e)), closes [#328](https://github.com/guillempuche/batuda/issues/328)
* surface finished research in the daily plan ([aa6d9be](https://github.com/guillempuche/batuda/commit/aa6d9beabba181098c7e6e3a7c1bb3aa9e8550cb))
* tell the caller when to check a research run again ([5c55ef4](https://github.com/guillempuche/batuda/commit/5c55ef424e78e5ee963b71d73de8ff938075ea39))

### Bug Fixes

* carry the request to be counted all the way through ([790213a](https://github.com/guillempuche/batuda/commit/790213a6af1ec1d167b5212af2381d2ad526cecb))
* key every poller off the one list of finished statuses ([b8369ec](https://github.com/guillempuche/batuda/commit/b8369ec5c938287d088f1b73ea1daf08ef0ecb68))
* let the browser find text inside a folded section ([c521122](https://github.com/guillempuche/batuda/commit/c5211227487b6f6e442ffd195e2f2a6a368a5872))
* **mcp:** tell the agent which of its lists were cut short ([64eab00](https://github.com/guillempuche/batuda/commit/64eab004246f6d521f0da81b5400a57c98400558))
* **server:** give the paged proposal and page lists a settled order ([53f3308](https://github.com/guillempuche/batuda/commit/53f33086cbdd1d4dbb6873090492b8a815f5ea7e))
* **server:** settle duplicate-contact search on the oldest match ([04ec65c](https://github.com/guillempuche/batuda/commit/04ec65cb41ae345326c11dd2e33a753ca9fe0953))

### Documentation

* describe how a client follows a running research run ([398d225](https://github.com/guillempuche/batuda/commit/398d225fe3cd939a5c0fb0514067579c78619cb2))
* write down how a list endpoint answers ([726e21e](https://github.com/guillempuche/batuda/commit/726e21e6dae63d5bd800399f50ab2700a2964e0d))

### CI/CD

* **release:** ui v2026.7.27 ([7dd5da6](https://github.com/guillempuche/batuda/commit/7dd5da62db960b640deb41b4daf3c79305f71e6d))

## 2026-07-27 (server-v2026.7.27)

### Features

* **calendar:** keep what an invitation says about days and attendees ([c2acac7](https://github.com/guillempuche/batuda/commit/c2acac7d96f5d0b0cdd95e893f44f3ae95a8676b))
* **cli:** report cost, credits and tokens in the research eval ([6e58cda](https://github.com/guillempuche/batuda/commit/6e58cdaf1c14fcbc1031c4567cb95ceb7bb92ccb))
* let a document be a whole web page, opened in its own tab ([1380a14](https://github.com/guillempuche/batuda/commit/1380a14301b3da467764bbfc0126ee92f866cedf))
* let a document belong to a meeting, a person or a task ([9372f96](https://github.com/guillempuche/batuda/commit/9372f96f4c2bb515d74fd3f36e4a36085dfe2ad8))
* let a task, a proposal or a meeting show its own history ([200142d](https://github.com/guillempuche/batuda/commit/200142df0c6aaccd0f782c68f59d50eb93f214e0))
* let an email in the history open the conversation it belongs to ([d3c7a8a](https://github.com/guillempuche/batuda/commit/d3c7a8a486a2c46815f7907d87485e03d52b4a50))
* let owners cut an AI assistant off from an organization ([f3b476f](https://github.com/guillempuche/batuda/commit/f3b476f362954bd3c321fa9c26e5357b8831ea69))
* let owners see every assistant that can reach the organization ([a0f2f7e](https://github.com/guillempuche/batuda/commit/a0f2f7ec8243bd72a378b531af3a37340967be3c))
* open a saved web page at an address that keeps working ([dda758f](https://github.com/guillempuche/batuda/commit/dda758f56532602c32b25af7a8b3bb87ef443fcb))
* **research:** carry a change's values, sources and cost to whoever reviews it ([869ecfc](https://github.com/guillempuche/batuda/commit/869ecfc2421e61e38f67ffad88a5bb35787feca5))
* **research:** hold the monthly research ceiling per organization ([02ea4df](https://github.com/guillempuche/batuda/commit/02ea4df0528e48044fa1327138135a305c11d8fb))
* **research:** record what a run really spends ([32d2e94](https://github.com/guillempuche/batuda/commit/32d2e94276259a1a51baaf745e330d4988128ea7))
* retire the three separate notes boxes into documents ([d194f75](https://github.com/guillempuche/batuda/commit/d194f75fd4135b810b3376be827e3cee34903cd9))
* **server:** serve task inbox shelves and their sizes ([4b41b86](https://github.com/guillempuche/batuda/commit/4b41b86ee65ce6b908e667d9891281304795e39f))
* **server:** set what each research provider charges ([5fe385c](https://github.com/guillempuche/batuda/commit/5fe385cd92e581fa5ec2c21afcfbdc86bb0c21d8))
* show which tool last used each API key, and when ([65ffaf2](https://github.com/guillempuche/batuda/commit/65ffaf2a874a6bfc274d7252d34eb4d651ccbb35))

### Bug Fixes

* **calendar:** read invitation times as sent, and keep whole-day ones ([d991f25](https://github.com/guillempuche/batuda/commit/d991f258550e3555d13004814931dc52e5098a7f))
* **crm:** record where each company field came from ([33611de](https://github.com/guillempuche/batuda/commit/33611de660a5878f76b88e8ca18ec6a0a5b67016))
* **db:** read stored json by the names it was stored with ([c9f2d7a](https://github.com/guillempuche/batuda/commit/c9f2d7ae80b95e5df00a8fd0af499d4b4e00ad9b))
* drop a revoked organization from the connections list ([aa5f272](https://github.com/guillempuche/batuda/commit/aa5f27253f55138389fc05af36eed7ca8afea798))
* **internal:** read research findings by their stored names ([3be10aa](https://github.com/guillempuche/batuda/commit/3be10aa2e951a30d4a576c5aa4fb2792b95ea180))
* keep hand-logged touchpoints in the company history ([d8a653c](https://github.com/guillempuche/batuda/commit/d8a653cdedd0bec0cc31e436e1de4837e6b94589))
* name each history row for what it is and show agents the attendees ([c82f723](https://github.com/guillempuche/batuda/commit/c82f723dad38b2f1fff49fab90d4ea32e5c795dc))
* **research:** approve a paid request once, and say when the money runs out ([19e511e](https://github.com/guillempuche/batuda/commit/19e511eeafffdd2738203b9fa7506bc65125ac4c))
* **research:** count every call a run is billed for ([40c9b0e](https://github.com/guillempuche/batuda/commit/40c9b0ee0b983e7397d4a29657f2a776894fdf3d))
* **research:** never buy the same registry lookup twice ([5328d99](https://github.com/guillempuche/batuda/commit/5328d99e1be7af12f61db6a1351f0ac495cc181f))
* **research:** quote what a batch of research would really cost ([5367cc1](https://github.com/guillempuche/batuda/commit/5367cc1d29c2522d41dd0334d59398d2daa88f80))
* **research:** save the spending limits instead of dropping them ([008c8c3](https://github.com/guillempuche/batuda/commit/008c8c3c958d8ae33e58c10057a90bbd21379477))
* save calendar invitations and show who is attending ([6ad893d](https://github.com/guillempuche/batuda/commit/6ad893dc5bcb5cbb6e979291f299f91ac5266e60))
* **server:** keep a record of every paid research call ([a6922d5](https://github.com/guillempuche/batuda/commit/a6922d56aaf732f5d0b99a5d249497cc99dbc520))
* **server:** stop a half-specified shelf from unhiding hidden work ([9dcb658](https://github.com/guillempuche/batuda/commit/9dcb658d05642c80e09ae28c56ff5903a4349d87))
* **server:** stop a meeting with people on it from failing to load ([267d066](https://github.com/guillempuche/batuda/commit/267d06651c9128ac82733ccc27574b3cc5a13307))
* **ui:** make the keyboard focus mark visible, and name what it lands on ([6091b54](https://github.com/guillempuche/batuda/commit/6091b540d2dbc726b11cbaa00146f7489445dd5b))

### Refactoring

* name the CRM rows a link can point at in one place ([fff48f2](https://github.com/guillempuche/batuda/commit/fff48f2c3a5906abf925d5d97aa7d778c2502234))
* **research:** drop the token counting the meter replaced ([41ffc91](https://github.com/guillempuche/batuda/commit/41ffc91fdd1d9f0ddba33a53986a9519bc561baa))
* **research:** drop the unused provider credit allowance ([3c04bd7](https://github.com/guillempuche/batuda/commit/3c04bd7f880c1fa7cda62491fc50de293b10b416))
* **server:** fold the mailbox and event-type tools into four ([4034193](https://github.com/guillempuche/batuda/commit/403419315c2505685b77384dca4a62823087128d))
* **server:** name the keys a contact's channels ship with ([7500332](https://github.com/guillempuche/batuda/commit/7500332b6ac86545727f2de9040adb756b320127))

### Tests

* **research:** cover the monthly ceiling and the flat charge ([bf66238](https://github.com/guillempuche/batuda/commit/bf662381bb8db6f530510acf71486cab109ee265))

### CI/CD

* **release:** ui v2026.7.25 ([782c3bb](https://github.com/guillempuche/batuda/commit/782c3bb38a2cae1aee41b056d6c24cfd471b84b5))

### Chores

* remove dependencies and build settings nothing uses ([44d9d28](https://github.com/guillempuche/batuda/commit/44d9d28002545f104f5b455af095ed09ebd1a165))
* renumber the new migrations behind the ones main added ([c1b2471](https://github.com/guillempuche/batuda/commit/c1b2471ea35e41f472050c7b5a6a877deba50fcc))
* **server:** drop paid-research columns nothing read ([995baad](https://github.com/guillempuche/batuda/commit/995baadc5855a3a37cb68bfe73f1ed2d3141036a))

## 2026-07-25 (server-v2026.7.25)

### Features

* add a match count to the list endpoints ([a6ed26f](https://github.com/guillempuche/batuda/commit/a6ed26f9292a2a63ebc0e4e93725565601dfb6a9))
* **controllers:** carry a company's research history on its detail ([d908a5e](https://github.com/guillempuche/batuda/commit/d908a5e19e1c3273eb19b0ed387116bae7e52e8d))
* **domain:** store a company's brief, provenance and fit ([dd9f12f](https://github.com/guillempuche/batuda/commit/dd9f12fed71bf5b143d0fb7a07a8496f2291a04c))
* **research:** ground findings to the right company and fill the gaps ([33f6563](https://github.com/guillempuche/batuda/commit/33f6563cbd57fb6e7ba40a6458926e3992d37353))
* **server:** apply research provenance and a company's shared brief ([93eebd3](https://github.com/guillempuche/batuda/commit/93eebd370e7b8471f702ed287c3eafa5a629d392))
* support multiple named instruction stacks per org and user ([f111b3d](https://github.com/guillempuche/batuda/commit/f111b3d33d2f658a9c3721759d0fea53896c5bf6))
* **ui:** add mobile dialog sheets and a destructive button ([80cf0c0](https://github.com/guillempuche/batuda/commit/80cf0c081c8f50ea89aae9d534924b96d7eb92ad))

### Bug Fixes

* **instructions:** refuse to transfer a template still used in a stack ([4ea4d50](https://github.com/guillempuche/batuda/commit/4ea4d5057b42e9c99f222c2774d5d852d796b838))
* **research:** keep open-web searches anchored to the target company ([7aa5d00](https://github.com/guillempuche/batuda/commit/7aa5d00a1f5bfdfe30d4e0df5894549f225b0a88))
* **ui:** respect prefers-reduced-motion in dialog transitions ([5da8b54](https://github.com/guillempuche/batuda/commit/5da8b54a1ba8758f817c495863295c073e0210cd))
* validate the stack a run picks and report stack write failures ([f714b79](https://github.com/guillempuche/batuda/commit/f714b791dfecd7e84e0521f00b392cd0cc1e693e))

### CI/CD

* **release:** ui v2026.7.22 ([ffc3330](https://github.com/guillempuche/batuda/commit/ffc333012bde23f2f0daeb96761c23aa6ae9c63d))

### Chores

* pin the [@tiptap](https://github.com/tiptap) packages to 3.28 for markdown support ([f7bfbd1](https://github.com/guillempuche/batuda/commit/f7bfbd1ce8350190f29baab361e022c066735640))

## 2026-07-22 (server-v2026.7.22)

### Features

* **auth:** remember which language each person reads ([ddbc59f](https://github.com/guillempuche/batuda/commit/ddbc59f023cc54d69b1c2d0fceb8ec1f8ad248a9))
* **cli:** choose the language when creating an account ([e28802c](https://github.com/guillempuche/batuda/commit/e28802cb887537142b98d74495f5fe3065584c8c))
* **domain:** move the list of languages into the shared package ([0bcb7d0](https://github.com/guillempuche/batuda/commit/0bcb7d067af6c6b9f7801871badb319020cb6073))
* **server:** add people to an organization directly ([efed2b7](https://github.com/guillempuche/batuda/commit/efed2b783853d28d9e165ed0847b5d35dd78e527))
* **server:** write system email in the reader's language ([0ef4a0d](https://github.com/guillempuche/batuda/commit/0ef4a0d68a11c0898441e52a47830725e92ea586))
* **ui:** add the dark and high-contrast themes ([d874fae](https://github.com/guillempuche/batuda/commit/d874fae410181a53301b3fc33078c1c09c55e09a))

### Bug Fixes

* **internal:** make the dark themes correct on the surfaces that ignore them ([aa631eb](https://github.com/guillempuche/batuda/commit/aa631eb4d68e89639bb6452736ebb4dace68cbe0))
* **internal:** only offer to approve a paid step that can be run ([b2814d7](https://github.com/guillempuche/batuda/commit/b2814d7f83f93965f6a42a59d0d7eaefb68feb24))
* **internal:** show failed loads as errors instead of empty lists ([91fdb99](https://github.com/guillempuche/batuda/commit/91fdb9909398ec2715602c36fa1269d97f8d22b7))
* **server:** only undo an account this request created ([b2dbc86](https://github.com/guillempuche/batuda/commit/b2dbc867a5228f4d0be9d21fb7d0d3f389e95a2b))
* stop auth invite issuing sign-in links that cannot be delivered ([55d1554](https://github.com/guillempuche/batuda/commit/55d1554324a6bf16f33b3f7c1a85936daac3cce0))
* **ui:** serve the design tokens from a single copy ([92e1f5b](https://github.com/guillempuche/batuda/commit/92e1f5b54675bd85ef6bd9e3033a2205cef64b84))

### Refactoring

* **server:** remove the invitation email path ([b5ca1a7](https://github.com/guillempuche/batuda/commit/b5ca1a70e6325bd8cfc81b626cbdaf5e0535a973))
* **ui:** complete and restructure the design token system ([6cc0243](https://github.com/guillempuche/batuda/commit/6cc0243486d5310cb56c574b4dc7bbe355c4519c))
* **ui:** draw library primitives from tokens instead of fixed colours ([aef36ab](https://github.com/guillempuche/batuda/commit/aef36ab9d6d965c1fb10c1f012310f2b62d9ce02))

### Documentation

* **server:** explain the attachment disposition without naming a retired vendor ([495d81b](https://github.com/guillempuche/batuda/commit/495d81be9f76397cb943bfc58e1a81f1445f10a9))

### Tests

* **internal:** wait for the page to be live before clicking ([6239336](https://github.com/guillempuche/batuda/commit/62393367d41a99191fe5dad95a85d4c57fd03bb0))
* **ui:** check theme contrast against the token file before pushing ([103aef4](https://github.com/guillempuche/batuda/commit/103aef4a928dc4d4100ea532e3363b401ce09856))

### CI/CD

* cover Better Auth schema changes before they reach production ([9b52813](https://github.com/guillempuche/batuda/commit/9b52813e7cca1d5478de6cbbf4ab2f03c66c0440))
* run the theme contrast check where it cannot be skipped ([9198703](https://github.com/guillempuche/batuda/commit/91987035a3f60998586bf8f8b91b1589d272f8f2))

## 2026-07-20 (server-v2026.7.20)

### Features

* **research:** recover more company data and reject look-alike matches ([52af91f](https://github.com/guillempuche/batuda/commit/52af91f59836ebb5db25e1460464624ccdc2dde3))

### Bug Fixes

* stop issuing sign-in links that cannot be delivered ([4e6a745](https://github.com/guillempuche/batuda/commit/4e6a74529f9e25a84dd2ca3f1c821ba56496c46d))

### Documentation

* correct first-run setup, cloud secrets, and magic-link delivery ([df6f617](https://github.com/guillempuche/batuda/commit/df6f617ca4e6210f6832bf0328b201817640b540))

## 2026-07-18 (server-v2026.7.18)

### Features

* bump Effect to 4.0.0-beta.98 and give API responses typed schemas ([9365867](https://github.com/guillempuche/batuda/commit/936586718e5de8410e6e33b053b455b517a1ae68))
* **research:** add a per-contact critic to drop non-staff contacts ([c1e9112](https://github.com/guillempuche/batuda/commit/c1e9112971c33e5363bfb48f3c1fd39e87c62c79))
* **research:** drop a directory listing posing as a company's website ([c9b1326](https://github.com/guillempuche/batuda/commit/c9b13265b5f6d260526626428b2b44231ee21b6e))
* **research:** fetch a company's about and team pages up front ([808b251](https://github.com/guillempuche/batuda/commit/808b251cdb81e549ae7f5b2ab08a83881386a3c6)), closes [#286](https://github.com/guillempuche/batuda/issues/286)
* **research:** leave out prospects that miss the size or place asked for ([fef32e9](https://github.com/guillempuche/batuda/commit/fef32e97fc8887f851131c4116faf2531bb8064b))
* **research:** look a company up in its national register ([fcc1f4e](https://github.com/guillempuche/batuda/commit/fcc1f4eccdb3439057858693405648942baf5756))
* **research:** make the eval score honestly and trace dropped fields ([672ea4e](https://github.com/guillempuche/batuda/commit/672ea4ef3caf98dd748adb0b28871c9498e591e6)), closes [#286](https://github.com/guillempuche/batuda/issues/286)
* **research:** measure how much of a company profile each step fills ([c620461](https://github.com/guillempuche/batuda/commit/c62046175cc4f17855cacbdab806ae961f090c57))
* **research:** propose CRM corrections from what a run already holds ([efed961](https://github.com/guillempuche/batuda/commit/efed961c8a7933fd6de33399543b464a720aeb37))

### Bug Fixes

* give each git worktree its own integration-test database ([88a1cd1](https://github.com/guillempuche/batuda/commit/88a1cd11feb83cfa5504d11d95a02e478c2a93ab)), closes [#295](https://github.com/guillempuche/batuda/issues/295)
* **research:** accept a search number the model writes as text ([a20db0a](https://github.com/guillempuche/batuda/commit/a20db0abc063f65115d54a0962d478fbc9b81367))
* **research:** ask the extraction to read all the evidence, not just the start ([79a256c](https://github.com/guillempuche/batuda/commit/79a256c2166da398d24600711936031013b6224a))
* **research:** cancel research runs coherently by run kind ([b31a94c](https://github.com/guillempuche/batuda/commit/b31a94c0d2d25a38b7b3a31bd2db991f37067297))
* **research:** check a model against the tools a run really sends ([aae6d18](https://github.com/guillempuche/batuda/commit/aae6d18c870809b633db7e8b36354ed9b4932746))
* **research:** enforce the auto-approve limit on in-run paid calls ([fedd3a4](https://github.com/guillempuche/batuda/commit/fedd3a4894875a25c795408643e593bafe6f6cbd)), closes [#279](https://github.com/guillempuche/batuda/issues/279)
* **research:** give a research model 90 seconds to answer ([0619382](https://github.com/guillempuche/batuda/commit/061938299b902474daf059c0431f8029f525deff))
* **research:** harden checkpoint writes against cancel and crash ([0c3a068](https://github.com/guillempuche/batuda/commit/0c3a068fb3f19c0748b3c66d8538383fee3bf35e))
* **research:** hold a proposed CRM change's place to the evidence ([264ae36](https://github.com/guillempuche/batuda/commit/264ae36ad80b3aeaccf1f4290ec4ad0f3af90154))
* **research:** keep a company's own pages even when they never name it ([3897452](https://github.com/guillempuche/batuda/commit/3897452813221046c17f1f98b422ecf7c085ee85)), closes [#286](https://github.com/guillempuche/batuda/issues/286)
* **research:** let a register that cannot answer reach the model, not end the run ([8c4d404](https://github.com/guillempuche/batuda/commit/8c4d4044655248f383d5727f382a63d35056c7e8))
* **research:** make discover_contacts paid-action gates approvable ([d64e57b](https://github.com/guillempuche/batuda/commit/d64e57b1c631dd39bdafbc1db292a6319d9b94a3)), closes [#280](https://github.com/guillempuche/batuda/issues/280)
* **research:** normalize the extracted country to an ISO code ([607e813](https://github.com/guillempuche/batuda/commit/607e81326654512eecde6b604a981c5bfe28b8f6)), closes [#286](https://github.com/guillempuche/batuda/issues/286)
* **research:** recover the job titles the extraction drops ([1a89034](https://github.com/guillempuche/batuda/commit/1a89034295615bd135587097082dee253bbc51c7))
* **research:** reject a location that names no place ([2d41ed8](https://github.com/guillempuche/batuda/commit/2d41ed8f8aa6908c70f97f1a60196663f2308baa))
* **research:** reliably capture a company's employee headcount ([c26d300](https://github.com/guillempuche/batuda/commit/c26d300cdab3907e982e81a8dbceeb573fda96b4))
* **research:** return not-found for a non-uuid research id ([d7e44f4](https://github.com/guillempuche/batuda/commit/d7e44f466c3bc62ea197154802db353c212c90d0))
* **research:** roll run and group cost from the paid-spend ledger ([d1b2649](https://github.com/guillempuche/batuda/commit/d1b2649aabfddc34c6bf6f17aeffdcf8c18e10b2))
* **research:** stop a resumed run from renaming its findings keys ([8056aae](https://github.com/guillempuche/batuda/commit/8056aaed1a93a5b71f868411315b418ebdfd75c1))
* **research:** stop cache-hit reuse from renaming findings keys ([d6a957b](https://github.com/guillempuche/batuda/commit/d6a957badd8f389fab12549dbbd1f9429c394297))
* **research:** stop prospecting from returning the biggest firms in the sector ([7939f16](https://github.com/guillempuche/batuda/commit/7939f163b01947b11d89b30a3fd49e3ec097605d))
* **research:** trust a value cited to a search result the run surfaced ([f685b0a](https://github.com/guillempuche/batuda/commit/f685b0a1a82d92b3d6040f083a072e703c22c425)), closes [#286](https://github.com/guillempuche/batuda/issues/286)
* return declared API errors with their real HTTP status ([b5133f9](https://github.com/guillempuche/batuda/commit/b5133f9677b3ac1ede40fa7438b27922ca74cb3a))
* **server:** extract research fields with gpt-oss-120b, not Qwen ([f84d585](https://github.com/guillempuche/batuda/commit/f84d5851d82b6c806de5a6b1e5616216b60d620a))
* **server:** fall back to a location-only geocode query ([240a5f8](https://github.com/guillempuche/batuda/commit/240a5f8ea82f09004716b0458b816ff3a8a90168))
* **server:** make research_sync durable and gate MCP selector fan-out ([e5bce1f](https://github.com/guillempuche/batuda/commit/e5bce1fd0678337d580aa180a3b04a562f7cecbf)), closes [#277](https://github.com/guillempuche/batuda/issues/277) [#278](https://github.com/guillempuche/batuda/issues/278)

### Refactoring

* remove the unwired web tools and extract/discover backend ([7fce393](https://github.com/guillempuche/batuda/commit/7fce3936871e0925864f41a11c79a87d9bda6dca))
* **research:** give freeform the shared proposed-update shape ([5827769](https://github.com/guillempuche/batuda/commit/5827769b8d2bb0309bad98cceb25af85e1698a10))
* **research:** name the prompt that turns evidence into findings ([26945ee](https://github.com/guillempuche/batuda/commit/26945ee793a7a2ad0cc831c43fccd98b8f26135f))
* **server:** share detachFromTransaction from the org middleware ([6b60d04](https://github.com/guillempuche/batuda/commit/6b60d0497426e56bb02bd2051a9d5ab03b9cbc09))
* use English codes for the CRM industry categories ([44007a3](https://github.com/guillempuche/batuda/commit/44007a35d3387c0c24ae44fb7b6de6c186ca13ec))

### Tests

* **research:** remove stale integration test placeholders ([f02c484](https://github.com/guillempuche/batuda/commit/f02c4848ef27a5a098f7efe4b2ffb2ebb06b7dd0))

### Chores

* bump Base UI to 1.6.0 ([080a353](https://github.com/guillempuche/batuda/commit/080a353031b9375b61617aec9bcffd413fd4faff))
* bump react/react-dom to 19.2.7 and @types/react to 19.2.17 ([08283e2](https://github.com/guillempuche/batuda/commit/08283e2e4b604b6d0617b0c85b952d640ea2422b))

### AI

* **mcp:** delete the dead research-sink and research-crm toolkits ([f25c977](https://github.com/guillempuche/batuda/commit/f25c977dd99c8e1991e12ce053e6721750ef7ad1))

## 2026-07-13 (server-v2026.7.13)

### Features

* replace Spain-only company region with a global country ([210fb17](https://github.com/guillempuche/batuda/commit/210fb17864a85e98dbbeab2b02aaa6bbdd0b7c3b))
* **research:** add Brave LLM Context as a search vendor ([ce11517](https://github.com/guillempuche/batuda/commit/ce1151704c0da4c85181b02cbd0fc52820a3df1e)), closes [#255](https://github.com/guillempuche/batuda/issues/255)
* **research:** cap confidence on third-party-sourced values ([e6926de](https://github.com/guillempuche/batuda/commit/e6926de026cb88c4bc45a3a8f4bc9df94c2c01ed)), closes [#255](https://github.com/guillempuche/batuda/issues/255)
* **research:** cascade an empty search to the next vendor ([8a52676](https://github.com/guillempuche/batuda/commit/8a526769fd4c7ac7b6345b004fa0e4426e4418a4)), closes [#255](https://github.com/guillempuche/batuda/issues/255)
* **research:** give each contact its own citations ([c1488cc](https://github.com/guillempuche/batuda/commit/c1488ccfeea7ffa03f7a68fac3ea3eabce16f950)), closes [#255](https://github.com/guillempuche/batuda/issues/255)
* **research:** recover under-filled contacts and firmographics ([9e4fc44](https://github.com/guillempuche/batuda/commit/9e4fc44b4259ee0fb80ae1b2fa96b1671057a373)), closes [#255](https://github.com/guillempuche/batuda/issues/255)
* **research:** score how many known contacts come back with a title ([67e66af](https://github.com/guillempuche/batuda/commit/67e66af1d0b661ed04b7df0e40461895dd052721))
* **research:** search in the target's language and read own-site pages first ([610d3db](https://github.com/guillempuche/batuda/commit/610d3db218883bd96aa1081b02f4de9dc89cb902)), closes [#255](https://github.com/guillempuche/batuda/issues/255)
* **ui:** add PriMenu action-menu primitive ([8bf09a8](https://github.com/guillempuche/batuda/commit/8bf09a8dc819c5c2b1303c86f4212bad5a7cec5f))

### Bug Fixes

* **research:** drop ungrounded fields and read full source pages ([2f5fa52](https://github.com/guillempuche/batuda/commit/2f5fa52b7bfe8663e5f3c63e1960a67e448ad75c))
* **research:** follow a moved company domain to its new site ([74f43b2](https://github.com/guillempuche/batuda/commit/74f43b208e73186d4c266411464cc8595a3ce7dd))
* **server:** show the message subject when a thread link has none ([8e35c53](https://github.com/guillempuche/batuda/commit/8e35c534035ee9f5a9c22b5916d57331f5f7a7ab))

### Refactoring

* **research:** remove the extract_structured tool ([5547579](https://github.com/guillempuche/batuda/commit/5547579c982d79f5d17e8c27724cda0d06d5070b))

### CI/CD

* **release:** ui v2026.7.12 ([ddb7645](https://github.com/guillempuche/batuda/commit/ddb76459787d8b231ade3e051827affa0694d4ec))
* **release:** ui v2026.7.13 ([554e3cb](https://github.com/guillempuche/batuda/commit/554e3cb5461a504581b5b7ff56e9f769cdd25076))

### Chores

* **server:** enable Brave LLM Context search vendor in production ([3f29f0c](https://github.com/guillempuche/batuda/commit/3f29f0c8324a71b0957440d4490e0dce734a791e))

## 2026-07-12 (server-v2026.7.12-1)

### Features

* **research:** add FullEnrich people search for decision-makers ([6fcfa75](https://github.com/guillempuche/batuda/commit/6fcfa758178b60593d5bda53cc5e91fcb32da47a))
* **research:** fall back to the next enrichment vendor on a miss ([89b2004](https://github.com/guillempuche/batuda/commit/89b20047ac253488fd52c3aafc4020b7167ec712))
* score decision-maker discovery against a golden set ([362c404](https://github.com/guillempuche/batuda/commit/362c4046e7de990dadaabb3b14ae5d9009e8aa8f))

### Bug Fixes

* **research:** drop form pop-ups from scraped page content ([d505c20](https://github.com/guillempuche/batuda/commit/d505c20ff648d77e6c003da30a424bedc5df10d8))
* **research:** make the LLM fallback accept our tool and output schemas ([195c166](https://github.com/guillempuche/batuda/commit/195c166c16fe033b834dc40141b7d4ef71d72bde))
* **research:** recover facts seen only in a search result ([d97f042](https://github.com/guillempuche/batuda/commit/d97f042a2f54f953cccf7e4d69f6b6f7171f7600))

### CI/CD

* **deploy:** turn FullEnrich on in production ([400400a](https://github.com/guillempuche/batuda/commit/400400a5c6cbefe5192df211d5c8d5fd41d03c20))

## 2026-07-12 (server-v2026.7.12)

### Bug Fixes

* read camelCase result keys in run reuse and provider quota ([ef6b51f](https://github.com/guillempuche/batuda/commit/ef6b51f0514dd74797024cdc50555ec7e0a558be))
* **research:** surface the provider error message in tool-failure logs ([c0b88bd](https://github.com/guillempuche/batuda/commit/c0b88bd854249282ad91dbea7954c0eeb8cbc9ef))
* stop the scrape cache from starving research into fabrication ([a445c33](https://github.com/guillempuche/batuda/commit/a445c33c7b9f4a27ca67d77a3f9e37e4b7ca6fd0))

## 2026-07-11 (server-v2026.7.11)

### Features

* add pipeline board and book-of-business views ([#225](https://github.com/guillempuche/batuda/issues/225)) ([efa50ad](https://github.com/guillempuche/batuda/commit/efa50ad2a61641fd4336cdae750b38a43fc01529))
* export eval run scores to the monitoring board as spans ([5925278](https://github.com/guillempuche/batuda/commit/59252786deca1325fe487879c11e0a8f3ebeabd6))
* gate research batch fan-outs behind a cost confirmation ([7675306](https://github.com/guillempuche/batuda/commit/767530600eb441a3357b8e354d6ca49bba369744))
* keep a research run alive when its language-model call stalls ([01286df](https://github.com/guillempuche/batuda/commit/01286df1dbab1a907df36b32db920e7a0e847e64)), closes [#235](https://github.com/guillempuche/batuda/issues/235)
* let a human mark a company as a verified lead ([ba42040](https://github.com/guillempuche/batuda/commit/ba42040d9bcb6d44a5adcba9b623378c2b3724ff))
* make the research review inbox filterable and readable ([11e3dfe](https://github.com/guillempuche/batuda/commit/11e3dfec26f8ef910b156e8240149fb393ad03ab))
* **research:** count an official-registry match toward eval grounding ([940ded3](https://github.com/guillempuche/batuda/commit/940ded3ad7a4d1b42a3627b20266232dc8041483))
* **research:** keep uncertain fields instead of dropping them ([d6bd64b](https://github.com/guillempuche/batuda/commit/d6bd64b96760314ced4d2745a029ed8257357d9b))

### Bug Fixes

* **research:** fetch the caller's domain up front so the run grounds ([3f28845](https://github.com/guillempuche/batuda/commit/3f28845815d5238feb9d08c0c5b04fd61ae0b1de))
* **research:** treat a refused-site scrape as a skip, not a run failure ([571b773](https://github.com/guillempuche/batuda/commit/571b773f08ee3481927f62523453bafc88b87c61))
* unbreak proposal creation and stamp its lifecycle dates ([dea55e2](https://github.com/guillempuche/batuda/commit/dea55e2fbb386f0f337088b5d45fe3eae90f02ee))

### Tests

* **server:** rule out the confirm-required result in the anchor-seed run ([3627dac](https://github.com/guillempuche/batuda/commit/3627dac6169192d945a87a0d37b8058e8d07a95c))

## 2026-07-10 (server-v2026.7.10-1)

### Features

* **controllers:** add the anchored re-run endpoint ([3f79160](https://github.com/guillempuche/batuda/commit/3f791607c52c108d053cfdc38f1b86b942fe5fe7))
* **domain:** add company classification vocabularies ([dcc709c](https://github.com/guillempuche/batuda/commit/dcc709cac76703731efe0f3f81a05e44c46aebca))
* **research:** confirm the right company and extract clean, measured fields ([cb1f8e9](https://github.com/guillempuche/batuda/commit/cb1f8e9c9e12dcae9eb1120a4e99174ae30749aa))
* **server:** persist failure reasons and extract with Qwen3-235B ([dde8478](https://github.com/guillempuche/batuda/commit/dde84787175953692f37c3d005c08a578e8d57c9))

## 2026-07-10 (server-v2026.7.10)

## 2026-07-09 (server-v2026.7.9-3)

## 2026-07-09 (server-v2026.7.9-2)

## 2026-07-09 (server-v2026.7.9-1)

## 2026-07-09 (server-v2026.7.9)

### Bug Fixes

* resolve blob uploads failing against Cloudflare R2 ([c6323f9](https://github.com/guillempuche/batuda/commit/c6323f95aea1453ea1919ddac9e4c2baa8f56516))

## 2026-07-08 (server-v2026.7.8-1)

### Bug Fixes

* **research:** fail closed when a run can't confirm the target company ([3523fd8](https://github.com/guillempuche/batuda/commit/3523fd8c1bc4d68fe572bcecd6fdfffa3f5fa13f))
* **research:** keep a rejected page extraction from failing the run ([02715c4](https://github.com/guillempuche/batuda/commit/02715c46a496a85486bf844cca658ca5cc768cb3))
* **research:** per-tool spend breakdown and honest empty-scan handling ([197d752](https://github.com/guillempuche/batuda/commit/197d752d415ce6dfa97e619aafb0765fc1290c15))
* **research:** strip page-builder markup from scraped pages ([3a34d99](https://github.com/guillempuche/batuda/commit/3a34d994c42df681ee129379505e36de2b564bd2))

## 2026-07-08 (server-v2026.7.8)

### Features

* make research runs honest about the company they researched ([01aaf6d](https://github.com/guillempuche/batuda/commit/01aaf6dcc0376ed3cd237c18fd3727d09c8dd547))

### Bug Fixes

* **research:** stop the company registry returning its raw provider payload ([673c54d](https://github.com/guillempuche/batuda/commit/673c54da7eb9348e87d5f76e39e09b46e0fc71d7))
* **research:** stop website noise from polluting enrichment output ([574411f](https://github.com/guillempuche/batuda/commit/574411fb341bef8af4fa58a295f4a5f7ea2e9a84))
* **server:** reject a research suggestion whose target row does not exist ([7684486](https://github.com/guillempuche/batuda/commit/76844862c7e2d6108d8def2df039dd59c180df90))

## 2026-07-07 (server-v2026.7.7-1)

### Bug Fixes

* **research:** normalize web_search location to a valid country code ([ee3a0f9](https://github.com/guillempuche/batuda/commit/ee3a0f99491ccb995df349c3d488766ce5b04ec8))
* **research:** rebuild cached LLM responses so tool results survive ([45f26e3](https://github.com/guillempuche/batuda/commit/45f26e39a0eca49fae9ca627abb3becbca958570))

## 2026-07-07 (server-v2026.7.7)

### Features

* add cross-run review inbox and type review endpoints ([bbf3a56](https://github.com/guillempuche/batuda/commit/bbf3a5663f99c6b68a173acb96633cef68d5d544))
* apply or reject many research proposals in one call ([1f3aeb2](https://github.com/guillempuche/batuda/commit/1f3aeb2cca8d291eccf3a63fb718029e9f2f3932))
* auto-apply high-confidence verified research findings ([99814b8](https://github.com/guillempuche/batuda/commit/99814b85c7d2158789e01059e408ff8b53acd791))
* execute an approved paid research follow-up safely ([bb86d93](https://github.com/guillempuche/batuda/commit/bb86d93684f139c700f6f37a34e3a7db2d14edf7))
* fan a selector run out across matching companies ([94be140](https://github.com/guillempuche/batuda/commit/94be140f6e369f12b7ed26d0bc73e2ff69c7e3ad))
* prune research storage on a schedule ([421fb24](https://github.com/guillempuche/batuda/commit/421fb24543f0f384ca6add2ec663680c47474ea5))
* record who applied a research suggestion to the CRM ([da1304e](https://github.com/guillempuche/batuda/commit/da1304e0c881d2121b7dff3ed249327596d78f11))
* **server:** trace applied research rows back to their sources ([a8c06fc](https://github.com/guillempuche/batuda/commit/a8c06fc63d618b3abc91ab1cb96043ea37896891))

### Bug Fixes

* **server:** store confidence scores and avoid duplicate contacts ([ca342a7](https://github.com/guillempuche/batuda/commit/ca342a7ad9791963ed985eb2cb3d7434b8509fb9))

## 2026-07-06 (server-v2026.7.6-1)

## 2026-07-06 (server-v2026.7.6)

### Features

* add Firecrawl web search and make it the primary provider ([cc9711c](https://github.com/guillempuche/batuda/commit/cc9711cfff59cba7f9b23eb75467ee9ed6dffabd))
* create newly discovered contacts in the CRM under the run budget ([72f223d](https://github.com/guillempuche/batuda/commit/72f223d2e6c36ea7f61680c80d8083c27198143a))
* ground research findings in a reflect loop, refusing fabrication ([c0a9cf5](https://github.com/guillempuche/batuda/commit/c0a9cf5c04ac372e2af397e33b513aa8866fb37d))

### Bug Fixes

* stop invented contact details from surviving in research findings ([c52a60b](https://github.com/guillempuche/batuda/commit/c52a60b81c65f32db43409eb79e63759c0aede2f))

### CI/CD

* mark migration 0022 status widening as a clean break ([c528455](https://github.com/guillempuche/batuda/commit/c528455707a9d1e99416365b6adab6c7052c1e16))

## 2026-07-05 (server-v2026.7.5)

### Features

* apply research proposed-updates to the CRM row ([99de720](https://github.com/guillempuche/batuda/commit/99de7207df952abfbcfa2b71c2b9ad51f75998a6))
* research companies in any country, not just Spain and the UK ([de9fdd6](https://github.com/guillempuche/batuda/commit/de9fdd66081354f7e83a4943822739f71c0cc823))
* **server:** add bounding-box company search and location re-geocode ([259137b](https://github.com/guillempuche/batuda/commit/259137b7ff2b4fd8d1688a72c8ccf91cb08de10c))
* **server:** store company coordinates after enrichment succeeds ([a0191f0](https://github.com/guillempuche/batuda/commit/a0191f02859dae73b4b31b418e86ac2a18f9458b))

### Bug Fixes

* **research:** coerce model "NaN" numbers to null in extraction schemas ([4c3d43a](https://github.com/guillempuche/batuda/commit/4c3d43ae0c9fa48d1344006f0da7a4338dd52ca0))
* **research:** surface the real error instead of a wrapper crash ([4fe8de9](https://github.com/guillempuche/batuda/commit/4fe8de9c31052d89980d13ea7d87399d40c3cf09))
* **research:** tolerate plain text where extraction expects JSON ([eab94e2](https://github.com/guillempuche/batuda/commit/eab94e28cbcb2db357028bb92c62b7b5ccd169e0))
* **server:** keep MCP tool results valid and hide internal errors ([52125b9](https://github.com/guillempuche/batuda/commit/52125b910dfbc48273ef9b3de96c5938a691efcd))
* **server:** return an object when reading policy or listing templates ([71b2f4a](https://github.com/guillempuche/batuda/commit/71b2f4ad375fb94cd3aa12f43cac68172369715f))
* stop company enrichment asking the model for coordinates ([a2713e9](https://github.com/guillempuche/batuda/commit/a2713e9ffc333dab9471561df021f936de91cf18))

## 2026-07-04 (server-v2026.7.4)

### Features

* reclaim interrupted research runs via a run heartbeat ([0e37736](https://github.com/guillempuche/batuda/commit/0e37736a5d7d6cc0598902430deb48d728c99bfd))

### Bug Fixes

* record paid research spend with per-org idempotency key ([56d2695](https://github.com/guillempuche/batuda/commit/56d2695640df791bd96449843b7c04e5201e0619))
* **research:** accept model-emitted null for optional tool params ([e05a43d](https://github.com/guillempuche/batuda/commit/e05a43d9f842fa2dee176e6c55892d014583443f))
* **research:** read run-row fields under the camelCase transform ([85d24b1](https://github.com/guillempuche/batuda/commit/85d24b1152b55e79602c0147061340c2fed7f872))
* run research jobs from a background queue, not the web request ([c94bc20](https://github.com/guillempuche/batuda/commit/c94bc2093a7ab55c58da5e2f6206ad88e387f17a))

## 2026-07-03 (server-v2026.7.3)

### Bug Fixes

* **research:** tolerate null service_tier in LLM provider responses ([248aa3c](https://github.com/guillempuche/batuda/commit/248aa3cc18ff674342214a616ccac9af11360973))

## 2026-07-02 (server-v2026.7.2)

### Bug Fixes

* **research:** unblock research runs on OpenAI structured output ([1ab6c95](https://github.com/guillempuche/batuda/commit/1ab6c9599e7f36fd882d83be2a0b19ac9db0f1c1))
* **server:** return 404 for an unknown MCP session so clients recover ([d1c9fba](https://github.com/guillempuche/batuda/commit/d1c9fba137d12e10048ecc6ad3c0c06bc2167bb3))

### Refactoring

* **research:** share duplicated research output schema fragments ([76507a4](https://github.com/guillempuche/batuda/commit/76507a487727d495aab756e2b27de144a2805027))

## 2026-07-01 (server-v2026.7.1)

### Features

* **instructions:** resolve per-run override by name or id ([7d9ef78](https://github.com/guillempuche/batuda/commit/7d9ef7807b7bf77088c58c39bb246575e0717c45))
* **internal:** add per-surface selector for instruction default stacks ([d219df0](https://github.com/guillempuche/batuda/commit/d219df00fa05a30e42e9d0949777e1ad18c538d7))
* **observability:** add shared OTLP package for both processes ([953458e](https://github.com/guillempuche/batuda/commit/953458e3f8f9e2f800450d057c2784f3b17bbcce))
* **server:** make instruction templates usable from MCP chat ([5adb6b1](https://github.com/guillempuche/batuda/commit/5adb6b1eec2355353b46e3553229097ac4c3d935))
* **server:** route every unhandled error to Honeycomb ([d1cead7](https://github.com/guillempuche/batuda/commit/d1cead727344bd86cec5b187dfb7602bc94b0320))

### Bug Fixes

* **server:** point Infomaniak preset at the Mail device-password guide ([907c837](https://github.com/guillempuche/batuda/commit/907c8378749a84083ecfe5d5a1c16926bb142984))
* **server:** wrap MCP list-tool output in an object envelope ([82e7b37](https://github.com/guillempuche/batuda/commit/82e7b37c546f9f9838fec100e571167093a3773e))

### CI/CD

* enable Honeycomb OTLP export in production ([6abe971](https://github.com/guillempuche/batuda/commit/6abe971227d664cedd80d3e02ceb8e5894107535)), closes [#153](https://github.com/guillempuche/batuda/issues/153)

## 2026-06-29 (server-v2026.6.29)

### Features

* **domain:** add the contact_channels model ([75b5560](https://github.com/guillempuche/batuda/commit/75b55604e58cddb92343793572d6a0bf4ba2acfd))
* migrate contacts to a channels-only model ([f9bb030](https://github.com/guillempuche/batuda/commit/f9bb0301694095f5d0769a5d18baba91f89f19d6))
* **research:** add UK Companies House registry + registry-first discovery ([ee9c017](https://github.com/guillempuche/batuda/commit/ee9c01774bea2d508b3ff9a6e9804ad7ffa349e7))
* **research:** discover verified decision-maker contacts ([fe20e4b](https://github.com/guillempuche/batuda/commit/fe20e4ba3b2a42415086fd732cd203ac28a0e355))
* **server:** add soft, agent-only send guardrails ([a4fbd2f](https://github.com/guillempuche/batuda/commit/a4fbd2f5697551c87e88a9e59722fcb5e50fb966))
* **server:** expose discover_contacts MCP tool ([6fa6635](https://github.com/guillempuche/batuda/commit/6fa6635811b5ab5e20750c42a9725e6341c3796b))
* **server:** persist contact channels alongside the canonical email ([0856a36](https://github.com/guillempuche/batuda/commit/0856a3628adbbe93c7844c1bdc67d24bbf35b36d))

### Bug Fixes

* route inbound email matching through contact channels ([7474a68](https://github.com/guillempuche/batuda/commit/7474a680814b8a6099333122f40133f063a8617d))

### CI/CD

* enable Hunter enrichment + Companies House registry in production ([add502e](https://github.com/guillempuche/batuda/commit/add502ed1d0c64ed5e0266ff6555100b27383018))
* gate integration tests against a migrated disposable DB ([9c6ce46](https://github.com/guillempuche/batuda/commit/9c6ce4621c1c413e435301b887486958cab89fb4))

## 2026-06-28 (server-v2026.6.28)

### Features

* load non-secret config from a baked file at boot ([c7939c6](https://github.com/guillempuche/batuda/commit/c7939c6ba958cf76b3df3d039c3905dea6ffedf0))
* require explicit research, email, and geocoder config ([fc8b40d](https://github.com/guillempuche/batuda/commit/fc8b40d651861d8be01bfdb3cc7f2843e3ebac28))
* **server:** log and refuse a pooled migration target ([f4bbd53](https://github.com/guillempuche/batuda/commit/f4bbd53e1bae669ff210546ac84cdaf7ed4c9bea))

## 2026-06-26 (server-v2026.6.26-1)

### Bug Fixes

* **server:** add defaults for research/env vars and trim KraftCloud cmdline ([2e19c87](https://github.com/guillempuche/batuda/commit/2e19c87b1f1bfc2467298417accb22e9381572bb))

## 2026-06-26 (server-v2026.6.26)

### Features

* expose lookup_registry as a standalone MCP tool ([e8518e9](https://github.com/guillempuche/batuda/commit/e8518e9398f9329346694e03e660a6564abc3a0d))
* **research:** add Firecrawl scrape and extract providers ([0a7c543](https://github.com/guillempuche/batuda/commit/0a7c5431b6c788b56c80739892948b1f81c662da))
* **research:** add LibreBOR registry adapter ([244d590](https://github.com/guillempuche/batuda/commit/244d5904d881b888d67c6d66008864d6d02e93b4))
* **research:** attribute scraped pages to the run ([4ee0976](https://github.com/guillempuche/batuda/commit/4ee0976fd99ec80d9bde3cd2fb544bd82468b9c2))
* **research:** map location and sector onto the registry record ([cd85ddc](https://github.com/guillempuche/batuda/commit/cd85ddc264eca7272604458803dec1e20bd7e328))
* **server:** support multiple orgs per MCP OAuth connection ([bf0c957](https://github.com/guillempuche/batuda/commit/bf0c957d1e46a29e00d08ea805ea0ac9f56767ac))

### Bug Fixes

* **server:** trust portless's assigned port in dev origins ([855db11](https://github.com/guillempuche/batuda/commit/855db1178d95173f60bdc04ffffa797ac456b338))

### Refactoring

* remove starter instruction presets and source_preset_id column ([389bdaf](https://github.com/guillempuche/batuda/commit/389bdaf7591c03b78fc0d3b4403bdec36d2d3f19))
* **server:** drop the redundant ALLOWED_ORIGINS wildcard ([113496e](https://github.com/guillempuche/batuda/commit/113496e19ec1d66188c9d525ccd430387cb10b3d))

### Tests

* **research:** cover the Firecrawl adapters and HTTP hardener ([02b04c9](https://github.com/guillempuche/batuda/commit/02b04c93cea7fada9a8f726c0769e876249035ae))

## 2026-06-18 (server-v2026.6.18)

### Features

* **ui:** add fluid prose typescale for long-form reading ([4b089fe](https://github.com/guillempuche/batuda/commit/4b089fe186e3700d1f0b8f73c89f5da05312b3b7))

### Bug Fixes

* **server:** emit object-typed inputSchema for no-arg MCP tools ([fcd41db](https://github.com/guillempuche/batuda/commit/fcd41db95219cecd412c82d74e723969ac6710b4))
* **server:** skip the Sent APPEND when the mailbox is absent ([e9a722d](https://github.com/guillempuche/batuda/commit/e9a722dcc451238cf229cb32d950519f132e6113))

### CI/CD

* **release:** ui v2026.6.18 ([f8992d8](https://github.com/guillempuche/batuda/commit/f8992d843f1c08e94e503b8900c221039e13a63a))

## 2026-06-15 (server-v2026.6.15-1)

### CI/CD

* **deploy:** keep lefthook disabled across prepare-script changes ([55433e7](https://github.com/guillempuche/batuda/commit/55433e7d207ba3d4f764b8499eef9c800bb9cc14))

## 2026-06-15 (server-v2026.6.15)

### Features

* confine API keys to the MCP path ([f1110d6](https://github.com/guillempuche/batuda/commit/f1110d6aadfc423480d90f1cc4dda680b72d9d90))
* **server:** derive a worktree's auth + app origins from PORTLESS_URL ([0d2845f](https://github.com/guillempuche/batuda/commit/0d2845f719ce07f888147e0980cfbcaff2ed1fe4))
* support app-specific passwords for 2FA mailboxes ([cfb7237](https://github.com/guillempuche/batuda/commit/cfb7237d6b27d96d349246016f737b33cbc0aed9))
* **ui:** adopt Utopia geometric ladder for fluid space tokens ([bdbfaa5](https://github.com/guillempuche/batuda/commit/bdbfaa5f76ef639896b47135e48f66109ab680b3))

### Bug Fixes

* meet WCAG AA contrast and add ARIA to the mailbox connect form ([1326007](https://github.com/guillempuche/batuda/commit/1326007c3d3178d882dde6c4dd6d29d8b2896771)), closes [#b05220](https://github.com/guillempuche/batuda/issues/b05220) [#95400f](https://github.com/guillempuche/batuda/issues/95400f)
* **ui:** add exports to publishConfig for npm distribution ([3c5cedb](https://github.com/guillempuche/batuda/commit/3c5cedb2b3d1564b549acaac8b17b6f9d51d6e37))
* **ui:** match select popup width to its trigger ([839ae9b](https://github.com/guillempuche/batuda/commit/839ae9b803cdb896ce5d2ad896e75dbabd0d66d5))

### Documentation

* **ui:** remove broken issue links from the v2026.6.14 changelog ([bfb0584](https://github.com/guillempuche/batuda/commit/bfb0584f06ffbf6f3e61cb15e8f6d4bd7ac7d16e))

### CI/CD

* **release:** ui v2026.6.14 ([ac6b83d](https://github.com/guillempuche/batuda/commit/ac6b83dd4f18e4b177adfef69a05f79d92bf5262))
* **release:** ui v2026.6.14-1 ([7918100](https://github.com/guillempuche/batuda/commit/7918100c016129cf171d61d0e1587c39c2947f7b))

## 2026-06-10 (server-v2026.6.10)

### Features

* add instruction-template management API over HTTP and MCP ([08f1a50](https://github.com/guillempuche/batuda/commit/08f1a5059d8e93dbcaf4d3732ff381d3bd1348cc))
* expose instruction transfer and donation lifecycle over MCP ([e92ef2b](https://github.com/guillempuche/batuda/commit/e92ef2bb427c238d7e8784db889809e67fd9caab))
* **instructions:** add instruction-templates library and resolver ([8dffdc5](https://github.com/guillempuche/batuda/commit/8dffdc5486944eea7684685410e11abc548b30cb))
* **instructions:** add template management and donations schema ([3a48cb0](https://github.com/guillempuche/batuda/commit/3a48cb06dd08a260ca4fd57872342cfaaa4a6837))
* **instructions:** let a user default stack extend the org default ([e7e10a0](https://github.com/guillempuche/batuda/commit/e7e10a043447c6616e85223c6a57238d77474b92))
* **instructions:** set and read stack composition via the API and MCP ([df1ae5e](https://github.com/guillempuche/batuda/commit/df1ae5e43e7bcfd43350e53d9a81dda43940c5e6))
* org-isolate the research cache and thread instruction templates ([fa6c6ef](https://github.com/guillempuche/batuda/commit/fa6c6eff56db43aac6da49ad57967e75212e3d92))
* record which instruction templates shaped each research run ([d86e9b8](https://github.com/guillempuche/batuda/commit/d86e9b89a3c040d41edbabbea5276aa4c79ff8f4))
* **server:** add instruction-templates schema and RLS ([fda5f92](https://github.com/guillempuche/batuda/commit/fda5f921568d2a3245d91a87bd96da5d5935db1c))
* **server:** resolve research instructions and switch the MCP actor ([39a7c79](https://github.com/guillempuche/batuda/commit/39a7c7920d09b319ba97f22c4eba338cbd28b5ad))

### Bug Fixes

* **instructions:** read camelCase result keys in the resolver ([e946079](https://github.com/guillempuche/batuda/commit/e946079598bbe3d0742c8ee711f6e91bd9d6d804))

### Refactoring

* extract the research system-prompt builder ([14e813a](https://github.com/guillempuche/batuda/commit/14e813aca146c704d16fcaf5c4979fa681acb17d))

## 2026-06-02 (server-v2026.6.2)

### Bug Fixes

* harden research MCP input validation and lifecycle guards ([03a952d](https://github.com/guillempuche/batuda/commit/03a952d20c60f61a3aae44ba50d93fd1a0541d65))

## 2026-06-01 (server-v2026.6.1-1)

### Bug Fixes

* **server:** open DCR to unauthenticated MCP clients ([295097d](https://github.com/guillempuche/batuda/commit/295097d3d84f0d9e4f910222a6ca79014ad284e1))

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

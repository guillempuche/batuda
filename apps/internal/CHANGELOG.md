# Changelog

All notable changes to this project will be documented in this file.


## 2026-08-18 (internal-v2026.8.18)

### Bug Fixes

* **research:** read an "and" between two trades by where it sits ([3ad852a](https://github.com/guillempuche/batuda/commit/3ad852a357116bd56b3bbb16effb60caff0e6f81)), closes [#490](https://github.com/guillempuche/batuda/issues/490)
* **research:** stop a search dropping a company for sharing an address ([79b10fc](https://github.com/guillempuche/batuda/commit/79b10fc5eb136763035ccf4da513df05b24af41c)), closes [#483](https://github.com/guillempuche/batuda/issues/483)
* stop telemetry double-counting, hiding refusals, and going missing ([b91eabb](https://github.com/guillempuche/batuda/commit/b91eabbbb86edf645c54c5f2fdc60fa42ad6c59c))

## 2026-08-17 (internal-v2026.8.17)

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

## 2026-08-14 (internal-v2026.8.14)

### Bug Fixes

* make a finished research run describe itself accurately ([7c740fb](https://github.com/guillempuche/batuda/commit/7c740fba6bc163a40cc20c6674d4dccde30658a1))
* make a research scan's list one usable row per company ([35f2865](https://github.com/guillempuche/batuda/commit/35f2865661976157c648dcac2395cbf197f423db)), closes [#459](https://github.com/guillempuche/batuda/issues/459)
* **research:** stop grading a run on a profile it was never asked to fill ([39ff15e](https://github.com/guillempuche/batuda/commit/39ff15e18d2c9fb561ad78ecf6f7b242fa8ed5f8))

### Tests

* **internal:** hold the company specs to the page as it is today ([ae75634](https://github.com/guillempuche/batuda/commit/ae756343329a77ba767ba363627438a8529204a7))
* **research:** say what the quality tests check, not what they used to catch ([bc75594](https://github.com/guillempuche/batuda/commit/bc755946713d05f9292f7369cd0794fccefa144e))

## 2026-08-13 (internal-v2026.8.13)

### Features

* let a company's own mailbox be unblocked ([8365eec](https://github.com/guillempuche/batuda/commit/8365eec753913dfd1c25c3a8fc3681dc71420b8f))

### Bug Fixes

* **internal:** put the reason where the address is ([ad6c210](https://github.com/guillempuche/batuda/commit/ad6c210734d9b0e1d53e66aaae33627ef797bc45))
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

### Refactoring

* **research:** read a value and its page in one place ([75c832e](https://github.com/guillempuche/batuda/commit/75c832e6fcc7b8976bc8f03e5d86fb6f43eeb679)), closes [#435](https://github.com/guillempuche/batuda/issues/435)

## 2026-08-10 (internal-v2026.8.10)

### Features

* **internal:** warn about a blocked address the screen could not see ([b6a785f](https://github.com/guillempuche/batuda/commit/b6a785f886c1235941974466a87ce3285ebf1306))
* let a verdict be taken back off an address, not only lowered ([519e309](https://github.com/guillempuche/batuda/commit/519e30916140d24eaa5521c728d39e56be601ee2))
* say an address is already on file instead of quietly renaming it ([350b689](https://github.com/guillempuche/batuda/commit/350b689e5f560e3bbc6aa426d96c79618939d010))

### Bug Fixes

* ask one question about a blocked address, in one place ([32be485](https://github.com/guillempuche/batuda/commit/32be485c1e6c27a22d8185d44523c8a49f1ddf48))
* keep research to its own organization and make its gates real ([ab2db3c](https://github.com/guillempuche/batuda/commit/ab2db3cef62a457e63fc96024d3df8a78f001c33)), closes [#377](https://github.com/guillempuche/batuda/issues/377)
* **server:** keep a kind's default held, and store a kind one way ([9c59199](https://github.com/guillempuche/batuda/commit/9c591994fb4e29aedf1b80b9d07df98178d8c51e))

## 2026-08-08 (internal-v2026.8.8)

### Features

* **internal:** correct a contact's address from the web app ([f828289](https://github.com/guillempuche/batuda/commit/f828289ccedc5a06fe803e7d9f18ea33816a08fa))
* let a company be deleted, and check who work is handed to ([86688c1](https://github.com/guillempuche/batuda/commit/86688c17af1aeb08f92aa6d01b98d3eb43827df2))
* let a wrong address on a contact be corrected or removed ([7499f7c](https://github.com/guillempuche/batuda/commit/7499f7c698317ee89d435ca1c03cf4ad68e5735a))

### Bug Fixes

* **research:** say when a contact search was cut short by a vendor ([d04c6e8](https://github.com/guillempuche/batuda/commit/d04c6e8a0a2c3d169c56dea7697e1a2e8624513a))
* **research:** stop a contact search spending past what it quoted ([29e3fb3](https://github.com/guillempuche/batuda/commit/29e3fb35f2e87c139d7eef0f563546bb8d4d0b30))
* **research:** stop a run with no surviving citations reading as clean ([bee79e5](https://github.com/guillempuche/batuda/commit/bee79e5285867e7ca5868123d4c48e7efdc1bbb5))

### Refactoring

* keep the email-check verdicts and channel kinds in one place ([e5d31c2](https://github.com/guillempuche/batuda/commit/e5d31c25554edacc34362313eaef0e70e74c789a))

### CI/CD

* **release:** ui v2026.8.7 ([137771c](https://github.com/guillempuche/batuda/commit/137771c4e93163e322df2a5aa9a4f6c249565a2d))

## 2026-08-07 (internal-v2026.8.7)

### Features

* make the companies pages fit a phone and lead with the notes ([fd8f64c](https://github.com/guillempuche/batuda/commit/fd8f64c9c25405620b3a31ece165e12e3e75ee72))
* make the pipeline page a work queue rather than a noticeboard ([be21c14](https://github.com/guillempuche/batuda/commit/be21c147f605e1d5ea99fe7daa391ec26ab46847))

### Bug Fixes

* **research:** keep vendor API keys out of our tracing data ([2a940d3](https://github.com/guillempuche/batuda/commit/2a940d3f4d53dcc662a0c3326017d6a9a2b4cd57))

## 2026-08-04 (internal-v2026.8.4)

### Features

* let anyone rewrite a company's account brief ([0040a0d](https://github.com/guillempuche/batuda/commit/0040a0df18607501c4e057b0c2b667c0ff65a6ff))

### CI/CD

* **release:** ui v2026.8.3 ([84c0ba3](https://github.com/guillempuche/batuda/commit/84c0ba32eb115c8cc11dc43b221e3bd421c21f5a))

## 2026-08-03 (internal-v2026.8.3)

### Features

* a company is more than one mailbox, one place, and one decider ([247bf91](https://github.com/guillempuche/batuda/commit/247bf915739c8be4574fea8a187251ab7ea975a6)), closes [#376](https://github.com/guillempuche/batuda/issues/376)
* carry an address name and a person's branch through the API ([ee93ba0](https://github.com/guillempuche/batuda/commit/ee93ba046366222c755258ddc3f8f79fd367b426))
* describe mailboxes freely and decide access from who owns them ([a626db1](https://github.com/guillempuche/batuda/commit/a626db1b98848b30d5ca898ba27b4f2158ea9bde)), closes [#375](https://github.com/guillempuche/batuda/issues/375)
* **internal:** show every way of reaching a company, each named ([d27999a](https://github.com/guillempuche/batuda/commit/d27999a9ab5769844e95734c7c0d83a1abd1b232))
* keep the contact details and people a research run finds ([8eff397](https://github.com/guillempuche/batuda/commit/8eff397812861fcec30ec459514d222fa0261dd9))
* let each organisation name the trades it sells to ([fd9c998](https://github.com/guillempuche/batuda/commit/fd9c9982e9eef1db581ec8c77fccdbd156cf0340))
* let every member manage the shared instruction templates ([e3e692a](https://github.com/guillempuche/batuda/commit/e3e692a123747b0fe11566dbf9bec5aaacae6864))
* store the number a company is registered under ([d0dd2c5](https://github.com/guillempuche/batuda/commit/d0dd2c50629ec6c2ccfc7d71e127ad5086c58f22))

### Bug Fixes

* **internal:** let a screen reader and keyboard follow the thread list ([6e36437](https://github.com/guillempuche/batuda/commit/6e3643753e6cbe656b0862bcbf1070a0f9568cee))
* **internal:** say which address is which to a reader who hears the page ([1db4f90](https://github.com/guillempuche/batuda/commit/1db4f907fa38a48579d9a79ebc034dab1aaf2fed))
* **internal:** show the whole page of mail instead of a few rows ([e3f0e53](https://github.com/guillempuche/batuda/commit/e3f0e53bef64b3cccea2ae2243c4f8c005f8db1d))
* keep the template dialog usable by keyboard and screen reader ([7356841](https://github.com/guillempuche/batuda/commit/735684190611848eb1de14828ed8f6ef0b1d3e31))
* **ui:** turn only the leading arrow when a section opens ([575ada2](https://github.com/guillempuche/batuda/commit/575ada2a86b84a89d9f4aaad58ca64dbc28db585))

### Refactoring

* remove what the trades change left behind ([263d903](https://github.com/guillempuche/batuda/commit/263d90396fa30e9b89da931666ce6cb0cf348ca0))
* stop keeping a second list of who a product is for ([4c2d5ea](https://github.com/guillempuche/batuda/commit/4c2d5ea12103b77b00bc5fe3bf7d2341bb49a7c7))

### Tests

* **research:** measure the company shapes this issue is about ([030c5b3](https://github.com/guillempuche/batuda/commit/030c5b31911bdf124d3f694bf69cce5e9ed67e00))
* stop the mail tests reading and waiting on the wrong things ([9ed6517](https://github.com/guillempuche/batuda/commit/9ed651777ff23c6c922911b4708148beb5e0a047))

### CI/CD

* **release:** ui v2026.7.28 ([acb53ba](https://github.com/guillempuche/batuda/commit/acb53ba19db2f26498659d1979f20b9f1dad953e))

### Chores

* raise Effect to beta.102 and fix what the raise uncovered ([72da41c](https://github.com/guillempuche/batuda/commit/72da41cf0d4e69a002cf740a1f8f96cbbe5a80c9))
* say the mailbox rules once instead of three times ([a9cff18](https://github.com/guillempuche/batuda/commit/a9cff18ad9635b0073dfe06a7151d81c207b794c))

## 2026-07-28 (internal-v2026.7.28)

### Features

* bound every list request and count only when asked ([c9f96f1](https://github.com/guillempuche/batuda/commit/c9f96f19406f26624ee325ecfa11cc6ed4db7df5))
* count the rounds a research run has got through ([5ccc984](https://github.com/guillempuche/batuda/commit/5ccc984259e6ab0e19390d51b48bf29b0fef6e6a))
* **internal:** let a run's review keep loading past a hundred changes ([a461044](https://github.com/guillempuche/batuda/commit/a4610440bf4eaf6fc480561d1a730f30e18b1af4))
* **internal:** let the rest of the lists keep loading as you scroll ([e4c12af](https://github.com/guillempuche/batuda/commit/e4c12af57fec97c8b28bce7794e402d2565dcd5a))
* let a member choose which organizations an assistant works in ([39660e6](https://github.com/guillempuche/batuda/commit/39660e68c1347bdcea8beb0f9565412a3a8f6838))
* let an organization allow back an assistant it stopped ([37d2b03](https://github.com/guillempuche/batuda/commit/37d2b03af2399690aeb8110323562d859e7a2530))
* **mcp:** tell the assistant when a list was cut short ([cd6d84d](https://github.com/guillempuche/batuda/commit/cd6d84dde067bb4617277fd9f8475c6756c7df0c))
* **research:** find a company's own site, and see whether the profile came back full ([be609dc](https://github.com/guillempuche/batuda/commit/be609dc39eff74f6573084ea08a495a46d2e647e)), closes [#328](https://github.com/guillempuche/batuda/issues/328)
* surface finished research in the daily plan ([aa6d9be](https://github.com/guillempuche/batuda/commit/aa6d9beabba181098c7e6e3a7c1bb3aa9e8550cb))

### Bug Fixes

* carry the request to be counted all the way through ([790213a](https://github.com/guillempuche/batuda/commit/790213a6af1ec1d167b5212af2381d2ad526cecb))
* **internal:** count what exists, not what a screen happened to fetch ([3c29c0c](https://github.com/guillempuche/batuda/commit/3c29c0cbe97b6bcdc5cbcd06247814f95b77badb))
* **internal:** keep keyboard and screen reader with a growing list ([0efef6a](https://github.com/guillempuche/batuda/commit/0efef6a6ff45bb9ba2c76bbbaf5836ccdc4ec6d8))
* **internal:** name the person behind each row of spend ([6767e7a](https://github.com/guillempuche/batuda/commit/6767e7ac30f29e236e77b3328be82c2758ddc4c7))
* **internal:** stop two screens handing each other their place in a list ([5592eb4](https://github.com/guillempuche/batuda/commit/5592eb4d26eb772a809f4394a81d3a4d0ab4e48d))
* key every poller off the one list of finished statuses ([b8369ec](https://github.com/guillempuche/batuda/commit/b8369ec5c938287d088f1b73ea1daf08ef0ecb68))
* let the browser find text inside a folded section ([c521122](https://github.com/guillempuche/batuda/commit/c5211227487b6f6e442ffd195e2f2a6a368a5872))
* **mcp:** tell the agent which of its lists were cut short ([64eab00](https://github.com/guillempuche/batuda/commit/64eab004246f6d521f0da81b5400a57c98400558))

### Refactoring

* **internal:** read each page of a list once instead of re-reading it ([1d1656f](https://github.com/guillempuche/batuda/commit/1d1656fdbc50f64df2158bd0a447874c6fdad716))

### Documentation

* describe how a client follows a running research run ([398d225](https://github.com/guillempuche/batuda/commit/398d225fe3cd939a5c0fb0514067579c78619cb2))

### Tests

* stop two browser tests failing on state they do not own ([d7025bf](https://github.com/guillempuche/batuda/commit/d7025bf8267f570f49ee77565e06cbe39a6bf8be))

### CI/CD

* **release:** ui v2026.7.27 ([7dd5da6](https://github.com/guillempuche/batuda/commit/7dd5da62db960b640deb41b4daf3c79305f71e6d))

### Chores

* rebuild local test data before the browser suite runs ([ada2db9](https://github.com/guillempuche/batuda/commit/ada2db926ee8d46ed75943a7323753b785a88244))

## 2026-07-27 (internal-v2026.7.27)

### Features

* **calendar:** keep what an invitation says about days and attendees ([c2acac7](https://github.com/guillempuche/batuda/commit/c2acac7d96f5d0b0cdd95e893f44f3ae95a8676b))
* **cli:** report cost, credits and tokens in the research eval ([6e58cda](https://github.com/guillempuche/batuda/commit/6e58cdaf1c14fcbc1031c4567cb95ceb7bb92ccb))
* **internal:** give documents a home, a page, and a place on every record ([1b62cc0](https://github.com/guillempuche/batuda/commit/1b62cc091731dd3b59d7c10f0bcbaf3d3e1d97e6))
* **internal:** let anyone read an instruction template ([b611222](https://github.com/guillempuche/batuda/commit/b61122291bbf7aa9cb23bb582cf3d66fe89ccee0))
* **internal:** load lists as you scroll without losing your place ([0e3bf4e](https://github.com/guillempuche/batuda/commit/0e3bf4e160873496aca33ef6f6c2709d403d140c))
* **internal:** show the company facts already on file ([8c926ba](https://github.com/guillempuche/batuda/commit/8c926bad435801aaa3d53b93377a12841c0e1156))
* **internal:** show what each change would write, and what is waiting to be paid for ([76e39b4](https://github.com/guillempuche/batuda/commit/76e39b41d7cd0475a158e859c8088b1311ed6634))
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
* **db:** read stored json by the names it was stored with ([c9f2d7a](https://github.com/guillempuche/batuda/commit/c9f2d7ae80b95e5df00a8fd0af499d4b4e00ad9b))
* **internal:** count every open task, not just the first page ([96c3bd5](https://github.com/guillempuche/batuda/commit/96c3bd55c9b0e6529116a905c986f1238d4ae30b))
* **internal:** keep the Catalan wording for the before-and-after values ([5fffaac](https://github.com/guillempuche/batuda/commit/5fffaac70b4605767d1a65b6329add49c64d9883))
* **internal:** keep the keyboard where the reader is, and name fields properly ([a8a7bd9](https://github.com/guillempuche/batuda/commit/a8a7bd9120ef0bea3edb6f6933dc5eddc6444a14))
* **internal:** keep the task inbox in place while a shelf loads ([021a518](https://github.com/guillempuche/batuda/commit/021a5181ccbe5273bfbbe1f028b7b81636f52d7f))
* **internal:** label the companies KPI for what it counts ([e01050b](https://github.com/guillempuche/batuda/commit/e01050b3579c3453548cc5c8261c016634e774cd))
* **internal:** reach a template's guidance from wherever you need it ([c758135](https://github.com/guillempuche/batuda/commit/c75813568e10da856aa57cd3922d6a13e4829b8c))
* **internal:** read research findings by their stored names ([3be10aa](https://github.com/guillempuche/batuda/commit/3be10aa2e951a30d4a576c5aa4fb2792b95ea180))
* **internal:** read the review queue out loud and count things properly ([6ca96ef](https://github.com/guillempuche/batuda/commit/6ca96efd6c89cff27ee7c76b325faeaccc3aa7c2))
* **internal:** refill the Catalan wording after rebasing onto the new stored names ([ca376b4](https://github.com/guillempuche/batuda/commit/ca376b40047977e4a747c4122c305965bc6f1155))
* **internal:** say how a bulk apply went, and split three counts apart ([97968f9](https://github.com/guillempuche/batuda/commit/97968f957fa3a34d6999cc20d9c9376c498f709a))
* **internal:** say when a meeting runs, and on whose clock ([336f348](https://github.com/guillempuche/batuda/commit/336f3488ffd943ee667a25d390dec97214f513d6))
* **internal:** show dates and stages in the reader's own language ([751de62](https://github.com/guillempuche/batuda/commit/751de62ca212dc560a62c66581a3b2024b9b8812))
* **internal:** stop a contact's findings from taking down the run page ([f1859af](https://github.com/guillempuche/batuda/commit/f1859af61714db2aad0b5cfcf5c40b9c248082b8))
* **internal:** stop repeating a run's progress and say when it has finished ([c27f366](https://github.com/guillempuche/batuda/commit/c27f366aeb75bd07d6628aa555b4b36407abb531))
* **internal:** stop the company page understating what it knows ([0078acf](https://github.com/guillempuche/batuda/commit/0078acffa4e955c47f9fa0010a2b1d00d3feb17b))
* **internal:** stop the research screens reporting work they did not do ([dbc0a25](https://github.com/guillempuche/batuda/commit/dbc0a25aa7f69faf8f1be295a4f559b659843c5e))
* keep hand-logged touchpoints in the company history ([d8a653c](https://github.com/guillempuche/batuda/commit/d8a653cdedd0bec0cc31e436e1de4837e6b94589))
* name each history row for what it is and show agents the attendees ([c82f723](https://github.com/guillempuche/batuda/commit/c82f723dad38b2f1fff49fab90d4ea32e5c795dc))
* **research:** approve a paid request once, and say when the money runs out ([19e511e](https://github.com/guillempuche/batuda/commit/19e511eeafffdd2738203b9fa7506bc65125ac4c))
* **research:** count every call a run is billed for ([40c9b0e](https://github.com/guillempuche/batuda/commit/40c9b0ee0b983e7397d4a29657f2a776894fdf3d))
* **research:** never buy the same registry lookup twice ([5328d99](https://github.com/guillempuche/batuda/commit/5328d99e1be7af12f61db6a1351f0ac495cc181f))
* **research:** quote what a batch of research would really cost ([5367cc1](https://github.com/guillempuche/batuda/commit/5367cc1d29c2522d41dd0334d59398d2daa88f80))
* **research:** save the spending limits instead of dropping them ([008c8c3](https://github.com/guillempuche/batuda/commit/008c8c3c958d8ae33e58c10057a90bbd21379477))
* save calendar invitations and show who is attending ([6ad893d](https://github.com/guillempuche/batuda/commit/6ad893dc5bcb5cbb6e979291f299f91ac5266e60))
* **server:** stop a half-specified shelf from unhiding hidden work ([9dcb658](https://github.com/guillempuche/batuda/commit/9dcb658d05642c80e09ae28c56ff5903a4349d87))
* **ui:** make the keyboard focus mark visible, and name what it lands on ([6091b54](https://github.com/guillempuche/batuda/commit/6091b540d2dbc726b11cbaa00146f7489445dd5b))

### Refactoring

* **internal:** delete atoms nothing reads ([2de52e4](https://github.com/guillempuche/batuda/commit/2de52e475e0ecab55cb631cde97228a6c305130d))
* **internal:** let dialogs be linked to and closed with Back ([07d2264](https://github.com/guillempuche/batuda/commit/07d2264d3bb8b67e385813f1b6ae3a9693987390))
* **internal:** page the task inbox one shelf at a time ([7dd8e9c](https://github.com/guillempuche/batuda/commit/7dd8e9c98dfb73254f56530dc62e92eea3a503d9))
* **internal:** read task and meeting rows by one set of names ([d13fe5e](https://github.com/guillempuche/batuda/commit/d13fe5e5b72c47da25a79549e2d96f6bfe1d7adb))
* **internal:** share the review's repeated pieces and drop a filter nobody needs ([5018ad9](https://github.com/guillempuche/batuda/commit/5018ad9b01a2e4a5d806e7d6eef211aa3afc8066))
* name the CRM rows a link can point at in one place ([fff48f2](https://github.com/guillempuche/batuda/commit/fff48f2c3a5906abf925d5d97aa7d778c2502234))
* **research:** drop the token counting the meter replaced ([41ffc91](https://github.com/guillempuche/batuda/commit/41ffc91fdd1d9f0ddba33a53986a9519bc561baa))
* **research:** drop the unused provider credit allowance ([3c04bd7](https://github.com/guillempuche/batuda/commit/3c04bd7f880c1fa7cda62491fc50de293b10b416))
* **server:** name the keys a contact's channels ship with ([7500332](https://github.com/guillempuche/batuda/commit/7500332b6ac86545727f2de9040adb756b320127))

### Tests

* **internal:** bold a word without guessing where it sits on screen ([7e667a5](https://github.com/guillempuche/batuda/commit/7e667a55747f4181049c57d893f878f5aed8a057))
* **internal:** leave the seeded default stack in place ([31686ac](https://github.com/guillempuche/batuda/commit/31686ac3d255d2f482cf33afcf288e3af7938a0f))
* **internal:** make four browser tests check what they meant to ([d192f3d](https://github.com/guillempuche/batuda/commit/d192f3d43cdce25b0162c4864a8f578302cd3dd9))
* **internal:** point the browser tests at the address they are actually using ([b239eb0](https://github.com/guillempuche/batuda/commit/b239eb0b05e996f272097e41ca41167c92f23a0b))
* **research:** cover the monthly ceiling and the flat charge ([bf66238](https://github.com/guillempuche/batuda/commit/bf662381bb8db6f530510acf71486cab109ee265))

### Chores

* remove dependencies and build settings nothing uses ([44d9d28](https://github.com/guillempuche/batuda/commit/44d9d28002545f104f5b455af095ed09ebd1a165))
* renumber the new migrations behind the ones main added ([c1b2471](https://github.com/guillempuche/batuda/commit/c1b2471ea35e41f472050c7b5a6a877deba50fcc))

## 2026-07-25 (internal-v2026.7.25-1)

### Bug Fixes

* **internal:** give the browser its browser build of the email renderer ([63f2876](https://github.com/guillempuche/batuda/commit/63f287610658cf6af0bd1d55d0d724068c4eb9a2))

### CI/CD

* **release:** ui v2026.7.25 ([782c3bb](https://github.com/guillempuche/batuda/commit/782c3bb38a2cae1aee41b056d6c24cfd471b84b5))

## 2026-07-25 (internal-v2026.7.25)

### Features

* add a match count to the list endpoints ([a6ed26f](https://github.com/guillempuche/batuda/commit/a6ed26f9292a2a63ebc0e4e93725565601dfb6a9))
* **controllers:** carry a company's research history on its detail ([d908a5e](https://github.com/guillempuche/batuda/commit/d908a5e19e1c3273eb19b0ed387116bae7e52e8d))
* **domain:** store a company's brief, provenance and fit ([dd9f12f](https://github.com/guillempuche/batuda/commit/dd9f12fed71bf5b143d0fb7a07a8496f2291a04c))
* **internal:** add a rich-text markdown editor to templates ([2caad8f](https://github.com/guillempuche/batuda/commit/2caad8ff7e2fdb525032cf73915f9a85e5c27a49))
* **internal:** make dialogs URL-navigable via a dlg search param ([754226e](https://github.com/guillempuche/batuda/commit/754226ec996e399db705a729de7df41341037fa5))
* **internal:** manage named instruction stacks in settings ([64e8c49](https://github.com/guillempuche/batuda/commit/64e8c49c0d34c0c8070293df1567c6e57b007062))
* **internal:** show a company's brief, fit, and low-confidence runs ([590f922](https://github.com/guillempuche/batuda/commit/590f9222137b1babc65be8857dbf913db098a7b7))
* **research:** ground findings to the right company and fill the gaps ([33f6563](https://github.com/guillempuche/batuda/commit/33f6563cbd57fb6e7ba40a6458926e3992d37353))
* support multiple named instruction stacks per org and user ([f111b3d](https://github.com/guillempuche/batuda/commit/f111b3d33d2f658a9c3721759d0fea53896c5bf6))
* **ui:** add mobile dialog sheets and a destructive button ([80cf0c0](https://github.com/guillempuche/batuda/commit/80cf0c081c8f50ea89aae9d534924b96d7eb92ad))

### Bug Fixes

* **instructions:** refuse to transfer a template still used in a stack ([4ea4d50](https://github.com/guillempuche/batuda/commit/4ea4d5057b42e9c99f222c2774d5d852d796b838))
* **internal:** count active companies from the whole pipeline ([7bcf46e](https://github.com/guillempuche/batuda/commit/7bcf46ef4076f9463367b26084a4d25419129660)), closes [#322](https://github.com/guillempuche/batuda/issues/322)
* **internal:** flag bounced-email contacts and block sending to them ([256879b](https://github.com/guillempuche/batuda/commit/256879b1f3480886617f714dd038d3fff28a1769))
* **internal:** give the companies list and board the same header ([601bd74](https://github.com/guillempuche/batuda/commit/601bd742bd3c2e4584b040dc1ed092dc1462a96d))
* **internal:** give the pipeline board columns equal width ([5da7105](https://github.com/guillempuche/batuda/commit/5da7105d2b6c6f2d0a91bfe54dba875535ae9def))
* **internal:** keep a proposal's outcome visible after the page settles ([e53bab9](https://github.com/guillempuche/batuda/commit/e53bab99f16b81b90187e902c23c76e327b98835)), closes [#308](https://github.com/guillempuche/batuda/issues/308)
* **internal:** keep the companies list from overflowing and stretching ([7f279a9](https://github.com/guillempuche/batuda/commit/7f279a94b0c99bfcda1fa4fc95314c21246ba229))
* **internal:** mark the empty-state title as a heading ([2dab02b](https://github.com/guillempuche/batuda/commit/2dab02b5d8de6ed4ea29e4c2b4e93dea45f7ca77))
* **internal:** stop a failed company load reading as empty pipeline ([183a218](https://github.com/guillempuche/batuda/commit/183a218068aa9c5181bcbf14f92b22b0a0542da2))
* **internal:** strengthen template dialog accessibility ([435c502](https://github.com/guillempuche/batuda/commit/435c5025bb41235aa0d3038c539926c9bfc8322e))
* **research:** keep open-web searches anchored to the target company ([7aa5d00](https://github.com/guillempuche/batuda/commit/7aa5d00a1f5bfdfe30d4e0df5894549f225b0a88))
* **ui:** respect prefers-reduced-motion in dialog transitions ([5da8b54](https://github.com/guillempuche/batuda/commit/5da8b54a1ba8758f817c495863295c073e0210cd))
* validate the stack a run picks and report stack write failures ([f714b79](https://github.com/guillempuche/batuda/commit/f714b791dfecd7e84e0521f00b392cd0cc1e693e))

### Tests

* **internal:** fix the failing end-to-end tests and tag a smoke subset ([381fa9c](https://github.com/guillempuche/batuda/commit/381fa9cebfbbe546baeba4d9ad63b2a842d6f6de))
* **internal:** run e2e against the checkout's own app and database ([ff0bacb](https://github.com/guillempuche/batuda/commit/ff0bacb4245e11fbdbbeca0f5a13da9c563806e7))
* **internal:** stop the quick-capture smoke test racing hydration ([95632ec](https://github.com/guillempuche/batuda/commit/95632ec0543a883737502768723dd5161b0de0a4))

### CI/CD

* **release:** ui v2026.7.22 ([ffc3330](https://github.com/guillempuche/batuda/commit/ffc333012bde23f2f0daeb96761c23aa6ae9c63d))
* run the end-to-end suite automatically in CI and pre-push ([38c4295](https://github.com/guillempuche/batuda/commit/38c4295f0237bf98bd949f24667c153f613017ad))

### Chores

* **internal:** reconcile i18n catalogs after rebasing onto main ([d624c04](https://github.com/guillempuche/batuda/commit/d624c045af62986493700b3a928cdc019bff62a6))
* pin the [@tiptap](https://github.com/tiptap) packages to 3.28 for markdown support ([f7bfbd1](https://github.com/guillempuche/batuda/commit/f7bfbd1ce8350190f29baab361e022c066735640))

## 2026-07-22 (internal-v2026.7.22)

### Features

* **auth:** remember which language each person reads ([ddbc59f](https://github.com/guillempuche/batuda/commit/ddbc59f023cc54d69b1c2d0fceb8ec1f8ad248a9))
* bump Effect to 4.0.0-beta.98 and give API responses typed schemas ([9365867](https://github.com/guillempuche/batuda/commit/936586718e5de8410e6e33b053b455b517a1ae68))
* **domain:** move the list of languages into the shared package ([0bcb7d0](https://github.com/guillempuche/batuda/commit/0bcb7d067af6c6b9f7801871badb319020cb6073))
* **internal:** carry the dark themes onto surfaces the palette cannot reach ([b043ab5](https://github.com/guillempuche/batuda/commit/b043ab5e5730ea6129a6405e17d5088cb00aba05))
* **internal:** let people choose the appearance from their profile ([79c6326](https://github.com/guillempuche/batuda/commit/79c6326c45ecd57e1ce9038fa6e2adc598537813))
* **internal:** remember and apply the chosen theme across reloads ([6a4e68f](https://github.com/guillempuche/batuda/commit/6a4e68f644fc70bc6d7aebc3ac8a89f5f2ef92a0))
* **internal:** replace the invitation screen with adding a member ([4728296](https://github.com/guillempuche/batuda/commit/472829698ef5447401186bbd3336d59752b10c63))
* **research:** add a per-contact critic to drop non-staff contacts ([c1e9112](https://github.com/guillempuche/batuda/commit/c1e9112971c33e5363bfb48f3c1fd39e87c62c79))
* **research:** drop a directory listing posing as a company's website ([c9b1326](https://github.com/guillempuche/batuda/commit/c9b13265b5f6d260526626428b2b44231ee21b6e))
* **research:** fetch a company's about and team pages up front ([808b251](https://github.com/guillempuche/batuda/commit/808b251cdb81e549ae7f5b2ab08a83881386a3c6)), closes [#286](https://github.com/guillempuche/batuda/issues/286)
* **research:** leave out prospects that miss the size or place asked for ([fef32e9](https://github.com/guillempuche/batuda/commit/fef32e97fc8887f851131c4116faf2531bb8064b))
* **research:** look a company up in its national register ([fcc1f4e](https://github.com/guillempuche/batuda/commit/fcc1f4eccdb3439057858693405648942baf5756))
* **research:** make the eval score honestly and trace dropped fields ([672ea4e](https://github.com/guillempuche/batuda/commit/672ea4ef3caf98dd748adb0b28871c9498e591e6)), closes [#286](https://github.com/guillempuche/batuda/issues/286)
* **research:** measure how much of a company profile each step fills ([c620461](https://github.com/guillempuche/batuda/commit/c62046175cc4f17855cacbdab806ae961f090c57))
* **research:** propose CRM corrections from what a run already holds ([efed961](https://github.com/guillempuche/batuda/commit/efed961c8a7933fd6de33399543b464a720aeb37))
* **research:** recover more company data and reject look-alike matches ([52af91f](https://github.com/guillempuche/batuda/commit/52af91f59836ebb5db25e1460464624ccdc2dde3))
* **server:** add people to an organization directly ([efed2b7](https://github.com/guillempuche/batuda/commit/efed2b783853d28d9e165ed0847b5d35dd78e527))
* **ui:** add the dark and high-contrast themes ([d874fae](https://github.com/guillempuche/batuda/commit/d874fae410181a53301b3fc33078c1c09c55e09a))

### Bug Fixes

* **internal:** keep the pages status filter in step with the URL ([c0d4ef2](https://github.com/guillempuche/batuda/commit/c0d4ef2a6e54ac4be95f5d612557460c7e0b1d71))
* **internal:** make faded labels and badges legible again ([dd3c78c](https://github.com/guillempuche/batuda/commit/dd3c78c223d36ec5ef440f82f8e2dc9fbbd59d28))
* **internal:** make the dark themes correct on the surfaces that ignore them ([aa631eb](https://github.com/guillempuche/batuda/commit/aa631eb4d68e89639bb6452736ebb4dace68cbe0))
* **internal:** only offer to approve a paid step that can be run ([b2814d7](https://github.com/guillempuche/batuda/commit/b2814d7f83f93965f6a42a59d0d7eaefb68feb24))
* **internal:** show failed loads as errors instead of empty lists ([91fdb99](https://github.com/guillempuche/batuda/commit/91fdb9909398ec2715602c36fa1269d97f8d22b7))
* **internal:** tell apart loading, failed and empty on a company's panels ([3f76694](https://github.com/guillempuche/batuda/commit/3f76694526b60f85eed0224fc7879572df6ac084))
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
* **server:** only undo an account this request created ([b2dbc86](https://github.com/guillempuche/batuda/commit/b2dbc867a5228f4d0be9d21fb7d0d3f389e95a2b))
* **ui:** serve the design tokens from a single copy ([92e1f5b](https://github.com/guillempuche/batuda/commit/92e1f5b54675bd85ef6bd9e3033a2205cef64b84))

### Refactoring

* **internal:** draw app surfaces from tokens instead of fixed colours ([20f9fed](https://github.com/guillempuche/batuda/commit/20f9feda91055d1d5d9593038a8750e43d307738))
* remove the unwired web tools and extract/discover backend ([7fce393](https://github.com/guillempuche/batuda/commit/7fce3936871e0925864f41a11c79a87d9bda6dca))
* **research:** give freeform the shared proposed-update shape ([5827769](https://github.com/guillempuche/batuda/commit/5827769b8d2bb0309bad98cceb25af85e1698a10))
* **research:** name the prompt that turns evidence into findings ([26945ee](https://github.com/guillempuche/batuda/commit/26945ee793a7a2ad0cc831c43fccd98b8f26135f))
* **ui:** complete and restructure the design token system ([6cc0243](https://github.com/guillempuche/batuda/commit/6cc0243486d5310cb56c574b4dc7bbe355c4519c))
* **ui:** draw library primitives from tokens instead of fixed colours ([aef36ab](https://github.com/guillempuche/batuda/commit/aef36ab9d6d965c1fb10c1f012310f2b62d9ce02))
* use English codes for the CRM industry categories ([44007a3](https://github.com/guillempuche/batuda/commit/44007a35d3387c0c24ae44fb7b6de6c186ca13ec))

### Tests

* **internal:** wait for the page to be live before clicking ([6239336](https://github.com/guillempuche/batuda/commit/62393367d41a99191fe5dad95a85d4c57fd03bb0))
* **research:** remove stale integration test placeholders ([f02c484](https://github.com/guillempuche/batuda/commit/f02c4848ef27a5a098f7efe4b2ffb2ebb06b7dd0))
* **ui:** check theme contrast against the token file before pushing ([103aef4](https://github.com/guillempuche/batuda/commit/103aef4a928dc4d4100ea532e3363b401ce09856))

### CI/CD

* run the theme contrast check where it cannot be skipped ([9198703](https://github.com/guillempuche/batuda/commit/91987035a3f60998586bf8f8b91b1589d272f8f2))

### Chores

* bump Base UI to 1.6.0 ([080a353](https://github.com/guillempuche/batuda/commit/080a353031b9375b61617aec9bcffd413fd4faff))
* bump react/react-dom to 19.2.7 and @types/react to 19.2.17 ([08283e2](https://github.com/guillempuche/batuda/commit/08283e2e4b604b6d0617b0c85b952d640ea2422b))
* **deps:** bump dev tooling (biome, turbo, release-it, lefthook) ([023a215](https://github.com/guillempuche/batuda/commit/023a2156cccd81461c7f95c84f4eea2edf695304))
* **internal:** bump TanStack Router, Start, Generator, and Virtual ([d5ede24](https://github.com/guillempuche/batuda/commit/d5ede24d0cfde149aeb6712b27c2d23524f118f7))

## 2026-07-13 (internal-v2026.7.13)

### Features

* **internal:** add opt-in full-height layout to the blueprint sheet ([abc1552](https://github.com/guillempuche/batuda/commit/abc15526198ac7ee01e433cd070f9814de7d9d49))
* **internal:** compact the emails filter controls onto one row ([cb78e16](https://github.com/guillempuche/batuda/commit/cb78e16f1bd25c6dc79c98a8da7f559df007c455))
* **internal:** make compose a mobile bottom sheet ([37e09fc](https://github.com/guillempuche/batuda/commit/37e09fcfde52b87e218034923b65bf7688a43d2e))
* **internal:** open the "Find companies" dialog from the URL ([742ac40](https://github.com/guillempuche/batuda/commit/742ac4070cb5c81a7911c7c77558c46d795f2962))
* **internal:** rework the emails thread list ([35774ff](https://github.com/guillempuche/batuda/commit/35774ffb2e46db90340ce2b0c30722d723c04579))
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

### Refactoring

* **internal:** move the stage and inbox pickers to PriMenu ([a8a05ae](https://github.com/guillempuche/batuda/commit/a8a05ae428d9deaeeff378ea221dfa6b31527365))
* **research:** remove the extract_structured tool ([5547579](https://github.com/guillempuche/batuda/commit/5547579c982d79f5d17e8c27724cda0d06d5070b))

### CI/CD

* **release:** ui v2026.7.12 ([ddb7645](https://github.com/guillempuche/batuda/commit/ddb76459787d8b231ade3e051827affa0694d4ec))
* **release:** ui v2026.7.13 ([554e3cb](https://github.com/guillempuche/batuda/commit/554e3cb5461a504581b5b7ff56e9f769cdd25076))

### Chores

* **internal:** translate the new emails strings to Catalan ([ec392d4](https://github.com/guillempuche/batuda/commit/ec392d42f7460b8619bb870704df7750c9ca9c90))

## 2026-07-12 (internal-v2026.7.12)

### Features

* add pipeline board and book-of-business views ([#225](https://github.com/guillempuche/batuda/issues/225)) ([efa50ad](https://github.com/guillempuche/batuda/commit/efa50ad2a61641fd4336cdae750b38a43fc01529))
* export eval run scores to the monitoring board as spans ([5925278](https://github.com/guillempuche/batuda/commit/59252786deca1325fe487879c11e0a8f3ebeabd6))
* gate research batch fan-outs behind a cost confirmation ([7675306](https://github.com/guillempuche/batuda/commit/767530600eb441a3357b8e354d6ca49bba369744))
* **internal:** add a documents surface to the company Files tab ([0f9e372](https://github.com/guillempuche/batuda/commit/0f9e372b3d64a9a0d5d7e4667ef7538a39a51150))
* **internal:** add a line-item editor to proposals ([311d6a4](https://github.com/guillempuche/batuda/commit/311d6a49ff2dc268ce12855f8b9e49504470f311))
* **internal:** add a proposals surface to the company Files tab ([31d95d1](https://github.com/guillempuche/batuda/commit/31d95d17024af79230c0f48ea773abf8624d49af))
* **internal:** add confirm and undo to the research proposal review ([71a1cb6](https://github.com/guillempuche/batuda/commit/71a1cb65e7032d260a82dc0f2e3d77dceeb4e220))
* **internal:** add follow-ups, tracked email, and a Cal.com CTA to a company ([f8c2f19](https://github.com/guillempuche/batuda/commit/f8c2f19ccb9a1a583979ecb1f6e1ec6c8f644a05))
* **internal:** add research discovery and run-management screens ([7843014](https://github.com/guillempuche/batuda/commit/784301400d9c6f00144d2d1382d46334d6f45dca))
* **internal:** cap the research-dialog free-text input lengths ([228ded8](https://github.com/guillempuche/batuda/commit/228ded8fcaaba723d2af496420e97207aae1034e))
* **internal:** verify leads, manage contacts, and add prospects as leads ([308fed5](https://github.com/guillempuche/batuda/commit/308fed55ce9127a39938066ab3cd28d3e83ebb37))
* keep a research run alive when its language-model call stalls ([01286df](https://github.com/guillempuche/batuda/commit/01286df1dbab1a907df36b32db920e7a0e847e64)), closes [#235](https://github.com/guillempuche/batuda/issues/235)
* let a human mark a company as a verified lead ([ba42040](https://github.com/guillempuche/batuda/commit/ba42040d9bcb6d44a5adcba9b623378c2b3724ff))
* make the research review inbox filterable and readable ([11e3dfe](https://github.com/guillempuche/batuda/commit/11e3dfec26f8ef910b156e8240149fb393ad03ab))
* **research:** add FullEnrich people search for decision-makers ([6fcfa75](https://github.com/guillempuche/batuda/commit/6fcfa758178b60593d5bda53cc5e91fcb32da47a))
* **research:** count an official-registry match toward eval grounding ([940ded3](https://github.com/guillempuche/batuda/commit/940ded3ad7a4d1b42a3627b20266232dc8041483))
* **research:** fall back to the next enrichment vendor on a miss ([89b2004](https://github.com/guillempuche/batuda/commit/89b20047ac253488fd52c3aafc4020b7167ec712))
* **research:** keep uncertain fields instead of dropping them ([d6bd64b](https://github.com/guillempuche/batuda/commit/d6bd64b96760314ced4d2745a029ed8257357d9b))
* score decision-maker discovery against a golden set ([362c404](https://github.com/guillempuche/batuda/commit/362c4046e7de990dadaabb3b14ae5d9009e8aa8f))

### Bug Fixes

* **internal:** recover the run page when live updates stall ([d4621ef](https://github.com/guillempuche/batuda/commit/d4621ef22d3feab6db3eb890c4b5c1e234933734))
* read camelCase result keys in run reuse and provider quota ([ef6b51f](https://github.com/guillempuche/batuda/commit/ef6b51f0514dd74797024cdc50555ec7e0a558be))
* **research:** drop form pop-ups from scraped page content ([d505c20](https://github.com/guillempuche/batuda/commit/d505c20ff648d77e6c003da30a424bedc5df10d8))
* **research:** fetch the caller's domain up front so the run grounds ([3f28845](https://github.com/guillempuche/batuda/commit/3f28845815d5238feb9d08c0c5b04fd61ae0b1de))
* **research:** make the LLM fallback accept our tool and output schemas ([195c166](https://github.com/guillempuche/batuda/commit/195c166c16fe033b834dc40141b7d4ef71d72bde))
* **research:** recover facts seen only in a search result ([d97f042](https://github.com/guillempuche/batuda/commit/d97f042a2f54f953cccf7e4d69f6b6f7171f7600))
* **research:** surface the provider error message in tool-failure logs ([c0b88bd](https://github.com/guillempuche/batuda/commit/c0b88bd854249282ad91dbea7954c0eeb8cbc9ef))
* **research:** treat a refused-site scrape as a skip, not a run failure ([571b773](https://github.com/guillempuche/batuda/commit/571b773f08ee3481927f62523453bafc88b87c61))
* stop the scrape cache from starving research into fabrication ([a445c33](https://github.com/guillempuche/batuda/commit/a445c33c7b9f4a27ca67d77a3f9e37e4b7ca6fd0))
* unbreak proposal creation and stamp its lifecycle dates ([dea55e2](https://github.com/guillempuche/batuda/commit/dea55e2fbb386f0f337088b5d45fe3eae90f02ee))

### Refactoring

* **internal:** drop the dead calendar tab and fix a stale atoms comment ([71f7a20](https://github.com/guillempuche/batuda/commit/71f7a20ee707aef1d204efda8c4e5c2ae637b274))

## 2026-07-11 (internal-v2026.7.11)

### Features

* **controllers:** add the anchored re-run endpoint ([3f79160](https://github.com/guillempuche/batuda/commit/3f791607c52c108d053cfdc38f1b86b942fe5fe7))
* **domain:** add company classification vocabularies ([dcc709c](https://github.com/guillempuche/batuda/commit/dcc709cac76703731efe0f3f81a05e44c46aebca))
* **internal:** show per-field sources, reasons, and target correction ([943cfcf](https://github.com/guillempuche/batuda/commit/943cfcfabed371608b5043e2602c97d4c860c96e))
* **research:** confirm the right company and extract clean, measured fields ([cb1f8e9](https://github.com/guillempuche/batuda/commit/cb1f8e9c9e12dcae9eb1120a4e99174ae30749aa))

### Bug Fixes

* **research:** fail closed when a run can't confirm the target company ([3523fd8](https://github.com/guillempuche/batuda/commit/3523fd8c1bc4d68fe572bcecd6fdfffa3f5fa13f))
* **research:** keep a rejected page extraction from failing the run ([02715c4](https://github.com/guillempuche/batuda/commit/02715c46a496a85486bf844cca658ca5cc768cb3))
* **research:** per-tool spend breakdown and honest empty-scan handling ([197d752](https://github.com/guillempuche/batuda/commit/197d752d415ce6dfa97e619aafb0765fc1290c15))
* **research:** strip page-builder markup from scraped pages ([3a34d99](https://github.com/guillempuche/batuda/commit/3a34d994c42df681ee129379505e36de2b564bd2))
* resolve blob uploads failing against Cloudflare R2 ([c6323f9](https://github.com/guillempuche/batuda/commit/c6323f95aea1453ea1919ddac9e4c2baa8f56516))

## 2026-07-08 (internal-v2026.7.8)

### Features

* add cross-run review inbox and type review endpoints ([bbf3a56](https://github.com/guillempuche/batuda/commit/bbf3a5663f99c6b68a173acb96633cef68d5d544))
* apply or reject many research proposals in one call ([1f3aeb2](https://github.com/guillempuche/batuda/commit/1f3aeb2cca8d291eccf3a63fb718029e9f2f3932))
* auto-apply high-confidence verified research findings ([99814b8](https://github.com/guillempuche/batuda/commit/99814b85c7d2158789e01059e408ff8b53acd791))
* execute an approved paid research follow-up safely ([bb86d93](https://github.com/guillempuche/batuda/commit/bb86d93684f139c700f6f37a34e3a7db2d14edf7))
* fan a selector run out across matching companies ([94be140](https://github.com/guillempuche/batuda/commit/94be140f6e369f12b7ed26d0bc73e2ff69c7e3ad))
* **internal:** add the research review UI ([67494e5](https://github.com/guillempuche/batuda/commit/67494e50d02176c0369f2b16bad5ff819446eeae))
* make research runs honest about the company they researched ([01aaf6d](https://github.com/guillempuche/batuda/commit/01aaf6dcc0376ed3cd237c18fd3727d09c8dd547))
* record who applied a research suggestion to the CRM ([da1304e](https://github.com/guillempuche/batuda/commit/da1304e0c881d2121b7dff3ed249327596d78f11))

### Bug Fixes

* **research:** normalize web_search location to a valid country code ([ee3a0f9](https://github.com/guillempuche/batuda/commit/ee3a0f99491ccb995df349c3d488766ce5b04ec8))
* **research:** rebuild cached LLM responses so tool results survive ([45f26e3](https://github.com/guillempuche/batuda/commit/45f26e39a0eca49fae9ca627abb3becbca958570))
* **research:** stop the company registry returning its raw provider payload ([673c54d](https://github.com/guillempuche/batuda/commit/673c54da7eb9348e87d5f76e39e09b46e0fc71d7))
* **research:** stop website noise from polluting enrichment output ([574411f](https://github.com/guillempuche/batuda/commit/574411fb341bef8af4fa58a295f4a5f7ea2e9a84))

## 2026-07-06 (internal-v2026.7.6)

### Features

* add Firecrawl web search and make it the primary provider ([cc9711c](https://github.com/guillempuche/batuda/commit/cc9711cfff59cba7f9b23eb75467ee9ed6dffabd))
* create newly discovered contacts in the CRM under the run budget ([72f223d](https://github.com/guillempuche/batuda/commit/72f223d2e6c36ea7f61680c80d8083c27198143a))
* ground research findings in a reflect loop, refusing fabrication ([c0a9cf5](https://github.com/guillempuche/batuda/commit/c0a9cf5c04ac372e2af397e33b513aa8866fb37d))

### Bug Fixes

* stop invented contact details from surviving in research findings ([c52a60b](https://github.com/guillempuche/batuda/commit/c52a60b81c65f32db43409eb79e63759c0aede2f))

## 2026-07-05 (internal-v2026.7.5)

### Features

* apply research proposed-updates to the CRM row ([99de720](https://github.com/guillempuche/batuda/commit/99de7207df952abfbcfa2b71c2b9ad51f75998a6))
* **instructions:** resolve per-run override by name or id ([7d9ef78](https://github.com/guillempuche/batuda/commit/7d9ef7807b7bf77088c58c39bb246575e0717c45))
* **internal:** add per-surface selector for instruction default stacks ([d219df0](https://github.com/guillempuche/batuda/commit/d219df00fa05a30e42e9d0949777e1ad18c538d7))
* **internal:** make the inbox connections screen beginner-friendly ([88bef75](https://github.com/guillempuche/batuda/commit/88bef7522002714d8fe68ba71eeaef81492602e6))
* reclaim interrupted research runs via a run heartbeat ([0e37736](https://github.com/guillempuche/batuda/commit/0e37736a5d7d6cc0598902430deb48d728c99bfd))
* research companies in any country, not just Spain and the UK ([de9fdd6](https://github.com/guillempuche/batuda/commit/de9fdd66081354f7e83a4943822739f71c0cc823))
* **server:** add bounding-box company search and location re-geocode ([259137b](https://github.com/guillempuche/batuda/commit/259137b7ff2b4fd8d1688a72c8ccf91cb08de10c))

### Bug Fixes

* record paid research spend with per-org idempotency key ([56d2695](https://github.com/guillempuche/batuda/commit/56d2695640df791bd96449843b7c04e5201e0619))
* **research:** accept model-emitted null for optional tool params ([e05a43d](https://github.com/guillempuche/batuda/commit/e05a43d9f842fa2dee176e6c55892d014583443f))
* **research:** coerce model "NaN" numbers to null in extraction schemas ([4c3d43a](https://github.com/guillempuche/batuda/commit/4c3d43ae0c9fa48d1344006f0da7a4338dd52ca0))
* **research:** read run-row fields under the camelCase transform ([85d24b1](https://github.com/guillempuche/batuda/commit/85d24b1152b55e79602c0147061340c2fed7f872))
* **research:** surface the real error instead of a wrapper crash ([4fe8de9](https://github.com/guillempuche/batuda/commit/4fe8de9c31052d89980d13ea7d87399d40c3cf09))
* **research:** tolerate null service_tier in LLM provider responses ([248aa3c](https://github.com/guillempuche/batuda/commit/248aa3cc18ff674342214a616ccac9af11360973))
* **research:** tolerate plain text where extraction expects JSON ([eab94e2](https://github.com/guillempuche/batuda/commit/eab94e28cbcb2db357028bb92c62b7b5ccd169e0))
* **research:** unblock research runs on OpenAI structured output ([1ab6c95](https://github.com/guillempuche/batuda/commit/1ab6c9599e7f36fd882d83be2a0b19ac9db0f1c1))
* run research jobs from a background queue, not the web request ([c94bc20](https://github.com/guillempuche/batuda/commit/c94bc2093a7ab55c58da5e2f6206ad88e387f17a))
* stop company enrichment asking the model for coordinates ([a2713e9](https://github.com/guillempuche/batuda/commit/a2713e9ffc333dab9471561df021f936de91cf18))

### Refactoring

* **research:** share duplicated research output schema fragments ([76507a4](https://github.com/guillempuche/batuda/commit/76507a487727d495aab756e2b27de144a2805027))

## 2026-06-29 (internal-v2026.6.29)

### Features

* **domain:** add the contact_channels model ([75b5560](https://github.com/guillempuche/batuda/commit/75b55604e58cddb92343793572d6a0bf4ba2acfd))
* **internal:** display and manage contact channels ([378eb18](https://github.com/guillempuche/batuda/commit/378eb18647d97ade6ecf488528580701b2e65914))
* migrate contacts to a channels-only model ([f9bb030](https://github.com/guillempuche/batuda/commit/f9bb0301694095f5d0769a5d18baba91f89f19d6))
* **research:** add UK Companies House registry + registry-first discovery ([ee9c017](https://github.com/guillempuche/batuda/commit/ee9c01774bea2d508b3ff9a6e9804ad7ffa349e7))
* **research:** discover verified decision-maker contacts ([fe20e4b](https://github.com/guillempuche/batuda/commit/fe20e4ba3b2a42415086fd732cd203ac28a0e355))

### Bug Fixes

* route inbound email matching through contact channels ([7474a68](https://github.com/guillempuche/batuda/commit/7474a680814b8a6099333122f40133f063a8617d))

## 2026-06-28 (internal-v2026.6.28)

### Features

* **internal:** allow resending a pending invitation ([b4263c2](https://github.com/guillempuche/batuda/commit/b4263c2660e90dd4aba9828ed5c6b7682790a5a5))
* require explicit research, email, and geocoder config ([fc8b40d](https://github.com/guillempuche/batuda/commit/fc8b40d651861d8be01bfdb3cc7f2843e3ebac28))

### Bug Fixes

* **server:** add defaults for research/env vars and trim KraftCloud cmdline ([2e19c87](https://github.com/guillempuche/batuda/commit/2e19c87b1f1bfc2467298417accb22e9381572bb))

## 2026-06-26 (internal-v2026.6.26)

### Features

* expose lookup_registry as a standalone MCP tool ([e8518e9](https://github.com/guillempuche/batuda/commit/e8518e9398f9329346694e03e660a6564abc3a0d))
* **internal:** auto-bind org at consent and show multi-org connections ([fe8f764](https://github.com/guillempuche/batuda/commit/fe8f7644c9cd2b83ea1bb4dfed01317c8c08e139))
* **internal:** inline invitations on the organization members page ([7d419f6](https://github.com/guillempuche/batuda/commit/7d419f6d76f924ff9e5c0ab485bf0fcb85d8114b))
* **research:** add Firecrawl scrape and extract providers ([0a7c543](https://github.com/guillempuche/batuda/commit/0a7c5431b6c788b56c80739892948b1f81c662da))
* **research:** add LibreBOR registry adapter ([244d590](https://github.com/guillempuche/batuda/commit/244d5904d881b888d67c6d66008864d6d02e93b4))
* **research:** attribute scraped pages to the run ([4ee0976](https://github.com/guillempuche/batuda/commit/4ee0976fd99ec80d9bde3cd2fb544bd82468b9c2))
* **research:** map location and sector onto the registry record ([cd85ddc](https://github.com/guillempuche/batuda/commit/cd85ddc264eca7272604458803dec1e20bd7e328))
* **server:** support multiple orgs per MCP OAuth connection ([bf0c957](https://github.com/guillempuche/batuda/commit/bf0c957d1e46a29e00d08ea805ea0ac9f56767ac))
* **ui:** add fluid prose typescale for long-form reading ([4b089fe](https://github.com/guillempuche/batuda/commit/4b089fe186e3700d1f0b8f73c89f5da05312b3b7))

### Bug Fixes

* **internal:** derive the dev client API origin on portless's port ([de18633](https://github.com/guillempuche/batuda/commit/de1863351b63c397a53e11ef57fc408fae62580c))
* **internal:** make attachment downloads work in dev and worktrees ([7fb9391](https://github.com/guillempuche/batuda/commit/7fb93917518416dcc19c71733024e0bf2cc2a48c))
* **internal:** point dev API proxy and e2e at portless's port ([c15445a](https://github.com/guillempuche/batuda/commit/c15445add78acc99d2274c0228824b156a271e45))
* **internal:** update the API-keys list after create and delete ([89b7ce7](https://github.com/guillempuche/batuda/commit/89b7ce7e852b9dcbaa69d03e8065d2be6b589108))

### Refactoring

* remove starter instruction presets and source_preset_id column ([389bdaf](https://github.com/guillempuche/batuda/commit/389bdaf7591c03b78fc0d3b4403bdec36d2d3f19))

### Tests

* **internal:** assert the seeded message shape in thread-render ([9e8850a](https://github.com/guillempuche/batuda/commit/9e8850ae556569eb6a470b29df1f8025a6042894))
* **internal:** point the email e2e suite at the GreenMail catcher ([0615301](https://github.com/guillempuche/batuda/commit/06153015b24b9f4a747c78dffc85f65ad03c5a5c))
* **internal:** stabilize the rich-compose and send-email e2e specs ([2cec8af](https://github.com/guillempuche/batuda/commit/2cec8af22a665de76debf65d0a20d764398faa63))
* **research:** cover the Firecrawl adapters and HTTP hardener ([02b04c9](https://github.com/guillempuche/batuda/commit/02b04c93cea7fada9a8f726c0769e876249035ae))

### CI/CD

* make the Start plugin the single source for the route tree ([3d1cd9b](https://github.com/guillempuche/batuda/commit/3d1cd9b04f1d7ce5c7e314643541cd68d6966e01))
* **release:** ui v2026.6.18 ([f8992d8](https://github.com/guillempuche/batuda/commit/f8992d843f1c08e94e503b8900c221039e13a63a))

### Chores

* **internal:** stop i18n catalog line-number churn ([ba736eb](https://github.com/guillempuche/batuda/commit/ba736eb718e2df9dfdffcdf894fbd6d964055916))

## 2026-06-15 (internal-v2026.6.15)

### Features

* **internal:** drive inbox dialogs from URL search params ([56f8f5c](https://github.com/guillempuche/batuda/commit/56f8f5cdd200e2d8c654a2d242861c33ec070598))
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

## 2026-06-10 (internal-v2026.6.10)

### Features

* add instruction-template management API over HTTP and MCP ([08f1a50](https://github.com/guillempuche/batuda/commit/08f1a5059d8e93dbcaf4d3732ff381d3bd1348cc))
* **instructions:** set and read stack composition via the API and MCP ([df1ae5e](https://github.com/guillempuche/batuda/commit/df1ae5e43e7bcfd43350e53d9a81dda43940c5e6))
* **internal:** add AI instruction-templates UI ([c381949](https://github.com/guillempuche/batuda/commit/c38194932e5e7d89b737bfe27db4ff4cbab16611))
* **internal:** add extend mode and drag-and-drop to the stack editor ([78e3169](https://github.com/guillempuche/batuda/commit/78e3169c8b4a0e053b2b310cb4c64133e4fd6173))
* **internal:** add org instruction-templates admin page ([af231bb](https://github.com/guillempuche/batuda/commit/af231bb957200c45ae8db5750483a9bcd3e25cb9))
* **internal:** show the [tag] convention in the name placeholder ([19b1b68](https://github.com/guillempuche/batuda/commit/19b1b689570698e371c3d7da4be8b5d0439a68fe))
* org-isolate the research cache and thread instruction templates ([fa6c6ef](https://github.com/guillempuche/batuda/commit/fa6c6eff56db43aac6da49ad57967e75212e3d92))
* record which instruction templates shaped each research run ([d86e9b8](https://github.com/guillempuche/batuda/commit/d86e9b89a3c040d41edbabbea5276aa4c79ff8f4))

### Bug Fixes

* harden research MCP input validation and lifecycle guards ([03a952d](https://github.com/guillempuche/batuda/commit/03a952d20c60f61a3aae44ba50d93fd1a0541d65))
* **internal:** restore mobile scroll and bottom-nav clearance ([b9672fb](https://github.com/guillempuche/batuda/commit/b9672fbda8ade076cca80f580f027db728636bc3))
* **internal:** stop authed hard-loads bouncing to /login in dev ([3048912](https://github.com/guillempuche/batuda/commit/30489129cfeedca80d25ceca56b07d4771fc7186))
* stop event-sink failures from stranding research runs ([23bd88c](https://github.com/guillempuche/batuda/commit/23bd88c266104b6ff1ae6acc8584f6ff4d9fb59a))

### Refactoring

* extract the research system-prompt builder ([14e813a](https://github.com/guillempuche/batuda/commit/14e813aca146c704d16fcaf5c4979fa681acb17d))
* **internal:** move org admin sections into an admin-only child ([ab2db78](https://github.com/guillempuche/batuda/commit/ab2db78542bc8a72630d763590243631ff08b24b))
* **internal:** read mutation outcomes through one shared helper ([2f0446f](https://github.com/guillempuche/batuda/commit/2f0446fb4f9e5a68108e336d17f411ef8ff465e4))
* **internal:** share the instruction-template page chrome ([16d678f](https://github.com/guillempuche/batuda/commit/16d678f36a2bf2f3c289322ce6cfd697f3b1e018))
* **internal:** share the template delete-confirm dialog ([d4ab895](https://github.com/guillempuche/batuda/commit/d4ab895eecb4f15afc8da8c0f5dd6b8e1ec907b7))

### Chores

* **internal:** refresh i18n catalog source references ([b8df8ba](https://github.com/guillempuche/batuda/commit/b8df8baa672b778d8eb5d55cb4e0c735d908b918))

## 2026-05-29 (internal-v2026.5.29)

### Features

* add org-owned API keys for AI/MCP sessions ([97bfc1b](https://github.com/guillempuche/batuda/commit/97bfc1bd6020ba35d28f1f5ce198991ce07bc544))
* attribute MCP API keys to their creating member ([1476a6d](https://github.com/guillempuche/batuda/commit/1476a6d7eb6dca9b2a241cf8d3dbad27a0268fe2))
* authenticate MCP sessions via OAuth 2.1 ([06ff241](https://github.com/guillempuche/batuda/commit/06ff2419052254b1c9c5be6491d2789180a84351))
* clean up abandoned OAuth clients and show connection provenance ([9c7e9fe](https://github.com/guillempuche/batuda/commit/9c7e9fe4e21fd87149c9f9ee50e9978de642c7b8))
* **internal:** add accessible copy button and reorder MCP help page ([b4f5b6f](https://github.com/guillempuche/batuda/commit/b4f5b6f5320366731d162415ca9b59e57f58d853))
* **internal:** add API key management under a settings hub ([a2be43c](https://github.com/guillempuche/batuda/commit/a2be43c21d4b40f75543aa93f654c71814934dbb))
* **internal:** add MCP OAuth consent and connections UI ([4f18ca2](https://github.com/guillempuche/batuda/commit/4f18ca284347872a3cdda722efa603bf4bc0cb45))
* **internal:** add MCP setup help page with copy-paste configs ([dac32e9](https://github.com/guillempuche/batuda/commit/dac32e9e7bde08cd98a040e2dac0cd1241bfbf40))
* **internal:** deny framing app-wide to block clickjacking ([9658eff](https://github.com/guillempuche/batuda/commit/9658eff4d9a1e23bde017d88f0878a3a7b8fb905))

### Bug Fixes

* **internal:** disable scale-to-zero to drop the per-visit cold-start tax ([21af565](https://github.com/guillempuche/batuda/commit/21af5659dc9ade9d43084287a8002ea0834d0cba))

### Refactoring

* **domain:** move CurrentOrg from @batuda/controllers ([73f3c35](https://github.com/guillempuche/batuda/commit/73f3c352ebfe488226c23b0f13b09cf69c7e42f6))
* move ParticipantMatcher to @batuda/email ([0ef885c](https://github.com/guillempuche/batuda/commit/0ef885c0129b6151e7ea366e4d9c9c14ff3a2768))

### CI/CD

* **deploy:** move batuda-web from kraftcloud to cloudflare workers ([00efd38](https://github.com/guillempuche/batuda/commit/00efd38912d040dc240d383690bb4b66b205bfea))
* **release:** ui v2026.5.17 ([9abce7a](https://github.com/guillempuche/batuda/commit/9abce7a9b09919066852f9506366b587ab79885c))

### Chores

* pin better-auth packages to exact versions ([ef1ac5a](https://github.com/guillempuche/batuda/commit/ef1ac5adfe65a712923fba27a3d3ffe53e4c12a2))
* upgrade better-auth to 1.6.11 and add oauth-provider ([63ea900](https://github.com/guillempuche/batuda/commit/63ea900065d77d8fcb8731f8ca1e075e5065f580))

## 2026-05-17 (internal-v2026.5.17)

### Features

* add magic-link sign-in and show-password toggle on /login ([590234c](https://github.com/guillempuche/batuda/commit/590234c3e53d171523f3af6435039223e8833a00))
* **internal:** add /forgot-password and /reset-password routes ([d6c04b0](https://github.com/guillempuche/batuda/commit/d6c04b01e91db830d7ff25ff936e806fa7fe1c3b))
* **internal:** add /profile password card and dashboard nudge ([3ef98f9](https://github.com/guillempuche/batuda/commit/3ef98f902f7db820f59ab91162b487b8f4b47acd))

### Bug Fixes

* **internal:** hoist login error messages to msg descriptors ([c17c551](https://github.com/guillempuche/batuda/commit/c17c551329e743514e8ef12c9a666971412aa9cd))
* **internal:** resolve @batuda/ui to source via 'development' condition ([1f665dd](https://github.com/guillempuche/batuda/commit/1f665ddee5e0b72ce6a54ba551717ac33785c769))
* **internal:** route dev API proxy through nitro routeRules ([3bf35e9](https://github.com/guillempuche/batuda/commit/3bf35e93d53330b99ab3cfdc65e0e08afc3b0c09))
* **internal:** route sign-in-magic-link.test.ts to the unauth project ([522fac9](https://github.com/guillempuche/batuda/commit/522fac90c7132effdb14ff66ddfaf570458d3679))
* **internal:** wire magic-link verify error + cross-tab sign-in correctly ([d767f93](https://github.com/guillempuche/batuda/commit/d767f93ea79f4f1476c567694a65c7d3154eaead))

### Tests

* **internal:** cover /profile password set, opt-out, and change ([9e0d7ef](https://github.com/guillempuche/batuda/commit/9e0d7ef4944a40c62c569ae064f411f09e2b3f74))
* **internal:** cover forgot-password end-to-end ([5c2e32c](https://github.com/guillempuche/batuda/commit/5c2e32cda6d6a0890a7232934fe13f488d309a53))

### Chores

* **internal:** refresh Lingui catalogs after login.tsx line shifts ([b4a7a02](https://github.com/guillempuche/batuda/commit/b4a7a026fe2bbf6669ff997075bfc42d459f00c8))
* **internal:** refresh Lingui line-number refs ([bb71cd5](https://github.com/guillempuche/batuda/commit/bb71cd593c655139a5b242b4849a5a97a8cdc698))
* **internal:** refresh Lingui line-number refs after readability pass ([fb97823](https://github.com/guillempuche/batuda/commit/fb978230cab0d201323921e59ec55232e6792569))

## 2026-05-13 (internal-v2026.5.13-1)

## 2026-05-13 (internal-v2026.5.13)

### CI/CD

* **deploy:** bake VITE_SERVER_URL into apps/internal build ([d24b414](https://github.com/guillempuche/batuda/commit/d24b414c0aea2fd7028595e4b2c07dea3d983db9))

### Chores

* hoist pnpm node_modules to fit Unikraft CPIO path limit ([456e0ce](https://github.com/guillempuche/batuda/commit/456e0ceba6f1f59913f6bf45adaef379e223068b))
* upgrade pnpm to v11.1.1 with v11 defaults ([5f5d076](https://github.com/guillempuche/batuda/commit/5f5d076242db75cfde38d798c79b426d402fb226))

## 2026-05-10 (internal-v2026.5.10)

### Features

* **internal:** build production SSR via Nitro ([97fec25](https://github.com/guillempuche/batuda/commit/97fec25b4789346220811cb280f2a203bfd2941c))

### Chores

* **internal:** refresh lingui po line references ([31f385a](https://github.com/guillempuche/batuda/commit/31f385aee079f3d78222e6c3f1e1a4710167e2e4))

## 2026-05-07 (internal-v2026.5.7)

### Features

* add company where panel with nominatim geocoder ([5f9fca2](https://github.com/guillempuche/batuda/commit/5f9fca251e940ebbaa85918ae0b9b6b8c056483b))
* add data-testid hooks across Forja for agent-browser ([5cf0c12](https://github.com/guillempuche/batuda/commit/5cf0c12f1a192185a381398507d724867a8617e0))
* add gear favicons for marketing and forja apps ([937fa02](https://github.com/guillempuche/batuda/commit/937fa02b345914213b4284973abd96008cceee72))
* add multi-provider fallback to research capabilities ([b267ef4](https://github.com/guillempuche/batuda/commit/b267ef44de5c10f4c6a11162f4b03c967dde0d0c))
* add provider-agnostic email attachments ([c1c3614](https://github.com/guillempuche/batuda/commit/c1c3614dd91e3c7fe9411f7ca9c97700105b444d))
* build thread detail view at /emails/$threadId ([09852ba](https://github.com/guillempuche/batuda/commit/09852ba243f7702ef7900b5aef0bd501ff30e101))
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
* **internal:** add calendar route with schedule-x grid ([64b67dd](https://github.com/guillempuche/batuda/commit/64b67ddb19a8a85ce4083043bc1790034afe50a0))
* **internal:** add compact mode to WherePanel ([5bbcee1](https://github.com/guillempuche/batuda/commit/5bbcee18ff2d9f53f6685fd8d83874790f70b0d1))
* **internal:** add company ConversationsTab component ([92f1d04](https://github.com/guillempuche/batuda/commit/92f1d049bc5a565c730f71b3f9c63746fc559a2c))
* **internal:** add company-detail dashboard cards ([83b80aa](https://github.com/guillempuche/batuda/commit/83b80aa61129f04023c5898b3bdfdfc10c7d4325))
* **internal:** add emails list with filters and bulk actions ([9117524](https://github.com/guillempuche/batuda/commit/91175246d11b2b40961feff02cc4d00aed35f226))
* **internal:** add inbox management page for local inboxes ([5719bb8](https://github.com/guillempuche/batuda/commit/5719bb850610d6c091f2e8b0c0da74bfb6c4160b))
* **internal:** add inline edit on company detail page ([006ae7b](https://github.com/guillempuche/batuda/commit/006ae7bb4d6875910ed58739fdc855ae10ee755a))
* **internal:** add invite and accept-invitation routes ([703712f](https://github.com/guillempuche/batuda/commit/703712fb6dc5ee772e6b01254951c839bb53e937))
* **internal:** add language selector with SSR-aware i18n ([99c28d3](https://github.com/guillempuche/batuda/commit/99c28d3ae75a83fda61ccc5366520deef6c303ac))
* **internal:** add optimistic thread status and read updates ([19406ee](https://github.com/guillempuche/batuda/commit/19406eefc64b8af2c8fb34b21f61b87cb92ac708))
* **internal:** add organization settings and members pages ([7f5e9df](https://github.com/guillempuche/batuda/commit/7f5e9df5af6592c1e36ca09c75e48d40244d8fb4))
* **internal:** add organization switcher to TopBar ([5e4de0e](https://github.com/guillempuche/batuda/commit/5e4de0e9e3c9cdb19eda4389393cdeafee77bcfb))
* **internal:** add pages list, editor, and company cross-link in Forja ([32eb3f4](https://github.com/guillempuche/batuda/commit/32eb3f462a53053cc72ea6046ab53cd9a5733ce2))
* **internal:** add research atoms + finding components ([c1ea6be](https://github.com/guillempuche/batuda/commit/c1ea6be2bdde576440b873ab9a17eb911730c513))
* **internal:** add RSVP actions to calendar event drawer ([3328dfc](https://github.com/guillempuche/batuda/commit/3328dfc8962a962e42b258b5007a52dd9cfdbdc6))
* **internal:** add testids for thread/inbox/attachment e2e ([f34327d](https://github.com/guillempuche/batuda/commit/f34327d5f6eac1464abaf7217610efcecad5d350))
* **internal:** add typed schema-aware research finding views ([ead5699](https://github.com/guillempuche/batuda/commit/ead569934a84cf177ee46a329a1cc3c188e4991a))
* **internal:** add workshop shell, mixins, and shared components ([af3db4e](https://github.com/guillempuche/batuda/commit/af3db4eb5bb2d7c1a308ac3a32f5e3aa1b9c2e43))
* **internal:** align forja chrome with marketing shadow board ([e1e8fc4](https://github.com/guillempuche/batuda/commit/e1e8fc4551af344b0b19d5e981d39132ebb45060))
* **internal:** block compose send to suppressed contacts ([37381d9](https://github.com/guillempuche/batuda/commit/37381d922f5687d4a91c36c5fc8dae4dbd2b3da2))
* **internal:** derive API origin from window.location in dev ([3e67b5e](https://github.com/guillempuche/batuda/commit/3e67b5ef20b1dbc1a61d8a74c5f5256489f0bb7b))
* **internal:** derive vite proxy target from PORTLESS_URL in worktrees ([5e13ef6](https://github.com/guillempuche/batuda/commit/5e13ef64999825aab94ccc66da818ae0179edd73))
* **internal:** enable Catalan locale in Lingui catalogs ([3280c87](https://github.com/guillempuche/batuda/commit/3280c87746b190c06ab007f8478248a7cd27660c))
* **internal:** enrich email composer and render sanitized HTML ([bf9c59a](https://github.com/guillempuche/batuda/commit/bf9c59ab3b22745d3a38f12bc4b76493ef1bb8ad))
* **internal:** integrate emails across company detail and timeline ([56012ca](https://github.com/guillempuche/batuda/commit/56012ca37924b03a862d0a637d8050ccaddd91d3))
* **internal:** make detail tabs url-addressable ([617cf5d](https://github.com/guillempuche/batuda/commit/617cf5d8367f42a7990ffe3a2fd1f080f5452987))
* **internal:** push tab changes to browser history ([b8d6766](https://github.com/guillempuche/batuda/commit/b8d6766d2b550c2eba0c93f29a8049138513c5b1))
* **internal:** rebuild tasks inbox with smart views and inline edit ([5b19fbb](https://github.com/guillempuche/batuda/commit/5b19fbb2926d2bb71ea3af25e06d2b9d29dc86fd)), closes [low/#normal](https://github.com/low/batuda/issues/normal)
* **internal:** redesign run-from-dialog flow end-to-end ([c93d92c](https://github.com/guillempuche/batuda/commit/c93d92c3c896381458eb422a6b2f597b0bd5849a))
* **internal:** restyle routes and interactions with workshop chrome ([e198129](https://github.com/guillempuche/batuda/commit/e198129614341be446def689c6615b592dfd2f91))
* **internal:** rewrite emails index with virtualized PriTable ([3bda4ab](https://github.com/guillempuche/batuda/commit/3bda4abdfbf81bb45f36c1162d81f1725348b8aa))
* **internal:** rewrite inbox settings for IMAP/SMTP preset connect ([1e5ec8b](https://github.com/guillempuche/batuda/commit/1e5ec8b5098cce1e5d9f52fafaf73e9232c7f3ca))
* **internal:** scaffold Better Auth client and route generator ([5b0cd76](https://github.com/guillempuche/batuda/commit/5b0cd767d3d03406f22d0ed8429d9dce06dbd10f))
* **internal:** scaffold floating compose dock for emails ([611b94b](https://github.com/guillempuche/batuda/commit/611b94b028544567cbe2d5ba8095b521bf905160))
* **internal:** set per-route document titles via head() + override hook ([57eabb0](https://github.com/guillempuche/batuda/commit/57eabb0dde672c49d44e353babfc5239ff2f7bb3))
* **internal:** show org spend dashboard ([cadee14](https://github.com/guillempuche/batuda/commit/cadee149a3e9c5b79a798c068c1a4c0450da2d35))
* **internal:** show suppression banner on contact card ([d7aee90](https://github.com/guillempuche/batuda/commit/d7aee90d809a83b374b6facee496f9c7bd42fd2d))
* **internal:** show upcoming meetings + Calendar tab + meeting timeline kinds on company page ([67371fe](https://github.com/guillempuche/batuda/commit/67371fea68105ae6f031eaf433c7e44052a038b1))
* **internal:** surface interaction cadence on company detail ([4ce303c](https://github.com/guillempuche/batuda/commit/4ce303c3afd66ee1ad5eff90eef01bfb4f6ccd07))
* **internal:** swap compose textarea for tiptap rich editor ([ee1abe5](https://github.com/guillempuche/batuda/commit/ee1abe547f156a4e0891cafee68dfaf9f995acc7))
* **internal:** swap email compose, reply, and footer to block editor ([ceeccae](https://github.com/guillempuche/batuda/commit/ceeccae0518ef5f2468cc15e88f6c706f7bd8611))
* **internal:** swap email route spinners for aged-paper skeletons ([ca27bae](https://github.com/guillempuche/batuda/commit/ca27baed99f5532a83dbca07fdaee65e0e42ff23))
* **internal:** widen where-panel default map zoom ([03bfe7f](https://github.com/guillempuche/batuda/commit/03bfe7fb0f573a3c845d5ebdda73ea87d44bfa4b))
* **internal:** wire email attachments through compose and thread detail ([ed6fd5f](https://github.com/guillempuche/batuda/commit/ed6fd5fb9fd531f97e15465cd75af67b48a9ff3e))
* **internal:** wire frontend to server-backed drafts and inbox footers ([8fde014](https://github.com/guillempuche/batuda/commit/8fde0143328cef50c84ceb3b537fb07cb7dba4bc))
* **internal:** wire reply and reply-all from thread detail ([13e3af4](https://github.com/guillempuche/batuda/commit/13e3af47f5db47804766b8d2ffafed6697e580a9))
* **internal:** wire Research tab into company detail ([b9d1fbd](https://github.com/guillempuche/batuda/commit/b9d1fbda1a09c6f40f5ded34f917c25d29e2abf4))
* make email schema and services provider-agnostic ([0738e8f](https://github.com/guillempuche/batuda/commit/0738e8f643a15584fa31d93a9d92a048e24f6f7e))
* promote place to first-class company state ([4323796](https://github.com/guillempuche/batuda/commit/4323796fb9bb61144446f6862fea9f8a723548cb))
* **research:** add research package with agent loop, providers, and budget ([1a1c4d7](https://github.com/guillempuche/batuda/commit/1a1c4d7f62c9026698799eccc779061823ca73f5))
* **research:** add tiered LLMs, retry harness, db caches, tool loop ([eabfa93](https://github.com/guillempuche/batuda/commit/eabfa93c06b5c2dbc0c9fb73092226704d706873))
* **research:** cap fibers with per-tenant fairness ([9ab6e9b](https://github.com/guillempuche/batuda/commit/9ab6e9b2f8d6775f18d92d0f1cb1d84da60dc370))
* scaffold Forja internal CRM with pipeline, companies, and tasks ([4a9101e](https://github.com/guillempuche/batuda/commit/4a9101eee67dfdab74a95271db55e99951aa066a))
* **server:** add clear-suppression endpoint for contacts ([857a5c0](https://github.com/guillempuche/batuda/commit/857a5c0604a1f357b56d1e9aa620093e3571c1f2))
* **server:** add recordings, local-inbox email provider, and S3 storage ([cdf40bf](https://github.com/guillempuche/batuda/commit/cdf40bf120355129d772b892f6845ef545ebf10e))
* **server:** add server-backed drafts, inbox footers, and fix inbox resolution bugs ([0d931e2](https://github.com/guillempuche/batuda/commit/0d931e2b87c5c6358b9b1d471c91214e931f047e))
* **server:** aggregate research_paid_spend by provider, user, or tool ([a4ec9c1](https://github.com/guillempuche/batuda/commit/a4ec9c14d193659060bc0b8189db2d6dbacb5db9))
* **server:** envelope listThreads, thread mutations, cc/bcc, full MCP parity ([161ffa0](https://github.com/guillempuche/batuda/commit/161ffa0a6e729386a909850b5d3f2ff41064641d))
* **server:** local inbox CRUD with provider sync, clientId tagging, MCP parity ([e4606a8](https://github.com/guillempuche/batuda/commit/e4606a8f8918cd3b820e37e3d2435288d4f2b88a))
* **server:** type page content, add get endpoint and granular MCP block tools ([bba951c](https://github.com/guillempuche/batuda/commit/bba951c0718094c1031d66744aa94ad1f3aa62b9))
* **server:** wire research endpoints, MCP tools, and provider config ([8188d70](https://github.com/guillempuche/batuda/commit/8188d705fa42e66dc71798c95c75d778da9bed20))
* split db-reset from seeding and surface seed errors ([e1cd8e3](https://github.com/guillempuche/batuda/commit/e1cd8e305c85092e5333db1d15bcddfe648d08d4))
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
* include organization_id on research_links INSERTs ([68d7e1f](https://github.com/guillempuche/batuda/commit/68d7e1f341597f6b990d0a672f4f9048e1f03d40))
* **internal:** /emails actually renders rows + surface no-active-org + seed warns ([f88d824](https://github.com/guillempuche/batuda/commit/f88d824835953f53e5ac0a7c8e775f52b4289168))
* **internal:** accumulate debounced patches and flush on Send ([30dab5b](https://github.com/guillempuche/batuda/commit/30dab5ba749385f254051eae89b0fd124b8b5f8e))
* **internal:** align research finding views with camelCase wire shape ([3fbe71b](https://github.com/guillempuche/batuda/commit/3fbe71bd116afc8e658dd7afc7236c3daf6912be))
* **internal:** close login hydration race via React 19 form action ([016d134](https://github.com/guillempuche/batuda/commit/016d134fa80e043f8955e69fdcb392a5be67ce86))
* **internal:** close sign-out hydration race via React 19 form action ([58b4c68](https://github.com/guillempuche/batuda/commit/58b4c683bccbfbd6885ee36ad7ec4dc495e3166b))
* **internal:** correct research-dialog payload + queue via form action ([7fab582](https://github.com/guillempuche/batuda/commit/7fab58255e873b1c17bd08de5696442ba38bebaf))
* **internal:** forward session cookies and trust portless TLS in SSR ([38c6ba7](https://github.com/guillempuche/batuda/commit/38c6ba7d26bfe5f561b5cbc62f8dabeaf6b2f345)), closes [#220](https://github.com/guillempuche/batuda/issues/220)
* **internal:** handle ?error= on accept-invitation page ([0488aef](https://github.com/guillempuche/batuda/commit/0488aefa6a3d3a85cf1eee5f6a45e852f5ceb4bd))
* **internal:** hard-navigate after org switch to drop atom cache ([794c97a](https://github.com/guillempuche/batuda/commit/794c97ac0528c83104d694f7234da270d8e5ea41))
* **internal:** inline role labels so Lingui extracts them ([c486872](https://github.com/guillempuche/batuda/commit/c486872e4ee16e267d99942d9ad491dd26a28a72))
* **internal:** map Lingui locale to BCP 47 for schedule-x ([b541c01](https://github.com/guillempuche/batuda/commit/b541c015589e2a2eb0b9e61ae892af14952536c4))
* **internal:** pass inboxId through to attachment staging upload ([a96eec8](https://github.com/guillempuche/batuda/commit/a96eec8715480bfaaf729a7eb4cd0a90e1c8054c))
* **internal:** proxy /auth and /v1 same-origin in dev ([d603ee9](https://github.com/guillempuche/batuda/commit/d603ee94b12ba229ac815adb83644e568255a857))
* **internal:** queue compose triggers through hydration via form action ([52a6a2e](https://github.com/guillempuche/batuda/commit/52a6a2e4f8d002d6eac53d95ef9b6de7de6f3d24))
* **internal:** render Conversations chip labels and link email rows ([a43da1a](https://github.com/guillempuche/batuda/commit/a43da1a2684f0617cb6a9c22e3eeb7afa1a7af91))
* **internal:** replace node process globals with browser-safe forms ([5338b3e](https://github.com/guillempuche/batuda/commit/5338b3e1e4ea8813a45f1f5747a5086367583935))
* **internal:** send email list pagination as numeric query params ([51d6786](https://github.com/guillempuche/batuda/commit/51d6786c1ed11d6c442a9ea9a7ea1db9235357a6))
* **internal:** tame top bar at narrow viewports ([5a417de](https://github.com/guillempuche/batuda/commit/5a417dec7120eac863e752bf488a4d6598a1f5da))
* **internal:** wrap research-run-new button in a form action ([7009a6b](https://github.com/guillempuche/batuda/commit/7009a6ba624f695aed5ca46bbdb56a29952ee007))
* **internal:** wrap Run-new schema cards with Lingui macros ([4b3fea1](https://github.com/guillempuche/batuda/commit/4b3fea174d45c0a8227a65975e64b625ac9cc266))
* **internal:** wrap server-only cookie access in createServerFn ([94e1240](https://github.com/guillempuche/batuda/commit/94e12406621eb519bfb6fcdcfeb04d9156602484))
* **internal:** wrap suppression Clear button in a form action ([d91f16e](https://github.com/guillempuche/batuda/commit/d91f16e1f9848d72cf4aae8101581e49fed5d7f3))
* order @batuda/ui exports so development condition wins ([652a66b](https://github.com/guillempuche/batuda/commit/652a66bf63c95c67af18477d88efc5bb4ff97c44))
* **research:** set organization_id on research_runs INSERTs ([8d719b9](https://github.com/guillempuche/batuda/commit/8d719b9421be9d5b6b507802e0b239d6fddf83cb))
* **research:** skip seed:% rows in orphan-runs sweep ([ddb53d9](https://github.com/guillempuche/batuda/commit/ddb53d9274f0081ffddd6b285fb2f7d92fa3d5dc))
* **server:** allow db reset to install member.primary_inbox_id FK ([1439054](https://github.com/guillempuche/batuda/commit/1439054aaa85504e5275e0e26cba2e72aa1b4780))
* **server:** map NotFound→404 on email thread + message routes ([92dfdac](https://github.com/guillempuche/batuda/commit/92dfdacd84071bac518d7689cd69c897a79dfc70))
* stabilize styled-components class hashes for SSR ([19f9abb](https://github.com/guillempuche/batuda/commit/19f9abbf19516370569d92ee44a83c42306749c9))
* **ui:** add repository field for npm provenance verification ([16cc522](https://github.com/guillempuche/batuda/commit/16cc52290af0b7cd3877cdab5c25b882661c0dd3))
* **ui:** expand PriSelect API and rebuild popup screw dots ([0c3770d](https://github.com/guillempuche/batuda/commit/0c3770d274d2b67604fc59003f01eca59c6b91df))
* **ui:** hint tab-strip overflow with edge fade ([530ec10](https://github.com/guillempuche/batuda/commit/530ec1080b4807b664c6fd8b21b20849f13dd781))
* **ui:** make PriTabs strip horizontally scrollable ([d5779f0](https://github.com/guillempuche/batuda/commit/d5779f0996c3f515e4666f0b4aefaa88285216c9))
* **ui:** restore macOS swipe-back on scroll area viewport ([5818468](https://github.com/guillempuche/batuda/commit/5818468a01e5487adff00b7e92eb43e141be2a8f))

### Refactoring

* extract packages/controllers from server ([69600df](https://github.com/guillempuche/batuda/commit/69600df2b851201825ed979936de89a8a6c38b4d))
* **internal:** drop disabled action buttons and pin company header ([5307eb3](https://github.com/guillempuche/batuda/commit/5307eb38ffab0c31687c6468e422e6247b02cdb8))
* **internal:** harden tanstack router search params ([315af56](https://github.com/guillempuche/batuda/commit/315af56770a0b9f2fe641f3e35cf803f6b2c34d3))
* **internal:** rebalance company-detail tabs from 9 to 4 ([1a1623c](https://github.com/guillempuche/batuda/commit/1a1623c05ba110163090bb4a371ea103b35b5890))
* **internal:** reflow company-detail panels on container width ([f4c6d97](https://github.com/guillempuche/batuda/commit/f4c6d97e67c50b69a8c4d6ec0eda8fb3b0f23e68))
* **internal:** replace company Profile tab with Overview dashboard ([3c6d4dd](https://github.com/guillempuche/batuda/commit/3c6d4dd5ff983cdef84d71f67559086b4f549103))
* **research:** drop any cast in orphan sweep log ([d97a0d2](https://github.com/guillempuche/batuda/commit/d97a0d224ad84b9f90f7cad7b9d9cf3c3eb36e18))
* scope CRM handlers by CurrentOrg ([98a060d](https://github.com/guillempuche/batuda/commit/98a060d1492450a6cc30e022c9417889d4642314))
* tighten comments across emails feature ([cc2ebae](https://github.com/guillempuche/batuda/commit/cc2ebae403702dd1ba95ee254963479025b6b8b6))
* **ui:** make display + headline typescale fluid ([4d96c7e](https://github.com/guillempuche/batuda/commit/4d96c7e02708a5c93d9bc158e66de3b91af95a6c))
* **ui:** revise design tokens and add workshop palette ([50982fc](https://github.com/guillempuche/batuda/commit/50982fc8297830f118c40e09635e0cf138b86b8d))
* **ui:** tighten design tokens and add font-weight ladder ([f35cafb](https://github.com/guillempuche/batuda/commit/f35cafbe1bc895ace6e3de01e0b25166015e26ce))

### Documentation

* remove Micro-SaaS service from catalogue and references ([c21a999](https://github.com/guillempuche/batuda/commit/c21a99950efd1316b5764e6a1e7badc9edebe62b))
* **ui:** clarify PriScrollArea.Content usage and gotchas ([0173be2](https://github.com/guillempuche/batuda/commit/0173be23170fec3d7032e3e64d9b49457a62640a))
* **ui:** consolidate changelog to reflect the published 2026.4.21-2 tag ([d2787a7](https://github.com/guillempuche/batuda/commit/d2787a7828d3e7a40c7154bfd4b500e6da6882ba))

### Tests

* cover Slice A/B/D auto-task and dashboard paths ([c1cba86](https://github.com/guillempuche/batuda/commit/c1cba861d12b657ced6b5f684badd570298d10c7))
* cover webhook org resolution + research_runs RLS + GET /companies/:slug 404 ([62b9ecb](https://github.com/guillempuche/batuda/commit/62b9ecb8880b76562a6c0a7e20412e0ef39329a7))
* **internal:** adapt company-detail e2e to the 9-to-4 tab rebalance ([fe142d8](https://github.com/guillempuche/batuda/commit/fe142d80aa22b166eced8e88d5b4de3a450ea3cd))
* **internal:** add auth-setup + sign-out + quick-capture e2e suite ([7a6e0f1](https://github.com/guillempuche/batuda/commit/7a6e0f19284746440bd61e6cc1472b70ea2e34d6))
* **internal:** add e2e for company-detail Overview tab ([c3e96c8](https://github.com/guillempuche/batuda/commit/c3e96c860f6382752160c4b5dd23dfba00254679))
* **internal:** add inbound-attachment + ingest-roundtrip e2e specs ([d3850ea](https://github.com/guillempuche/batuda/commit/d3850eafb6e81f4ba924b9d2ea3bd7349328629b))
* **internal:** add Playwright e2e harness and sign-in spec ([8d2c8b6](https://github.com/guillempuche/batuda/commit/8d2c8b654398919cb94d241b1ee2342f68fdf3bf))
* **internal:** add reply and thread-render e2e specs ([7e4bcff](https://github.com/guillempuche/batuda/commit/7e4bcff1d417c4849395dc78fc6d04f80b18dea7))
* **internal:** add rich-compose and inbox-listing e2e specs ([7ebfa3c](https://github.com/guillempuche/batuda/commit/7ebfa3ca683178583e4041d33e7988fac6ad1bc6))
* **internal:** cover auth lifecycle and session persistence ([77e49ea](https://github.com/guillempuche/batuda/commit/77e49ead60e9bc9c9eea592d0252d1bd3145be9f))
* **internal:** cover boss + app_service superadmin personas ([0dee569](https://github.com/guillempuche/batuda/commit/0dee5699f3192c59f9b8f86e3ad94953ad7fd2c5))
* **internal:** cover compose attachment and footer via mailpit ([d705a41](https://github.com/guillempuche/batuda/commit/d705a41cc5f8961862b075411c41883ba989a1b1))
* **internal:** cover invitation accept end-to-end ([ae96624](https://github.com/guillempuche/batuda/commit/ae9662486a2f1ef9a580d966a7da391eb583f729))
* **internal:** cover org switcher, settings, and cross-org isolation ([70a6c2d](https://github.com/guillempuche/batuda/commit/70a6c2d44511da1652e1ed61b76c226af42fd0db))
* **internal:** cover org-switch data scoping, reload, and no-op ([9a1f737](https://github.com/guillempuche/batuda/commit/9a1f73735da1b43ccfabf53fefdb307dc5973800))
* **internal:** cover research findings + Run-new-research e2e ([ef93cdd](https://github.com/guillempuche/batuda/commit/ef93cddeca6a8cba28b82b0b7e20cbe572d3cc7c))
* **internal:** cover send-email round-trip via mailpit ([9fcaa7d](https://github.com/guillempuche/batuda/commit/9fcaa7d0e72284d9eb37a41ac80850858af83470))
* **internal:** cover the contact suppression banner end-to-end ([997987b](https://github.com/guillempuche/batuda/commit/997987bd9688993780aedb88fca31cee105088d9))
* **internal:** de-flake sign-out, org-switch and research e2e ([23e6248](https://github.com/guillempuche/batuda/commit/23e624809f1d78a969e5aed146588bc3b506c55d))
* **internal:** land research e2e on ?tab=research, drop tab clicks ([3150901](https://github.com/guillempuche/batuda/commit/31509017063af1825f642eff6fc3650a5a179ec8))
* **internal:** reset inbox grant_status before each compose-send test ([aab33d4](https://github.com/guillempuche/batuda/commit/aab33d452748e63ac5c9785a800d3798f15abb6c))
* **internal:** scope settings-spend beforeEach to the owner-only block ([923b0f8](https://github.com/guillempuche/batuda/commit/923b0f848843c258773ec4f2483a7270ee4b2f4d))
* **internal:** tighten attachment and footer e2e isolation ([5628424](https://github.com/guillempuche/batuda/commit/56284247dc73ac6341f3b8080beb3ec694119804))
* **mail-worker:** add IMAP-roundtrip integration test against live mailpit ([b732dc0](https://github.com/guillempuche/batuda/commit/b732dc0ec5f1a57fdf4d7fc6b4f47cfd5e7b613d))
* **research:** add bdd suites for harness, caches, and service ([2cd7a6e](https://github.com/guillempuche/batuda/commit/2cd7a6e5d86315eb36980733777b20fb9b7459e2))

### CI/CD

* add i18n catalog check to pre-commit ([dc0d8a2](https://github.com/guillempuche/batuda/commit/dc0d8a23d3bed6c87fdd6fe221cad5c26d1926d2))
* **deploy:** harden Dockerfiles with non-root user and lefthook fix ([2116ac6](https://github.com/guillempuche/batuda/commit/2116ac636b6837774935b54cbf98838e3851e38f))
* **deploy:** harden rolling updates for zero-downtime deploys ([ffb4115](https://github.com/guillempuche/batuda/commit/ffb4115bbd7517f8ff04af08008bc3450924c388))
* drop jsr publishing and rename server dockerfile filters ([5b29816](https://github.com/guillempuche/batuda/commit/5b29816c1e8808a23ebeda33ed26e719da9ceb7f))
* **release:** ui v2026.4.21 ([226d924](https://github.com/guillempuche/batuda/commit/226d9240551f2d264da3ed5660f4e89a0ad99f5d))
* **release:** ui v2026.4.21-1 ([8c8e6b8](https://github.com/guillempuche/batuda/commit/8c8e6b8231a21e0592e6965db5a53c6a47d0fc7a))
* **release:** ui v2026.4.21-2 ([b5b1ceb](https://github.com/guillempuche/batuda/commit/b5b1ceb107d3f9f77aa6d33691bc3f4318110f69))
* **release:** ui v2026.5.2 ([ecaf156](https://github.com/guillempuche/batuda/commit/ecaf156e1621061290ef032108a8434c59e0ed74))
* **release:** ui v2026.5.2-1 ([7d0ddff](https://github.com/guillempuche/batuda/commit/7d0ddff01043cde6182c6fba32e5f426c70e8d39))
* rename deploy targets and publish scope to batuda ([6ad05e3](https://github.com/guillempuche/batuda/commit/6ad05e399f4aa2b9def1417dc9803e587f5afc79))
* rename storage bucket to assets and deploy service to web ([e97c4c2](https://github.com/guillempuche/batuda/commit/e97c4c2fad495c0a2d063b5fd2b1d7694b300245))

### Chores

* bump portless to 0.10.2 and drop manual CA cert workaround ([f0a7a80](https://github.com/guillempuche/batuda/commit/f0a7a80a39245f8a24fc1283a3d424038725fccc)), closes [vercel-labs/portless#220](https://github.com/vercel-labs/portless/issues/220)
* bump tsdown to 0.21.7 ([efc3ee3](https://github.com/guillempuche/batuda/commit/efc3ee3672825fe56ddd72fbb6fecb1c9b427f00))
* extract marketing app and publish @engranatge/ui ([56116a0](https://github.com/guillempuche/batuda/commit/56116a0d58e08c9d5a17cf33bd99b6fa9a286b39))
* finish batuda rename in docs seeds tests and i18n ([d59f344](https://github.com/guillempuche/batuda/commit/d59f344fb83b4519bdd78652934afbba624be284))
* integrate portless dev proxy with turbo dev task ([b82602e](https://github.com/guillempuche/batuda/commit/b82602effde85659d6602e3197290741e24d7ab9))
* **internal:** add streamdown markdown viewer for research briefs ([e50bd55](https://github.com/guillempuche/batuda/commit/e50bd55781bfc7e180cce0781e579b66ba54f96f))
* **internal:** add tsconfig.node.json for config file type checks ([73b24a9](https://github.com/guillempuche/batuda/commit/73b24a97292a20f65dbd66b9dce167437706fc82))
* **internal:** drop AgentMail sync action from inboxes page ([5979c33](https://github.com/guillempuche/batuda/commit/5979c33cc3ff9188a1fd2c3d70649cc9d2244140))
* **internal:** extract and compile i18n catalog for emails feature ([6dff1f8](https://github.com/guillempuche/batuda/commit/6dff1f8e4633297ddb34d051f053e4f8f9db2b80))
* **internal:** refresh lingui catalog line references ([277bb11](https://github.com/guillempuche/batuda/commit/277bb11ead017dcafea44431c102ec6f724ae696))
* **internal:** refresh lingui catalog line references ([e5c2a48](https://github.com/guillempuche/batuda/commit/e5c2a486ac97825b82775ba3657a29962aad359a))
* **internal:** refresh lingui po line references ([0be5979](https://github.com/guillempuche/batuda/commit/0be5979d34d21cc5a2c242bcd23be20e8c343ac6))
* **internal:** regenerate i18n catalogs for the company-detail UX overhaul ([1d53e38](https://github.com/guillempuche/batuda/commit/1d53e389f32e0a470e307835f573ba93ce9b9010))
* **internal:** regenerate i18n po files after compose-form edit ([ad2433c](https://github.com/guillempuche/batuda/commit/ad2433c4b4260ecfd859a415d30f921556a5c616))
* **internal:** regenerate i18n po files after slice 4 fixes ([0101ca1](https://github.com/guillempuche/batuda/commit/0101ca140e5df078767b60388b87e0215e82fd49))
* **internal:** regenerate i18n po files after slice C edits ([00edf44](https://github.com/guillempuche/batuda/commit/00edf44b5a91626d3c7d4dde46f833bf20eef9c0))
* **internal:** regenerate i18n po files after suppression form-action edit ([769a6b2](https://github.com/guillempuche/batuda/commit/769a6b29783f73b711e6890856cee409c7a6a5e1))
* **internal:** regenerate i18n po files and route tree ([e59aa8e](https://github.com/guillempuche/batuda/commit/e59aa8e030c3fbcade95920c7c641f63b004036a))
* prune dead it.todo scaffolds across the test suite ([85bb00f](https://github.com/guillempuche/batuda/commit/85bb00f6aba8b3ba4e234602baf2f744b0871715))
* rename tool to batuda and isolate engranatge as tenant ([f090b60](https://github.com/guillempuche/batuda/commit/f090b6085e25ef2becb4d188ca9a6199bc6474ae))
* route @batuda/ui imports through dist by default ([30311b4](https://github.com/guillempuche/batuda/commit/30311b43ea1c75d39a0b928c426eaad729735b64))
* switch dev scripts to portless run for worktree-aware routing ([3647eed](https://github.com/guillempuche/batuda/commit/3647eed7478d4d6a20bfae345a6f85d0fe44bf05))

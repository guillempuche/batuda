# The getting-started message

The message a new organization's first admin receives once their account exists. English
only. Print it in the conversation, filled in and ready to paste — never send it anywhere,
and say when handing it over that it still needs sending, since production emails nothing.

Placeholders to replace:

| Placeholder      | Value                                                    |
| ---------------- | -------------------------------------------------------- |
| `{{FIRST_NAME}}` | The person's first name                                  |
| `{{ORG_NAME}}`   | The organization display name, exactly as it was created |
| `{{APP_URL}}`    | `https://batuda.co`                                      |
| `{{MCP_URL}}`    | `https://api.batuda.co/mcp`                              |

Keep the **If you work in more than one place** section only when that person actually
belongs to more than one organization (`pnpm cli data members`). Drop it otherwise.

Trim rather than pad. If they only bought research, cut the companies-and-people section;
if they are not connecting a chat yet, cut everything after sign-in and say so when handing
the message over.

## Writing the examples

The three example prompts below are the part that has to change every time. They are what
tells a new customer whether this was built for their work or somebody else's, so write them
from what the organization actually sells, to whom, and where — the reading done in §2 of the
skill. The versions here are a worked example in one market, not text to paste.

Three rules for the research example, which is the one that matters most:

- **Ask for many companies, not one.** The product's job is finding a set worth talking to,
  so the example has to look like a search, not a lookup of a company they already knew about.
- **No invented filters.** Head count, revenue bands and the like read as restrictions the
  customer never asked for. Say what kind of company they want; leave the rest open.
- **A country only if theirs is a market.** Name one when the organization plainly works in
  a single country. When they sell anywhere, say nothing about geography at all.

The standing-instructions example follows from the same reading: it should be the thing they
would want said about every company, every time — not a filter.

---

## The message

Hi {{FIRST_NAME}},

Your account is ready, and so is {{ORG_NAME}}. Here is everything you need for the first
half hour.

**Signing in.** Go to {{APP_URL}}/login and type your email address. You get a link back
that signs you in — no password to remember or lose. The link lasts five minutes, so ask
for it when you are ready to use it.

**Connecting your chat.** This is the part that makes the difference: your own ChatGPT or
Claude can read and write your customer data directly, in conversation. Add this address as
a connector:

{{MCP_URL}}

- **ChatGPT** — Settings → Connectors → turn on Developer mode → add the address above and
  choose OAuth. Needs a Plus, Pro, Business, Enterprise or Edu account.
- **Claude.ai** — Settings → Connectors → Add custom connector → paste the address above.

Either way it asks you to approve it once, in your own browser, with your own sign-in. If
you also code, {{APP_URL}}/settings/mcp has ready-made snippets for Claude Code, Cursor, VS
Code and the rest.

**Telling it how you work.** Say once what you always want, and ask it to remember:

> "Whenever you research a company, always tell me who owns engineering and whether their
> app already works offline. Save that."

It keeps that and applies it to later work without being reminded. The same works for email
— tell it how you want messages written once and it follows that from then on. To see what
it is following, just ask — *"what are you following for research?"* You can read or edit the
same list at {{APP_URL}}/settings/organization/templates, shared with your team, so anything
you change there changes it for everyone. Something that is only yours lives at
{{APP_URL}}/settings/profile/templates.

**Asking it to research.** Point it at a whole set of companies, not one at a time:

> "Find companies building mobile apps for technicians and drivers who work where the signal
> drops. Tell me who owns engineering at each."

It goes off and reads each company's own site, public records where a country keeps them, and
the web. That takes a few minutes — you can keep working. It comes back with what it
found and where each fact came from, and it never changes your records on its own: it
proposes, you accept. The proposals are waiting for you under Research at {{APP_URL}}
whenever you want to look.

**Adding companies and people.** Plain language works:

> "Add these three as prospects: Rentokil, Chubb Fire & Security, Verisure."

> "Add Dana Whitfield as VP of Engineering at Rentokil, dana@rentokil.com."

**If you work in more than one place.** An assistant works in one organization at a time.
When you approve the connector it ticks every organization you belong to, and then nothing
works until you choose. Go to {{APP_URL}}/settings/mcp/connections → **Change
organizations** → tick just {{ORG_NAME}} → Save. If you need both, add the connector a
second time and point that one at the other organization.

**When something looks off**, tell me. Reply here and I will look at it the same day.

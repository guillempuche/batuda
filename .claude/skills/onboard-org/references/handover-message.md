# The getting-started message

The message a new organization's first admin receives once their account exists. English
only. Print it in the conversation, filled in and ready to paste — never send it anywhere,
and say when handing it over that it still needs sending, since production emails nothing.

Placeholders to replace:

| Placeholder                | Value                                                    |
| -------------------------- | -------------------------------------------------------- |
| `{{FIRST_NAME}}`           | The person's first name                                  |
| `{{ORG_NAME}}`             | The organization display name, exactly as it was created |
| `{{APP_URL}}`              | `https://batuda.co`                                      |
| `{{MCP_URL}}`              | `https://api.batuda.co/mcp`                              |
| `{{INSTRUCTIONS_EXAMPLE}}` | Written per customer — see *Writing the four examples*   |
| `{{RESEARCH_EXAMPLE}}`     | Written per customer — see *Writing the four examples*   |
| `{{COMPANIES_EXAMPLE}}`    | Written per customer — see *Writing the four examples*   |
| `{{CONTACT_EXAMPLE}}`      | Written per customer — see *Writing the four examples*   |

Keep the **If you work in more than one place** section only when that person actually
belongs to more than one organization (`pnpm cli data members`). Drop it otherwise.

Trim rather than pad. If they only bought research, cut the companies-and-people section;
if they are not connecting a chat yet, cut everything after sign-in and say so when handing
the message over.

## Writing the four examples

**There is no stock wording for these.** The four `{{…}}_EXAMPLE` slots are written fresh for
each customer out of the §2 research, and a message that reaches somebody with generic
examples in it has failed at the one thing it is for. A new customer judges whether this tool
understands their work by whether the sample prompts look like something they would type. A
prospecting tool that opens with somebody else's prospects answers that question badly.

Write all four in the customer's own market — the companies they sell to, the roles they sell
to, the words they would use:

- **`{{INSTRUCTIONS_EXAMPLE}}`** — the thing they would want said about *every* company, every
  time. A standing want, not a filter: "always tell me X and Y", not "only companies under 50
  people". End it with "Save that." so the example teaches the habit.
- **`{{RESEARCH_EXAMPLE}}`** — a request for **many companies, not one**. This is the one that
  matters most. It has to read as a search for a set worth talking to, not a lookup of a
  company they already knew about. No invented limits on size or revenue: say what kind of
  company they want and leave the rest open. Name a country only when their market plainly is
  one country; when they sell anywhere, say nothing about geography.
- **`{{COMPANIES_EXAMPLE}}`** — three real companies that would genuinely be on their list.
  Not their existing customers, which reads as careless, and not household names picked for
  recognition.
- **`{{CONTACT_EXAMPLE}}`** — a person at one of those three, with the job title that actually
  decides in their market, and an email in that company's domain. The person is a stand-in; the
  role and the company are not.

Worked illustration for a company that sells cleaning supplies to restaurants in Girona —
included to show the shape, **never to paste**:

> Instructions: "Whenever you research a company, always tell me how many covers they do and
> whether they have their own kitchen. Save that."
> Research: "Find restaurants and hotel kitchens around Girona that cook on site. Tell me who
> handles buying at each."
> Companies: "Add these three as prospects: Can Roca, Hotel Ultònia, Fonda Bruguera."
> Contact: "Add Marta Puig as head chef at Fonda Bruguera, marta@fondabruguera.cat."

If §2 came up too thin to write these honestly, say so when handing the message over instead
of inventing companies — a made-up prospect list is worse than none.

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

> {{INSTRUCTIONS_EXAMPLE}}

It keeps that and applies it to later work without being reminded. The same works for email
— tell it how you want messages written once and it follows that from then on. To see what
it is following, just ask — *"what are you following for research?"* You can read or edit the
same list at {{APP_URL}}/settings/organization/templates, shared with your team, so anything
you change there changes it for everyone. Something that is only yours lives at
{{APP_URL}}/settings/profile/templates.

**Asking it to research.** Point it at a whole set of companies, not one at a time:

> {{RESEARCH_EXAMPLE}}

It goes off and reads each company's own site, public records where a country keeps them, and
the web. That takes a few minutes — you can keep working. It comes back with what it
found and where each fact came from, and it never changes your records on its own: it
proposes, you accept. The proposals are waiting for you under Research at {{APP_URL}}
whenever you want to look.

**Adding companies and people.** Plain language works:

> {{COMPANIES_EXAMPLE}}

> {{CONTACT_EXAMPLE}}

**If you work in more than one place.** An assistant works in one organization at a time.
When you approve the connector it ticks every organization you belong to, and then nothing
works until you choose. Go to {{APP_URL}}/settings/mcp/connections → **Change
organizations** → tick just {{ORG_NAME}} → Save. If you need both, add the connector a
second time and point that one at the other organization.

**When something looks off**, tell me. Reply here and I will look at it the same day.

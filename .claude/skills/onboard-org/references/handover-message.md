# The getting-started message

The message a new organization's first admin receives once their account exists. English
only. Print it in the conversation, filled in and ready to paste — never send it anywhere.

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

**Telling it how you work.** Say your standing rules once and ask it to remember them:

> "From now on, when you research a company, I only care about firms under 50 people in
> Catalonia, and I always want the owner's email if you can find it. Save that."

It keeps those rules and applies them to later work without being reminded. To see what it
is following, just ask — *"what rules are you using for research?"* You can read or edit the
same list at {{APP_URL}}/settings/organization/templates, shared with your team. A rule that
is only yours lives at {{APP_URL}}/settings/profile/templates.

**Asking it to research.** Name a company and say what you want to know:

> "Research Forn Sant Jordi in Girona. Do they fit what I sell, and who decides?"

It goes off and reads the company's own site, public records where a country keeps them, and
the web. That takes a few minutes — you can keep working. It comes back with what it
found and where each fact came from, and it never changes your records on its own: it
proposes, you accept. The proposals are waiting for you under Research at {{APP_URL}}
whenever you want to look.

**Adding companies and people.** Plain language works:

> "Add these three as prospects: Cal Met, Forn Sant Jordi, Vins del Ter. All bakeries in
> Girona."

> "Add Marta Puig as the owner at Cal Met, marta@calmet.cat."

**If you work in more than one place.** An assistant works in one organization at a time.
When you approve the connector it ticks every organization you belong to, and then nothing
works until you choose. Go to {{APP_URL}}/settings/mcp/connections → **Change
organizations** → tick just {{ORG_NAME}} → Save. If you need both, add the connector a
second time and point that one at the other organization.

**When something looks off**, tell me. Reply here and I will look at it the same day.

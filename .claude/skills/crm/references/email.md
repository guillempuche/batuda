# Sending email

`send_email`, `reply_email` and `manage_email_draft(action: "send")` all answer with one of three outcomes.
Read the `_tag` — none of them throws, so a send that never went out looks like a success unless you look.

| `_tag`       | What happened                                                         |
| ------------ | --------------------------------------------------------------------- |
| `sent`       | It went out. Carries `messageId` and `threadId`.                      |
| `suppressed` | Refused outright: the address once hard-bounced or reported spam.     |
| `cancelled`  | Nothing was sent, because a confirmation was needed and not obtained. |

## What is a hard block and what is not

`suppressed` is the real block.
It is asked of the address rather than of whoever holds it, across the whole organisation, and it applies to every way of sending — including a person composing in the web app.
The only way back is `update_contact` with `clear_email_suppression=true`, after the person confirms their address is good again.

`cancelled` is a soft guard and only ever applies to an assistant.
It fires when:

- an address being written to carries a deliverability verdict of `undeliverable` or `risky`, or a word the vocabulary does not recognise; or
- (replies only) the thread already has `EMAIL_AGENT_SOFT_THREAD_LIMIT` outbound messages — three by default — and this reply would be one more.

The `reason` says which of those it was, and says plainly when the client had no way to put the question to anybody at all.
Neither Claude.ai nor ChatGPT can show a confirmation prompt today, so through those the answer is always the second kind.

## What does not stop a send

A deliverability verdict is not a verdict on the address unless it says something against it:

| Verdict         | Stops a send | Why                                                                      |
| --------------- | ------------ | ------------------------------------------------------------------------ |
| `deliverable`   | No           | A mailbox answered.                                                      |
| `catch_all`     | No           | The domain answers to every name, so the check learned nothing here.     |
| `unknown`       | No           | A check ran and settled nothing — the same thing no verdict says.        |
| *(no verdict)*  | No           | Nobody has checked. Most addresses on file are this.                     |
| `risky`         | Yes          | Something is off: a full mailbox, a disposable domain, a stalled server. |
| `undeliverable` | Yes          | The mailbox is not there.                                                |
| anything else   | Yes          | The column takes free text, so an unrecognised word is unvetted.         |

## Seeing it coming

Read `verification` on the channels a contact carries (`list_contacts`) before composing, rather than discovering it on the send.
A batch is where this matters: finding out one address at a time, after writing each message, wastes the writing.

Note that the verdict is read from **the address being written to**, not from the person — so a contact with a cleared default address and a second address marked `risky` will still stop a send addressed to the second one.

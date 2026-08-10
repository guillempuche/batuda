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

## Getting a held-back send out

When a verdict does stop a send and you know the address is fine, vouch for it:

```
manage_contact_channels({ action: "vouch", contact_id, channel_id, note: "confirmed on the phone" })
manage_company_channels({ action: "vouch", company_id, channel_id, note: "..." })
```

That records a person standing behind the address, and the guard stops asking about it.
It does not touch what the check found — the two are different claims, and only one of them is something a human can make.
It settles the address rather than the row, so vouching once covers the same mailbox wherever else it is recorded.

You do not have to hunt for the `channel_id`: a stopped send names the exact call that lifts it in its `reason`.

`action: "unvouch"` takes a vouch back when somebody changes their mind. It only ever lifts a vouch — it never clears a bounce.

A vouch is refused on an address that hard-bounced or reported spam.
That block is real, it lives in the same place a vouch is written, and lifting it by vouching would quietly re-open the address for the whole organisation.
Use `update_contact` with `clear_email_suppression=true` once the person confirms the address works again — that returns it to "nobody has checked", not to "somebody vouched".

## The thread message count

`reply_email` also stops when a thread already holds several outbound messages (`EMAIL_AGENT_SOFT_THREAD_LIMIT`, three by default).
That one is not about an address, so there is nothing to vouch for: pass `acknowledge_thread_length: true` on the reply when the person has said to keep going.
It answers only the count — an address with something recorded against it still stops the send — and nothing is remembered, so a later reply on the same thread asks again.

## Seeing it coming

Read `verification` on the channels a contact carries (`list_contacts`) before composing, rather than discovering it on the send.
A batch is where this matters: finding out one address at a time, after writing each message, wastes the writing.

Note that the verdict is read from **the address being written to**, not from the person — so a contact with a cleared default address and a second address marked `risky` will still stop a send addressed to the second one.

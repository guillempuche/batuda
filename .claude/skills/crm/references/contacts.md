# Contacts and their channels

A contact is a person at a company. A channel is one way of reaching them — an
email, a phone, a LinkedIn URL. One person can hold several of a kind.

## Putting a wrong address right

Use `manage_contact_channels`. `update_contact`'s `channels[]` **only ever adds
or refreshes**: an address corrected there leaves the old one beside it, and the
person ends up holding both.

| Want to                         | action                                                                              |
| ------------------------------- | ----------------------------------------------------------------------------------- |
| See what is on file             | `list`                                                                              |
| Add one                         | `add` with `kind` + `value`, and a `label` when there is more than one of that kind |
| Correct, rename or re-elect one | `update` with `channel_id` and only the fields to change                            |
| Take one off                    | `remove` with `channel_id`                                                          |

Two things it will refuse rather than guess at:

- **An address the person already holds.** Renaming one onto another is a
  collision, not a merge — merging would delete a row nobody named. Remove the
  spare instead.
- **An address that could never be one of its kind** — a phone number in an
  email row, and the same the other way round.

`label: null` takes a name back off. `is_primary: true` marks the one to use
when nothing else says; the primary email is the address mail is sent to, and
removing it hands that over to the oldest one left of the same kind.

## Do not delete the person to fix an address

`delete_contact` detaches every interaction, proposal and email thread ever
logged against them — those rows survive with `contact_id = NULL`, so the
history stays but stops naming anybody. Their channels go with them, including
any record of an address having bounced.

## Leaving somebody with no email

A later research run and an inbound reply both recognise a person by their
address first, falling back to their name. A contact with no email may be
created a second time as a duplicate.

## How far an address is trusted

`verification` on an email channel is what a deliverability check found:
`deliverable`, `risky`, `catch_all`, `undeliverable`, `unknown`.

Not all of them mean the same thing. `risky` and `undeliverable` say something
against the address. `catch_all` means the domain answers to every name, so the
check learned nothing about this particular mailbox, and `unknown` says what no
verdict at all says. Which of them stop a send is the sending side's rule — read
it there rather than assuming, because it has changed.

A tool call may only ever **lower** it: `risky` or `undeliverable` to record
doubt, `unknown` for a check that came back with nothing, or **null** to take a
verdict back off entirely. Null is the honest record for a word that was written
down rather than found out — it says nobody has checked, which is different from
a check that settled nothing. Saying an address is good is something a check
finds out by reaching the mailbox, so `deliverable` is refused from a caller. A
later check can raise it again.

To get a send out that a verdict is holding back, use `action: "vouch"` rather
than trying to argue with the verdict. It records that a person stands behind the
address and leaves the check's own finding alone — the two are different claims,
and only one of them is something a human can make. It is refused on an address
that hard-bounced or reported spam; see `references/email.md`.

This is a different thing from a bounce. `status` records what happened *after*
a send; `clear_email_suppression` on `update_contact` is what resets that.

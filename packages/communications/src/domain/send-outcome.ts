import { Data } from 'effect'

// A message the transport handed to the wire. `raw` is the exact bytes sent, so
// the same payload can be mirrored into a channel's "sent" store.
export class Sent extends Data.TaggedClass('Sent')<{
	readonly messageId: string
	readonly raw: Uint8Array
}> {}

// The result of a successful send. An open union so a future channel can add
// its own outcome. Suppression isn't modeled here — it's a policy pre-check
// that fails before the transport is reached, never a send outcome.
export type SendOutcome = Sent

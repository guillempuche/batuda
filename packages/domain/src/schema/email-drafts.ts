import { Schema } from 'effect'
import { Model } from 'effect/unstable/schema'

export const EmailDraftId = Schema.String.pipe(Schema.brand('EmailDraftId'))

// The draft shape the API hands back: recipient lists, the editor block
// tree, and threading hints. `subject` / `clientId` / `inReplyTo` /
// `threadLinkId` are present only when set. `createdAt` / `updatedAt` arrive
// as Postgres dates and encode to ISO strings on the wire.
export class EmailDraft extends Model.Class<EmailDraft>('EmailDraft')({
	// App-generated `draft_<uuid>` text id, not a database default.
	draftId: EmailDraftId,
	inboxId: Schema.String,
	to: Schema.Array(Schema.String),
	cc: Schema.Array(Schema.String),
	bcc: Schema.Array(Schema.String),
	bodyJson: Schema.Unknown,
	subject: Schema.optional(Schema.String),
	clientId: Schema.optional(Schema.String),
	inReplyTo: Schema.optional(Schema.String),
	// What the draft answers, handed back so threading a caller set can be
	// read again: without it, a draft that failed to attach to a conversation
	// reads exactly like one that attached.
	mode: Schema.Literals(['new', 'reply']),
	threadLinkId: Schema.optional(Schema.String),
	createdAt: Model.DateTimeInsertFromDate,
	updatedAt: Model.DateTimeUpdateFromDate,
}) {}

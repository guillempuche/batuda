import { Schema } from 'effect'
import { Model } from 'effect/unstable/schema'

export const InboxFooterId = Schema.String.pipe(Schema.brand('InboxFooterId'))

// A named signature block appended to an inbox's outbound mail. `bodyJson`
// is the editor block tree (derived to html/text on send). One footer per
// inbox may be the auto-appended default.
export class InboxFooter extends Model.Class<InboxFooter>('InboxFooter')({
	id: Model.GeneratedByDb(InboxFooterId),
	organizationId: Schema.String,
	inboxId: Schema.String,
	name: Schema.String,
	bodyJson: Schema.Unknown,
	isDefault: Schema.Boolean,
	createdAt: Model.DateTimeInsertFromDate,
	updatedAt: Model.DateTimeUpdateFromDate,
}) {}

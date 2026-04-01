import { Schema } from 'effect'
import { Model } from 'effect/unstable/schema'

export const ProposalId = Schema.String.pipe(Schema.brand('ProposalId'))

export class Proposal extends Model.Class<Proposal>('Proposal')({
	id: Model.Generated(ProposalId),
	companyId: Schema.String,
	contactId: Schema.NullOr(Schema.String),

	status: Schema.String,
	// values: draft | sent | viewed | negotiating | accepted | rejected | expired
	title: Schema.String,

	lineItems: Schema.Unknown,
	// [{product_id, qty, price, notes}]
	totalValue: Schema.NullOr(Schema.String),
	// numeric returns string from PG
	currency: Schema.NullOr(Schema.String),

	sentAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
	expiresAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
	respondedAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
	notes: Schema.NullOr(Schema.String),
	metadata: Schema.NullOr(Schema.Unknown),

	createdAt: Model.DateTimeInsertFromDate,
	updatedAt: Model.DateTimeUpdateFromDate,
}) {}

import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api'

import { Interaction } from '@batuda/domain'

import { NotFound } from '../errors'
import { OrgMiddleware } from '../middleware/org'
import { SessionMiddleware } from '../middleware/session'
import { PaginatedList, pageQuery } from '../pagination'
import { UuidParam } from '../uuid-param'

// A follow-up date as the web form sends it ("2026-10-20") or as a full
// timestamp. Text no date can be read from is refused here; past this point it
// would become an invalid date the database refuses, answered as a breakage.
const DateText = Schema.String.check(
	// ISO 8601 only: the engine's own date reading also takes "1" or "March 7",
	// which the database may then refuse.
	Schema.isPattern(
		/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/u,
	),
	Schema.makeFilter(text => !Number.isNaN(Date.parse(text)), {
		expected: 'a date',
	}),
)

const CreateInteractionInput = Schema.Struct({
	companyId: UuidParam,
	contactId: Schema.optional(UuidParam),
	date: Schema.optional(Schema.DateTimeUtc),
	durationMin: Schema.optional(Schema.Int),
	channel: Schema.String,
	direction: Schema.Literals(['inbound', 'outbound']),
	type: Schema.String,
	subject: Schema.optional(Schema.String),
	summary: Schema.optional(Schema.String),
	outcome: Schema.optional(Schema.String),
	nextAction: Schema.optional(Schema.String),
	nextActionAt: Schema.optional(DateText),
	metadata: Schema.optional(Schema.Unknown),
})

export const InteractionsGroup = HttpApiGroup.make('interactions')
	.add(
		HttpApiEndpoint.get('list', '/interactions', {
			query: {
				companyId: Schema.optional(UuidParam),
				...pageQuery,
			},
			success: PaginatedList(Interaction.json),
		}),
	)
	.add(
		HttpApiEndpoint.post('create', '/interactions', {
			payload: CreateInteractionInput,
			success: Interaction.json,
			// The company, or the contact, is not one this organisation can see.
			error: NotFound.pipe(HttpApiSchema.status(404)),
		}),
	)
	.middleware(SessionMiddleware)
	.middleware(OrgMiddleware)
	.prefix('/v1')

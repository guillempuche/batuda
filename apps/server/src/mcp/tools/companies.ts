import { DateTime, Effect, Schema } from 'effect'
import { Tool, Toolkit } from 'effect/unstable/ai'
import { SqlClient } from 'effect/unstable/sql'

import { CompanyDetail, CurrentOrg } from '@batuda/controllers'
import {
	COMPANY_PRIORITIES,
	COMPANY_STATUSES,
	Company,
	CompanyCountry,
	CompanyEmail,
	CompanyGoogleMapsUrl,
	CompanyInstagram,
	CompanyLatitude,
	CompanyLinkedin,
	CompanyLongitude,
	CompanyPhone,
	CompanyPriority,
	CompanySizeRange,
	CompanySlug,
	CompanyStatus,
	CompanyWebsite,
	HandSetVerificationVerdict,
} from '@batuda/domain'

import {
	addChannel,
	deleteChannel,
	deleteSubjectChannels,
	patchChannel,
	subjectChannelsOf,
} from '../../services/channels'
import { CompanyService } from '../../services/companies'
import { findDuplicateCompanies } from '../../services/company-duplicates'
import {
	geocodeCompany,
	updateCompanyRegeocoding,
} from '../../services/company-geocoding'
import { listIndustries } from '../../services/company-industries'
import { recordStageChange } from '../../services/company-stage-change'
import { Geocoder } from '../../services/geocoder'
import {
	CompanyDeleted,
	CompanyRestored,
	TimelineActivityService,
} from '../../services/timeline-activity'
import { CurrentUser } from '../current-user'
import { ToolMessage } from '../tool-message'
import { McpPageLimit, McpPageOffset, PageResult, toPage } from './_result'

const REQUEST_DEPENDENCIES = [CurrentOrg, CurrentUser]

const SearchCompanies = Tool.make('search_companies', {
	description:
		'Filter companies by status, country (ISO 3166-1 alpha-2, e.g. US/ES/DE), industry, priority, search query, the research fit verdict (strong_fit / possible_fit / weak_fit / no_fit), a fit criterion the company passed (matched loosely against the criterion text), or a geographic bounding box. The box is any subset of min_lat/max_lat/min_lng/max_lng (decimal degrees); each bound is applied independently and only matches companies with stored coordinates. Returns summaries (including latitude/longitude) — call get_company for full details. `hasMore` says whether more matched than were returned — read it before saying how many there are, and ask again with a larger `offset` if it is true.',
	parameters: Schema.Struct({
		status: Schema.optional(Schema.String),
		country: Schema.optional(Schema.String),
		industry: Schema.optional(Schema.String),
		priority: Schema.optional(Schema.Number),
		product_fit: Schema.optional(Schema.String),
		fit_verdict: Schema.optional(Schema.String),
		fit_criterion_passed: Schema.optional(Schema.String),
		query: Schema.optional(Schema.String),
		deleted: Schema.optional(Schema.Literals(['only', 'include'])).annotate({
			description:
				"Which companies to look at. Omit for the ones in use, 'only' for the ones that were deleted — that is how you find one again to restore it, since a deleted company answers to no name — or 'include' for both together.",
		}),
		min_lat: Schema.optional(Schema.Number),
		max_lat: Schema.optional(Schema.Number),
		min_lng: Schema.optional(Schema.Number),
		max_lng: Schema.optional(Schema.Number),
		limit: Schema.optional(McpPageLimit),
		offset: Schema.optional(McpPageOffset),
	}),
	success: PageResult(Company.json),
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'Search Companies')
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

const GetCompany = Tool.make('get_company', {
	description:
		'Get full company profile including contacts and last 5 interactions. Use the slug or ID.',
	parameters: Schema.Struct({
		id_or_slug: Schema.String,
	}),
	success: Schema.Union([CompanyDetail, Company.json]),
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'Get Company')
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

// The fields a new company carries — one array element of a create_companies call.
const companyInputFields = {
	name: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
	slug: CompanySlug,
	taxId: Schema.optional(Schema.String).annotate({
		description:
			'The number the company is registered or taxed under — a Spanish NIF/CIF, a UK company number, an EU VAT number. Copy it exactly as printed; punctuation and case are ignored when matching. Supplying it is the surest way to avoid creating a company you already hold under a different name.',
	}),
	status: Schema.optional(CompanyStatus),
	ownerId: Schema.optional(Schema.String).annotate({
		description:
			'The colleague who will work this company, as a user id from list_members — a name or an email address is not one. Leave it out to create the company unowned and assign it later with update_company.',
	}),
	industry: Schema.optional(Schema.String),
	sizeRange: Schema.optional(CompanySizeRange),
	country: Schema.optional(CompanyCountry),
	location: Schema.optional(Schema.String),
	priority: Schema.optional(CompanyPriority),
	website: Schema.optional(CompanyWebsite),
	email: Schema.optional(CompanyEmail),
	phone: Schema.optional(CompanyPhone),
	instagram: Schema.optional(CompanyInstagram),
	linkedin: Schema.optional(CompanyLinkedin),
	googleMapsUrl: Schema.optional(CompanyGoogleMapsUrl),
	productsFit: Schema.optional(Schema.Array(Schema.String)),
	tags: Schema.optional(Schema.Array(Schema.String)),
	painPoints: Schema.optional(Schema.String),
	currentTools: Schema.optional(Schema.String),
	nextAction: Schema.optional(Schema.String),
	nextActionAt: Schema.optional(Schema.String),
	// Finite, not a plain number: a plain number also admits NaN, which reaches
	// the database as a server error rather than a refused value.
	latitude: Schema.optional(CompanyLatitude),
	longitude: Schema.optional(CompanyLongitude),
	geocodedAt: Schema.optional(Schema.String),
	geocodeSource: Schema.optional(Schema.String),
	metadata: Schema.optional(Schema.Unknown),
}
const CompanyInput = Schema.Struct(companyInputFields)

// Written from the vocabularies rather than typed out beside them. The typed-out
// version drifted: it offered three statuses the app has never had and a priority
// range twice the real one, and assistants followed it into rows that show up in
// no board column. Now the sentence cannot say anything the schema would refuse.
export const CREATE_COMPANIES_DESCRIPTION = `Create one or more companies in a single call — pass \`companies\` as an array (a single element to create just one, the whole shortlist to load a batch). Slug: unique kebab-case from name. Status: ${COMPANY_STATUSES.join('|')} (default: prospect). ownerId assigns the colleague who will work the company — pass a user id from list_members, or leave it out to create it unowned. It only lands on companies actually created: a skipped duplicate keeps the owner it already had, so re-sending a list is never a way to hand companies over. Use update_company for that. Priority: ${COMPANY_PRIORITIES[0]} (highest) to ${COMPANY_PRIORITIES[COMPANY_PRIORITIES.length - 1]} (lowest, default: 2). Pass taxId whenever you know it: a company is skipped if its slug already exists OR its registration number already does, so the number catches the same firm arriving under a different trading name. Runs in one transaction; a skip is not an error, so re-running an overlapping list is safe. Returns { created, skipped, possible_duplicates }: the rows that landed, for each one left out its slug plus matched_on ("slug" or "tax_id") saying which identity already existed, and any company that looks like one already on file under a different name — reported, not blocked, so check those before treating them as new.`

const CreateCompanies = Tool.make('create_companies', {
	description: CREATE_COMPANIES_DESCRIPTION,
	parameters: Schema.Struct({
		companies: Schema.Array(CompanyInput),
	}),
	success: Schema.Struct({
		created: Schema.Array(Company.json),
		skipped: Schema.Array(
			Schema.Struct({
				slug: Schema.String,
				matched_on: Schema.Literals(['slug', 'tax_id']),
			}),
		),
		// Reported rather than refused: only the person adding them knows whether
		// two similar names are two branches or one company typed twice.
		possible_duplicates: Schema.Array(
			Schema.Struct({
				slug: Schema.String,
				existing_slug: Schema.String,
				existing_name: Schema.String,
				matched_on: Schema.Literals(['website', 'name']),
				confidence: Schema.Number,
			}),
		),
	}),
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'Create Companies')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

const UpdateCompany = Tool.make('update_company', {
	description:
		'Update one or more fields on an existing company by UUID. Only include fields to change; omitted fields stay unchanged.',
	parameters: Schema.Struct({
		id: Schema.String,
		name: Schema.optional(Schema.String),
		taxId: Schema.optional(Schema.String).annotate({
			description:
				'The number the company is registered or taxed under. Worth writing down once a registry lookup returns it — a later lookup can then resolve this company exactly instead of paying to search by name again.',
		}),
		ownerId: Schema.optional(Schema.NullOr(Schema.String)).annotate({
			description:
				'The colleague responsible for working this company through the pipeline, as a user id from list_members — a name or an email address is not one. Send null to release it, leaving the company unowned. Read list_members first rather than guessing an id: an id belonging to nobody here is refused, and one belonging to the wrong colleague is not.',
		}),
		status: Schema.optional(CompanyStatus),
		industry: Schema.optional(Schema.String),
		sizeRange: Schema.optional(CompanySizeRange),
		country: Schema.optional(CompanyCountry),
		location: Schema.optional(Schema.String),
		priority: Schema.optional(CompanyPriority),
		website: Schema.optional(CompanyWebsite),
		email: Schema.optional(CompanyEmail),
		phone: Schema.optional(CompanyPhone),
		instagram: Schema.optional(CompanyInstagram),
		linkedin: Schema.optional(CompanyLinkedin),
		googleMapsUrl: Schema.optional(CompanyGoogleMapsUrl),
		productsFit: Schema.optional(Schema.Array(Schema.String)),
		tags: Schema.optional(Schema.Array(Schema.String)),
		painPoints: Schema.optional(Schema.String),
		currentTools: Schema.optional(Schema.String),
		nextAction: Schema.optional(Schema.String),
		nextActionAt: Schema.optional(Schema.String),
		latitude: Schema.optional(CompanyLatitude),
		longitude: Schema.optional(CompanyLongitude),
		geocodedAt: Schema.optional(Schema.String),
		geocodeSource: Schema.optional(Schema.String),
		accountBrief: Schema.optional(
			Schema.String.annotate({
				description:
					"The account's running notes, in markdown. One shared page that people, agents and research runs all rewrite — what you send replaces what is there, so read it first and carry over anything still worth keeping.",
			}),
		),
		metadata: Schema.optional(Schema.Unknown),
	}),
	success: Schema.NullOr(Company.json),
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'Update Company')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.Idempotent, true)
	.annotate(Tool.OpenWorld, false)

const GeocodeCompany = Tool.make('geocode_company', {
	description:
		'Resolve a company to latitude/longitude via the configured geocoder (Nominatim). On a match, persists lat/lng/geocoded_at/geocode_source. Returns { outcome, company }: outcome is "geocoded" (company is the updated row), "no_match" (nothing resolved for the location), "nothing_to_search" (company has no name or location), or "lookup_failed" (the geocoder could not be reached). Rate-limited to 1 req/sec.',
	parameters: Schema.Struct({
		id: Schema.String,
	}),
	success: Schema.Struct({
		outcome: Schema.Literals([
			'geocoded',
			'no_match',
			'nothing_to_search',
			'lookup_failed',
		]),
		company: Schema.NullOr(Company.json),
	}),
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'Geocode Company')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.Idempotent, true)
	.annotate(Tool.OpenWorld, true)

// One tool for the places a company trades from, rather than three. A flat
// `action` with the fields each one needs, never a union: a strict provider
// rejects the nested shape a union serialises to.
const ManageCompanySites = Tool.make('manage_company_sites', {
	description:
		"The places a company trades from — its shops, offices, depots. Most companies need none of these: a company with one place is described by its own address and coordinates, and a site is what you add when there is a second. Adding one is what makes that place findable on the map on its own, so a rep drawing a box around their territory sees the branch there rather than only the city the company is registered in. action: 'list' (all of them), 'add' (name plus, where known, address/location/country/latitude/longitude), 'update' (by site_id, only the fields to change), 'remove' (by site_id). Give coordinates when you have them — a site without them is recorded but cannot be found on a map.",
	parameters: Schema.Struct({
		action: Schema.Literals(['list', 'add', 'update', 'remove']),
		company_id: Schema.String,
		site_id: Schema.optional(Schema.String),
		name: Schema.optional(Schema.String),
		address: Schema.optional(Schema.String),
		location: Schema.optional(Schema.String),
		country: Schema.optional(Schema.String),
		latitude: Schema.optional(Schema.Number),
		longitude: Schema.optional(Schema.Number),
		is_primary: Schema.optional(Schema.Boolean),
	}),
	success: Schema.Struct({
		sites: Schema.Array(Schema.Unknown),
	}),
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'Manage Company Sites')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

// One tool for the ways of reaching a company, flat `action` for the same reason
// the sites tool has one. A branch's own phone differs from the company
// switchboard only by `site_id`, so a second tool would duplicate the lot.
const ManageCompanyChannels = Tool.make('manage_company_channels', {
	description:
		"The ways of reaching a company — its mailboxes, phones, website, social handles. A company can hold several of a kind, which is the point of this tool: `update_company` writes one email and one phone, and a firm with an orders mailbox, an accounts mailbox and a switchboard needs all of them kept apart. Give each one a `label` in the words somebody would actually use — 'orders', 'accounts', 'Girona shop' — because two addresses with no labels are indistinguishable a month later. Pass `site_id` to hang the channel off one branch instead of the company as a whole. action: 'list' (all of them; add site_id to see one branch's), 'add' (kind plus value, and a label whenever there is more than one of that kind), 'update' (by channel_id, only the fields to change), 'remove' (by channel_id). An address the company already holds is refused rather than merged, so correcting one onto another means removing the spare instead. kind is open — email, phone, linkedin, instagram, website, x, bluesky, … — and `is_primary` marks the one to use when nothing says otherwise; the primary email is the address mail is sent to, and removing it hands that over to the oldest one left of the same kind. `verification` only ever lowers how far an address is trusted, and only on 'update'; a later check can raise it again.",
	parameters: Schema.Struct({
		action: Schema.Literals(['list', 'add', 'update', 'remove']),
		company_id: Schema.String,
		site_id: Schema.optional(Schema.String),
		channel_id: Schema.optional(Schema.String),
		kind: Schema.optional(Schema.String),
		value: Schema.optional(Schema.String),
		label: Schema.optional(Schema.NullOr(Schema.String)),
		is_primary: Schema.optional(Schema.Boolean),
		verification: Schema.optional(HandSetVerificationVerdict).annotate({
			description:
				"How far this address is trusted, and only ever downwards: 'risky', 'undeliverable', or 'unknown' to withdraw a verdict that looks wrong. An address is only ever called deliverable by a check that reached the mailbox.",
		}),
	}),
	success: Schema.Struct({
		channels: Schema.Array(Schema.Unknown),
	}),
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'Manage Company Channels')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

// One tool for how two companies belong together, with a flat `action` for the
// same reason the sites tool has one.
const ManageCompanyRelations = Tool.make('manage_company_relations', {
	description:
		"How two companies belong together — a holding and the firm it owns, a franchisor and its franchisee, a company and whoever bought it. Recording one stops the pair reading as two near-duplicates that somebody eventually merges by mistake. action: 'list' (everything this company is part of, from both directions), 'add' (related_company_id plus kind), 'remove' (by relation_id). kind: 'parent' (company_id is owned BY related_company_id), 'franchise_of' (company_id trades under related_company_id's brand but is independently owned — not a subsidiary, and it decides for itself), 'acquired_by' (company_id was bought by related_company_id). Store the pair once, from the owned/franchised/acquired side; the other company shows it too without a second entry.",
	parameters: Schema.Struct({
		action: Schema.Literals(['list', 'add', 'remove']),
		company_id: Schema.String,
		related_company_id: Schema.optional(Schema.String),
		kind: Schema.optional(
			Schema.Literals(['parent', 'franchise_of', 'acquired_by']),
		),
		note: Schema.optional(Schema.String),
		relation_id: Schema.optional(Schema.String),
	}),
	success: Schema.Struct({
		relations: Schema.Array(Schema.Unknown),
	}),
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'Manage Company Relations')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

const ListIndustries = Tool.make('list_industries', {
	description:
		'List the trades this organisation sells to — its own list, not a fixed one, so another organisation has different entries. Read it before filtering companies by industry or writing a trade onto one: search_companies matches a trade this organisation actually has, and naming one it does not returns nothing. Writing a company with a trade that is not on the list adds it, so prefer an entry that is already here over a new wording of the same thing. `needsReview` marks a trade research suggested that nobody has confirmed yet.',
	parameters: Schema.Struct({
		needs_review: Schema.optional(Schema.Boolean).annotate({
			description:
				'Only the trades waiting for somebody to confirm them. Omit for all of them.',
		}),
	}),
	success: Schema.Struct({
		industries: Schema.Array(
			Schema.Struct({
				label: Schema.String,
				slug: Schema.String,
				company_count: Schema.Number,
				needs_review: Schema.Boolean,
			}),
		),
	}),
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'List Industries')
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

const DeleteCompany = Tool.make('delete_company', {
	description:
		'Take a company out of view — off the lists, out of the pipeline figures, and away from the people working it. Its contacts go with it, and its history is kept rather than thrown away, so restore_company puts the lot back. The name is released, so the same firm can be added again afterwards; if somebody does that, restoring the old one needs it renamed first. Nothing is lost, but nobody sees it until it comes back, so say what you are about to remove and let the person confirm before calling this.',
	parameters: Schema.Struct({
		id: Schema.String,
	}),
	success: Schema.Struct({
		contacts_affected: Schema.Number,
		// True when it was already gone before this call, so retrying a delete
		// that may not have landed reads as done rather than as a failure.
		already_deleted: Schema.Boolean,
	}),
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'Delete Company')
	.annotate(Tool.Destructive, true)
	.annotate(Tool.OpenWorld, false)

const RestoreCompany = Tool.make('restore_company', {
	description:
		'Put a deleted company back, along with the people that deletion hid. Use the company id; a deleted company cannot be found by name, because its name was released when it went. Refused when another company is using that name now — rename that one first, then try again.',
	parameters: Schema.Struct({
		id: Schema.String,
	}),
	success: Schema.Struct({
		contacts_affected: Schema.Number,
	}),
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'Restore Company')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.Idempotent, true)
	.annotate(Tool.OpenWorld, false)

export const CompanyTools = Toolkit.make(
	SearchCompanies,
	GetCompany,
	CreateCompanies,
	UpdateCompany,
	GeocodeCompany,
	DeleteCompany,
	RestoreCompany,
	ManageCompanySites,
	ManageCompanyChannels,
	ManageCompanyRelations,
	ListIndustries,
)

export const CompanyHandlersLive = CompanyTools.toLayer(
	Effect.gen(function* () {
		const service = yield* CompanyService
		const geocoder = yield* Geocoder
		// The re-geocode fork re-enters org scope on its own connection, so it
		// needs the SqlClient; resolve it here and provide it to the update
		// path, keeping CurrentOrg as the only request service.
		const sql = yield* SqlClient.SqlClient
		const timeline = yield* TimelineActivityService
		return {
			search_companies: params =>
				Effect.gen(function* () {
					const companies = yield* service.search({
						status: params.status,
						country: params.country,
						industry: params.industry,
						priority: params.priority,
						productFit: params.product_fit,
						fitVerdict: params.fit_verdict,
						fitCriterionPassed: params.fit_criterion_passed,
						query: params.query,
						deleted: params.deleted,
						minLat: params.min_lat,
						maxLat: params.max_lat,
						minLng: params.min_lng,
						maxLng: params.max_lng,
						limit: params.limit,
						offset: params.offset,
					})
					return toPage(companies)
				}).pipe(Effect.orDie),
			get_company: ({ id_or_slug }) =>
				service.getWithRelations(id_or_slug).pipe(
					Effect.catchTag('NotFound', () => service.findById(id_or_slug)),
					Effect.orDie,
				),
			create_companies: params =>
				Effect.gen(function* () {
					const currentOrg = yield* CurrentOrg
					// Looked for before the write, so a company is compared against what
					// was already on file rather than against the rest of this batch.
					const possibleDuplicates = yield* findDuplicateCompanies(
						sql,
						currentOrg.id,
						params.companies.map(c => ({
							slug: c.slug,
							name: c.name,
							website: c.website,
						})),
					)
					const batch = yield* service.createMany(params.companies)
					return {
						created: batch.created,
						skipped: batch.skipped.map(skip => ({
							slug: skip.slug,
							matched_on:
								skip.matchedOn === 'taxId'
									? ('tax_id' as const)
									: ('slug' as const),
						})),
						possible_duplicates: possibleDuplicates,
					}
				}).pipe(
					Effect.catchTag('BadRequest', e =>
						Effect.die(new ToolMessage(e.message)),
					),
					Effect.orDie,
				),
			update_company: ({ id, ...fields }) =>
				Effect.gen(function* () {
					// Capture the stage before the write so an agent-driven change
					// is recorded on the timeline too (actor unknown → null).
					const before =
						fields.status === undefined
							? null
							: yield* service.findById(id).pipe(
									Effect.map(row =>
										typeof row['status'] === 'string' ? row['status'] : null,
									),
									Effect.catch(() => Effect.succeed(null)),
								)
					const result = yield* updateCompanyRegeocoding(id, fields).pipe(
						Effect.provideService(CompanyService, service),
						Effect.provideService(Geocoder, geocoder),
						Effect.provideService(SqlClient.SqlClient, sql),
						Effect.catchTag('NotFound', () =>
							Effect.die(
								new ToolMessage(
									'No company here with that id, or it was deleted. Look among the deleted ones with search_companies and restore it before editing.',
								),
							),
						),
					)
					yield* recordStageChange({
						companyId: id,
						from: before,
						to: fields.status,
						actorUserId: null,
					}).pipe(Effect.provideService(TimelineActivityService, timeline))
					return result
				}).pipe(
					Effect.catchTag('BadRequest', e =>
						Effect.die(new ToolMessage(e.message)),
					),
					Effect.orDie,
				),
			manage_company_sites: params =>
				Effect.gen(function* () {
					const currentOrg = yield* CurrentOrg
					const list = () => sql`
						SELECT id, name, address, location, country,
							latitude, longitude, is_primary AS "isPrimary"
						FROM sites
						WHERE company_id = ${params.company_id}
							AND organization_id = ${currentOrg.id}
						ORDER BY is_primary DESC, name
					`
					if (params.action === 'add') {
						// The company has to be this organisation's. The foreign key only
						// says it exists, not whose it is, so without this a branch could
						// be hung off somebody else's company.
						const owned = yield* sql`
							SELECT id FROM companies
							WHERE id = ${params.company_id}
								AND organization_id = ${currentOrg.id}
								AND deleted_at IS NULL
							LIMIT 1
						`
						if (owned.length === 0) return { sites: [] }
						yield* sql`
							INSERT INTO sites ${sql.insert({
								organizationId: currentOrg.id,
								companyId: params.company_id,
								name: params.name ?? 'Site',
								address: params.address ?? null,
								location: params.location ?? null,
								country: params.country ?? null,
								latitude: params.latitude ?? null,
								longitude: params.longitude ?? null,
								isPrimary: params.is_primary ?? false,
							})}
						`
					}
					if (params.action === 'update' && params.site_id !== undefined) {
						// Only what the caller named: an omitted field is one they did
						// not mean to touch, not one they meant to clear.
						const patch: Record<string, unknown> = {
							updatedAt: DateTime.toDateUtc(DateTime.nowUnsafe()),
						}
						if (params.name !== undefined) patch['name'] = params.name
						if (params.address !== undefined) patch['address'] = params.address
						if (params.location !== undefined)
							patch['location'] = params.location
						if (params.country !== undefined) patch['country'] = params.country
						if (params.latitude !== undefined)
							patch['latitude'] = params.latitude
						if (params.longitude !== undefined)
							patch['longitude'] = params.longitude
						if (params.is_primary !== undefined)
							patch['isPrimary'] = params.is_primary
						yield* sql`
							UPDATE sites SET ${sql.update(patch)}
							WHERE id = ${params.site_id}
								AND company_id = ${params.company_id}
								AND organization_id = ${currentOrg.id}
						`
					}
					if (params.action === 'remove' && params.site_id !== undefined) {
						const removed = yield* sql`
							DELETE FROM sites
							WHERE id = ${params.site_id}
								AND company_id = ${params.company_id}
								AND organization_id = ${currentOrg.id}
							RETURNING id
						`
						// Only once the branch really went: the delete above is scoped by
						// company as well, and this is not, so an id paired with the wrong
						// company would otherwise strip a branch that is still trading.
						if (removed.length > 0) {
							yield* deleteSubjectChannels(sql, currentOrg.id, {
								table: 'sites',
								id: params.site_id,
							})
						}
					}
					return { sites: yield* list() }
				}).pipe(Effect.orDie),
			manage_company_channels: params =>
				Effect.gen(function* () {
					const currentOrg = yield* CurrentOrg
					const subject = params.site_id
						? ({ table: 'sites', id: params.site_id } as const)
						: ({ table: 'companies', id: params.company_id } as const)

					// An id only proves the row exists, not whose it is, so without this
					// a channel could be hung off somebody else's company or branch.
					const owned = params.site_id
						? yield* sql`
							SELECT s.id FROM sites s
							JOIN companies c ON c.id = s.company_id AND c.deleted_at IS NULL
							WHERE s.id = ${params.site_id}
								AND s.company_id = ${params.company_id}
								AND s.organization_id = ${currentOrg.id}
							LIMIT 1
						`
						: yield* sql`
							SELECT id FROM companies
							WHERE id = ${params.company_id}
								AND organization_id = ${currentOrg.id}
								AND deleted_at IS NULL
							LIMIT 1
						`
					if (owned.length === 0) return { channels: [] }

					if (
						params.action === 'add' &&
						params.kind !== undefined &&
						params.value !== undefined
					) {
						yield* addChannel(sql, currentOrg.id, subject, {
							kind: params.kind,
							value: params.value,
							// On a new one there is nothing to take back, so a null name
							// and no name are the same thing.
							label: params.label ?? undefined,
							is_primary: params.is_primary,
						})
					}
					if (params.action === 'update' && params.channel_id !== undefined) {
						yield* patchChannel(
							sql,
							currentOrg.id,
							subject,
							params.channel_id,
							{
								kind: params.kind,
								value: params.value,
								label: params.label,
								is_primary: params.is_primary,
								verification: params.verification,
							},
						)
					}
					if (params.action === 'remove' && params.channel_id !== undefined) {
						yield* deleteChannel(sql, currentOrg.id, subject, params.channel_id)
					}
					return { channels: yield* subjectChannelsOf(sql, subject) }
				}).pipe(
					// An address that could never be one of its kind is worth saying in
					// words the assistant can act on, rather than the fixed sentence a
					// raw fault gets.
					Effect.catchTag('BadRequest', e =>
						Effect.die(new ToolMessage(e.message)),
					),
					Effect.orDie,
				),
			manage_company_relations: params =>
				Effect.gen(function* () {
					const currentOrg = yield* CurrentOrg
					const list = () => sql`
						SELECT r.id, r.kind, r.note, 'outgoing' AS direction,
							c2.id AS "companyId", c2.name, c2.slug
						FROM company_relations r
						JOIN companies c2 ON c2.id = r.related_company_id
						WHERE r.company_id = ${params.company_id}
							AND r.organization_id = ${currentOrg.id}
						UNION ALL
						SELECT r.id, r.kind, r.note, 'incoming' AS direction,
							c2.id AS "companyId", c2.name, c2.slug
						FROM company_relations r
						JOIN companies c2 ON c2.id = r.company_id
						WHERE r.related_company_id = ${params.company_id}
							AND r.organization_id = ${currentOrg.id}
					`
					if (
						params.action === 'add' &&
						params.related_company_id !== undefined &&
						params.kind !== undefined
					) {
						// Both companies have to be this organisation's. The foreign keys
						// only say they exist, not whose they are.
						const owned = yield* sql<{ n: string }>`
							SELECT count(*)::text AS n FROM companies
							WHERE id IN (${params.company_id}, ${params.related_company_id})
								AND organization_id = ${currentOrg.id}
								AND deleted_at IS NULL
						`
						if (Number(owned[0]?.n ?? 0) !== 2) return { relations: [] }
						yield* sql`
							INSERT INTO company_relations ${sql.insert({
								organizationId: currentOrg.id,
								companyId: params.company_id,
								relatedCompanyId: params.related_company_id,
								kind: params.kind,
								note: params.note ?? null,
							})}
							ON CONFLICT (company_id, related_company_id, kind) DO NOTHING
						`
					}
					if (params.action === 'remove' && params.relation_id !== undefined) {
						yield* sql`
							DELETE FROM company_relations
							WHERE id = ${params.relation_id}
								AND organization_id = ${currentOrg.id}
						`
					}
					return { relations: yield* list() }
				}).pipe(Effect.orDie),
			delete_company: ({ id }) =>
				Effect.gen(function* () {
					const currentUser = yield* CurrentUser
					const result = yield* service.softDelete(id)
					// Nothing happened, so nothing is written onto its history.
					if (result.alreadyDeleted)
						return { contacts_affected: 0, already_deleted: true }
					yield* timeline
						.record(
							new CompanyDeleted({
								companyId: id,
								contactsAffected: result.contactsAffected,
								actorUserId: currentUser.userId,
								occurredAt: result.at,
							}),
						)
						.pipe(Effect.provideService(TimelineActivityService, timeline))
					return {
						contacts_affected: result.contactsAffected,
						already_deleted: false,
					}
				}).pipe(
					Effect.catchTag('NotFound', () =>
						Effect.die(new ToolMessage('No company here with that id.')),
					),
					Effect.orDie,
				),
			restore_company: ({ id }) =>
				Effect.gen(function* () {
					const currentUser = yield* CurrentUser
					const result = yield* service.restore(id)
					yield* timeline
						.record(
							new CompanyRestored({
								companyId: id,
								contactsAffected: result.contactsAffected,
								actorUserId: currentUser.userId,
								occurredAt: DateTime.toDateUtc(DateTime.nowUnsafe()),
							}),
						)
						.pipe(Effect.provideService(TimelineActivityService, timeline))
					return { contacts_affected: result.contactsAffected }
				}).pipe(
					// Both of these are the caller's to act on, so they leave as words.
					Effect.catchTag('BadRequest', e =>
						Effect.die(new ToolMessage(e.message)),
					),
					Effect.catchTag('NotFound', () =>
						Effect.die(
							new ToolMessage('No deleted company here with that id.'),
						),
					),
					Effect.orDie,
				),
			geocode_company: ({ id }) =>
				geocodeCompany(id).pipe(
					Effect.provideService(CompanyService, service),
					Effect.provideService(Geocoder, geocoder),
					Effect.map(result => ({
						outcome: result._tag,
						company: result._tag === 'geocoded' ? result.company : null,
					})),
					Effect.orDie,
				),
			list_industries: params =>
				Effect.gen(function* () {
					const currentOrg = yield* CurrentOrg
					const industries = yield* listIndustries(
						sql,
						currentOrg.id,
						params.needs_review === undefined
							? undefined
							: { needsReview: params.needs_review },
					)
					return {
						industries: industries.map(i => ({
							label: i.label,
							slug: i.slug,
							company_count: i.companyCount,
							needs_review: i.needsReview,
						})),
					}
				}).pipe(Effect.orDie),
		}
	}),
)

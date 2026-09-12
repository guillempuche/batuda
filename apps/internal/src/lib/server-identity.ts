import { Option, Schema } from 'effect'

import { apiBaseUrl } from './api-base'
import type {
	IdentityOrganization,
	IdentityOrganizationSummary,
} from './identity'
import { filterAuthCookies } from './session-check'

/**
 * Which organisation the signed-in person is in, and which ones they belong
 * to. Three answers per field: a value, `null` for "asked, there is none",
 * and `undefined` for "could not ask", which leaves the screen waiting on the
 * browser store exactly as if the server had said nothing.
 */
export type ServerOrganizations = {
	readonly activeOrganization: IdentityOrganization | null | undefined
	readonly organizations: ReadonlyArray<IdentityOrganizationSummary> | undefined
}

const Member = Schema.Struct({
	id: Schema.String,
	userId: Schema.String,
	role: Schema.String,
	user: Schema.Struct({
		name: Schema.optional(Schema.String),
		email: Schema.String,
	}),
})

const Organization = Schema.Struct({
	id: Schema.String,
	name: Schema.String,
	slug: Schema.String,
	members: Schema.Array(Member),
})

const OrganizationSummary = Schema.Struct({
	id: Schema.String,
	name: Schema.String,
	slug: Schema.String,
})

const decodeOrganization = Schema.decodeUnknownOption(
	Schema.NullOr(Organization),
)
const decodeOrganizations = Schema.decodeUnknownOption(
	Schema.Array(OrganizationSummary),
)

// Long enough for the API next door, short enough that a stalled auth call
// cannot hold every page's first byte hostage.
const READ_TIMEOUT_MS = 3000

/**
 * Asks both questions on the server for the page being rendered. Better
 * Auth's browser store answers the same ones later; until it does, this is
 * what the page shows, so the server's HTML and the browser's first frame
 * agree and the org name and the owner names are right from the first paint.
 *
 * Only the fields a screen reads on that first frame cross to the browser: no
 * session token, no dates, no invitation list. Each reply is decoded against
 * that shape, so a reply that has changed underneath us is "unknown" rather
 * than a crash.
 */
export async function fetchServerOrganizations(
	cookieHeader: string,
): Promise<ServerOrganizations> {
	const base = apiBaseUrl()
	if (!base) return { activeOrganization: undefined, organizations: undefined }
	const cookie = filterAuthCookies(cookieHeader)
	const read = async (path: string): Promise<unknown> => {
		try {
			const response = await fetch(`${base}${path}`, {
				headers: { accept: 'application/json', cookie },
				signal: AbortSignal.timeout(READ_TIMEOUT_MS),
			})
			if (!response.ok) return undefined
			return await response.json()
		} catch (error) {
			console.error(`[server-identity] ${path} failed:`, error)
			return undefined
		}
	}

	const [activeOrganization, organizations] = await Promise.all([
		read('/auth/organization/get-full-organization'),
		read('/auth/organization/list'),
	])

	return {
		activeOrganization:
			activeOrganization === undefined
				? undefined
				: Option.getOrUndefined(decodeOrganization(activeOrganization)),
		organizations:
			organizations === undefined
				? undefined
				: Option.getOrUndefined(decodeOrganizations(organizations)),
	}
}

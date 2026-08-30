import { Effect } from 'effect'

import { CurrentOrg } from '@batuda/domain'

/**
 * The organisation the worker is acting for, in the shape the services it
 * shares with the server ask for.
 *
 * Those services expect a request to have settled who the work is for; the
 * worker has no request, so it takes the organisation from the mailbox the
 * message arrived through. Only the id is ever read, so the name and the slug
 * are left empty, and delivering mail is nobody's request, so it manages
 * nothing.
 */
export const asOrg = (organizationId: string) =>
	Effect.provideService(CurrentOrg, {
		id: organizationId,
		name: '',
		slug: '',
		role: null,
	})

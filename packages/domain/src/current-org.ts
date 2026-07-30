import { Context } from 'effect'

export class CurrentOrg extends Context.Service<
	CurrentOrg,
	{
		readonly id: string
		readonly name: string
		readonly slug: string
		// What the person behind this request may do in this organization.
		// Null when there is no person: unattended work, which manages nothing
		// and so never acts on what belongs to one member.
		readonly role: string | null
	}
>()('CurrentOrg') {}

// Managing an organization — its people, its shared settings, anything that
// belongs to somebody else — is for whoever runs it. Everyone else acts for
// themselves alone.
export const isOrgManager = (role: string | null): boolean =>
	role === 'owner' || role === 'admin'

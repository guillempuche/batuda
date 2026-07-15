import { Context } from 'effect'

export class CurrentOrg extends Context.Service<
	CurrentOrg,
	{
		readonly id: string
		readonly name: string
		readonly slug: string
	}
>()('CurrentOrg') {}

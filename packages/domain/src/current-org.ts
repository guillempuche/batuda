import { ServiceMap } from 'effect'

export class CurrentOrg extends ServiceMap.Service<
	CurrentOrg,
	{
		readonly id: string
		readonly name: string
		readonly slug: string
	}
>()('CurrentOrg') {}

import { ServiceMap } from 'effect'

export class CurrentUser extends ServiceMap.Service<
	CurrentUser,
	{
		readonly userId: string
		readonly email: string
		readonly name: string
		readonly isAgent: boolean
	}
>()('CurrentUser') {}

import { Context } from 'effect'

export class CurrentUser extends Context.Service<
	CurrentUser,
	{
		readonly userId: string
		readonly email: string
		readonly name: string
		readonly isAgent: boolean
	}
>()('CurrentUser') {}

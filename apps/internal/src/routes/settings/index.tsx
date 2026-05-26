import { createFileRoute, redirect } from '@tanstack/react-router'

// The settings hub has no landing surface of its own — Profile is the
// default destination, so visiting /settings lands the member there.
export const Route = createFileRoute('/settings/')({
	beforeLoad: () => {
		throw redirect({ to: '/settings/profile' })
	},
})

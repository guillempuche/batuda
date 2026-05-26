import { createFileRoute, redirect } from '@tanstack/react-router'

// Profile moved under the settings hub. Keep this stable so older links
// (e.g. the set-password nudge's "Set password" CTA, bookmarks) land on
// the new location instead of 404ing.
export const Route = createFileRoute('/profile/')({
	beforeLoad: () => {
		throw redirect({ to: '/settings/profile' })
	},
})

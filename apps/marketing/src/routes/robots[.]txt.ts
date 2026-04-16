import { createFileRoute } from '@tanstack/react-router'

const PUBLIC_URL =
	import.meta.env['VITE_PUBLIC_URL'] ?? 'https://engranatge.com'

export const Route = createFileRoute('/robots.txt')({
	server: {
		handlers: {
			GET: async () => {
				const body = [
					'User-agent: *',
					'Allow: /',
					'',
					`Sitemap: ${PUBLIC_URL}/sitemap.xml`,
				].join('\n')

				return new Response(body, {
					headers: {
						'content-type': 'text/plain; charset=utf-8',
						'cache-control': 'public, max-age=86400',
					},
				})
			},
		},
	},
})

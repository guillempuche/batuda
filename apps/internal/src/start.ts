import { createMiddleware, createStart } from '@tanstack/react-start'
import { setResponseHeader } from '@tanstack/react-start/server'

/**
 * App-wide server setup. The one job here is to tell every browser never to
 * show a Batuda page inside a frame on another site. That's the standard guard
 * against clickjacking — a hidden frame that tricks a signed-in person into
 * clicking something they can't see, such as the "Allow" on the connect screen.
 * Nothing in Batuda is meant to be embedded anywhere, so framing is denied
 * outright, on every page (the modern header plus the legacy one older
 * browsers still honour).
 */
const denyFraming = createMiddleware().server(async ({ next }) => {
	setResponseHeader('Content-Security-Policy', "frame-ancestors 'none'")
	setResponseHeader('X-Frame-Options', 'DENY')
	return next()
})

export const startInstance = createStart(() => ({
	requestMiddleware: [denyFraming],
}))

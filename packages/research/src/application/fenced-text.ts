/**
 * A line inside a fence that reads as the fence's own closing marker would end
 * the fence early and let what follows read as the system's words. Such a line
 * is kept, with its dashes broken up so it no longer reads as a marker.
 */
export const withoutFenceMarkers = (text: string): string =>
	text.replace(/^[ \t]*-{3,}[ \t]*end [a-z ]+?-{3,}[ \t]*$/gim, line =>
		line.replace(/-{3,}/g, '- - -'),
	)

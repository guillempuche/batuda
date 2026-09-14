// A structured reply the vendor stopped writing at its ceiling ends in the
// middle of the JSON it was writing. What this module knows is the shape of
// such a text: whether it ends before its JSON closes, and which parts of it
// arrived whole.

type Container = {
	readonly kind: '{' | '['
	// What the text is expected to write next inside this container.
	state: 'key' | 'colon' | 'value' | 'after'
	// Whether nothing has been written inside it yet, so closing it now is fine.
	empty: boolean
	// Where the last member or element written whole inside it ends; 0 when
	// none has.
	lastMemberEnd: number
}

interface JsonScan {
	// Whether the text ends inside a string, a number or a container it never
	// closed.
	readonly open: boolean
	// The containers still open where the text ends, outermost first.
	readonly stack: ReadonlyArray<Container>
}

const NUMBER_OR_LITERAL =
	/^(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)$/

const isJsonSpace = (ch: string): boolean =>
	ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t'

// Walks the text as JSON, one character at a time, remembering for every
// container the last member that was written whole. Nothing is returned for a
// text that breaks JSON's grammar somewhere before it ends: that one was not
// cut off, it was written wrong.
const scanJson = (text: string): JsonScan | undefined => {
	const stack: Container[] = []
	let inString = false
	let escaped = false
	let stringIsKey = false
	let tokenStart = -1
	let topLevelStarted = false
	// Set once a token JSON does not know has gone by: nothing past it can
	// close into JSON, so nothing past it is counted as kept, while a member
	// written whole before it still is.
	let tainted = false

	const top = (): Container | undefined => stack[stack.length - 1]
	const valueDone = (end: number): void => {
		const container = top()
		if (container === undefined) return
		container.state = 'after'
		if (!tainted) container.lastMemberEnd = end
	}
	// Whether a value may start here, marking the container as no longer empty.
	const startValue = (): boolean => {
		const container = top()
		if (container === undefined) {
			if (topLevelStarted) return false
			topLevelStarted = true
			return true
		}
		if (container.state !== 'value') return false
		container.empty = false
		return true
	}
	// A bare token ends at a delimiter. A number or a literal written whole is a
	// member kept; one JSON does not know ("NaN", "+1", "01") stands as a value
	// the text moved past, and taints everything after it; one the text stops
	// in the middle of is neither.
	const endToken = (at: number): void => {
		if (tokenStart < 0) return
		const token = text.slice(tokenStart, at)
		tokenStart = -1
		if (NUMBER_OR_LITERAL.test(token)) valueDone(at)
		else {
			tainted = true
			const container = top()
			if (container !== undefined) container.state = 'after'
		}
	}

	for (let i = 0; i < text.length; i++) {
		const ch = text[i] as string
		if (inString) {
			if (escaped) escaped = false
			else if (ch === '\\') escaped = true
			else if (ch === '"') {
				inString = false
				const container = top()
				if (stringIsKey && container !== undefined) container.state = 'colon'
				else valueDone(i + 1)
			}
			continue
		}
		if (isJsonSpace(ch)) {
			endToken(i)
			continue
		}
		switch (ch) {
			case '"': {
				if (tokenStart >= 0) return undefined
				const container = top()
				if (container?.kind === '{' && container.state === 'key') {
					container.empty = false
					stringIsKey = true
				} else {
					if (!startValue()) return undefined
					stringIsKey = false
				}
				inString = true
				break
			}
			case '{':
			case '[': {
				if (tokenStart >= 0 || !startValue()) return undefined
				stack.push({
					kind: ch,
					state: ch === '{' ? 'key' : 'value',
					empty: true,
					lastMemberEnd: 0,
				})
				break
			}
			case ':': {
				const container = top()
				if (container?.kind !== '{' || container.state !== 'colon')
					return undefined
				container.state = 'value'
				break
			}
			case ',': {
				endToken(i)
				const container = top()
				if (container === undefined || container.state !== 'after')
					return undefined
				container.state = container.kind === '{' ? 'key' : 'value'
				break
			}
			case '}':
			case ']': {
				endToken(i)
				const container = top()
				if (
					container === undefined ||
					(ch === '}') !== (container.kind === '{')
				)
					return undefined
				if (container.state !== 'after' && !container.empty) return undefined
				stack.pop()
				valueDone(i + 1)
				break
			}
			default: {
				if (tokenStart < 0) {
					if (!startValue()) return undefined
					tokenStart = i
				}
			}
		}
	}
	return {
		open: inString || tokenStart >= 0 || stack.length > 0,
		stack,
	}
}

const parsesAsJson = (text: string): boolean => {
	try {
		JSON.parse(text)
		return true
	} catch {
		return false
	}
}

/**
 * Whether a text that set out as JSON stops before every string and container
 * it opened is closed — the mark of a reply the vendor cut at its ceiling. A
 * text that closes and still fails to parse went wrong somewhere in the
 * middle, which a second try or another vendor may well not repeat; that one
 * reads as false, and so does anything that is not JSON at all.
 */
export const endsBeforeJsonCloses = (text: string): boolean => {
	const trimmed = text.trimStart()
	if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return false
	if (parsesAsJson(trimmed)) return false
	return scanJson(trimmed)?.open === true
}

export interface CutOffJsonCandidate {
	/** The text closed so it parses. */
	readonly text: string
	/** How many characters of the reply it keeps, before the closers. */
	readonly keptChars: number
}

/**
 * The ways a cut-off reply can be read as whole, most kept first: closed right
 * after the last member written whole inside the innermost open container,
 * then one container further out each time, the member the cut landed in left
 * out at every step. A reader that decodes them in order stops at the first
 * that fits its shape — an entity missing the field the cut fell in fails,
 * the same list without that entity may not. Nothing when no member arrived
 * whole, when the text was not cut off but written wrong, and never an empty
 * container the text merely opened: that would read as an answer with nothing
 * in it, which hides the cut.
 */
export const closeCutOffJson = (
	text: string,
): ReadonlyArray<CutOffJsonCandidate> => {
	const trimmed = text.trimStart()
	const scanned = scanJson(trimmed)
	if (scanned === undefined || !scanned.open) return []
	const candidates: CutOffJsonCandidate[] = []
	for (let depth = scanned.stack.length - 1; depth >= 0; depth--) {
		const keptChars = (scanned.stack[depth] as Container).lastMemberEnd
		if (keptChars === 0) continue
		const closers = scanned.stack
			.slice(0, depth + 1)
			.map(container => (container.kind === '{' ? '}' : ']'))
			.reverse()
			.join('')
		const closed = trimmed.slice(0, keptChars) + closers
		if (parsesAsJson(closed)) candidates.push({ text: closed, keptChars })
	}
	return candidates
}

// The instruction endpoints return `Schema.Unknown` bodies, so each surface
// narrows the raw JSON into the small shapes it renders. Keeping the narrowing
// in one place means the user library, the org admin page, and the pickers all
// read the same fields the same way.

export type TemplateShape = {
	readonly id: string
	readonly name: string
	readonly body: string
	readonly ownerUserId: string | null
}

function str(r: Record<string, unknown>, key: string): string | null {
	return typeof r[key] === 'string' ? (r[key] as string) : null
}

export function narrowTemplates(value: unknown): ReadonlyArray<TemplateShape> {
	if (!Array.isArray(value)) return []
	const out: Array<TemplateShape> = []
	for (const row of value) {
		if (!row || typeof row !== 'object') continue
		const r = row as Record<string, unknown>
		const id = str(r, 'id')
		const name = str(r, 'name')
		if (id === null || name === null) continue
		out.push({
			id,
			name,
			body: str(r, 'body') ?? '',
			ownerUserId: str(r, 'ownerUserId'),
		})
	}
	return out
}

export type StackComposition = 'replace' | 'extend'

// A named, ordered stack of templates for one agent. `scope` is derived from
// ownership — an org-owned stack has no personal owner. `isDefault` marks the
// one stack that applies to a run naming none (at most one per scope+agent).
export type StackShape = {
	readonly id: string
	readonly agent: string
	readonly name: string
	readonly isDefault: boolean
	readonly composition: StackComposition
	readonly scope: 'org' | 'personal'
	readonly templateIds: ReadonlyArray<string>
}

function stringArray(value: unknown): ReadonlyArray<string> {
	return Array.isArray(value)
		? value.filter((x): x is string => typeof x === 'string')
		: []
}

// Narrow one raw stack row into a StackShape, or null when it lacks the id/name
// every surface keys and labels on. Ownership drives scope; composition and the
// default flag fall back to a plain 'replace', not-default stack.
function narrowStack(row: unknown): StackShape | null {
	if (!row || typeof row !== 'object') return null
	const r = row as Record<string, unknown>
	const id = str(r, 'id')
	const name = str(r, 'name')
	if (id === null || name === null) return null
	const composition = r['composition'] === 'extend' ? 'extend' : 'replace'
	return {
		id,
		agent: str(r, 'agent') ?? '',
		name,
		isDefault: r['isDefault'] === true,
		composition,
		scope: str(r, 'ownerUserId') === null ? 'org' : 'personal',
		templateIds: stringArray(r['templateIds']),
	}
}

// listStacks returns `{ items: [...] }`; getStack returns a bare row. Accept
// either an array or an `{ items }` wrapper and drop rows we can't key on.
export function narrowStacks(value: unknown): ReadonlyArray<StackShape> {
	const rows = Array.isArray(value)
		? value
		: value &&
				typeof value === 'object' &&
				Array.isArray((value as Record<string, unknown>)['items'])
			? ((value as Record<string, unknown>)['items'] as ReadonlyArray<unknown>)
			: []
	const out: Array<StackShape> = []
	for (const row of rows) {
		const stack = narrowStack(row)
		if (stack !== null) out.push(stack)
	}
	return out
}

export type ResolutionShape = {
	readonly source: string | null
	readonly defaults: {
		readonly org: StackShape | null
		readonly user: StackShape | null
	}
}

// getResolution reports which default applies for an agent and carries both the
// org and the actor's own default (either may be null). The inherit banner reads
// this to show what a member is currently following.
export function narrowResolution(value: unknown): ResolutionShape {
	if (!value || typeof value !== 'object') {
		return { source: null, defaults: { org: null, user: null } }
	}
	const r = value as Record<string, unknown>
	const defaults =
		r['defaults'] && typeof r['defaults'] === 'object'
			? (r['defaults'] as Record<string, unknown>)
			: {}
	return {
		source: str(r, 'source'),
		defaults: {
			org: narrowStack(defaults['org']),
			user: narrowStack(defaults['user']),
		},
	}
}

// Pull the server's `{ outcome }` discriminant out of a mutation result.
// promiseExit mutations resolve to a tagged Success/Failure result; only a
// Success carries a value, and these endpoints return `Schema.Unknown` bodies
// — so narrow the value rather than casting it to a made-up type. A failed
// call, or a success without a recognisable outcome, both read as null.
export function outcomeOf(exit: {
	readonly _tag: string
	readonly value?: unknown
}): string | null {
	if (exit._tag !== 'Success') return null
	const value = exit.value
	if (!value || typeof value !== 'object') return null
	const outcome = (value as Record<string, unknown>)['outcome']
	return typeof outcome === 'string' ? outcome : null
}

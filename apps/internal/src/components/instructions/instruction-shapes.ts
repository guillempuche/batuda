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

export type DonationShape = {
	readonly id: string
	readonly name: string
	readonly body: string
	readonly proposedBy: string | null
	readonly status: string
	readonly createdAt: string | null
}

export type PresetShape = {
	readonly id: string
	readonly name: string
	readonly body: string
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

export function narrowStackIds(
	value: unknown,
	key: 'org' | 'user',
): ReadonlyArray<string> | null {
	if (!value || typeof value !== 'object') return null
	const slot = (value as Record<string, unknown>)[key]
	if (!slot || typeof slot !== 'object') return null
	const ids = (slot as Record<string, unknown>)['templateIds']
	if (!Array.isArray(ids)) return null
	return ids.filter((x): x is string => typeof x === 'string')
}

export function narrowDonations(value: unknown): ReadonlyArray<DonationShape> {
	if (!Array.isArray(value)) return []
	const out: Array<DonationShape> = []
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
			proposedBy: str(r, 'proposedBy'),
			status: str(r, 'status') ?? 'pending',
			createdAt: str(r, 'createdAt'),
		})
	}
	return out
}

export function narrowPresets(value: unknown): ReadonlyArray<PresetShape> {
	if (!Array.isArray(value)) return []
	const out: Array<PresetShape> = []
	for (const row of value) {
		if (!row || typeof row !== 'object') continue
		const r = row as Record<string, unknown>
		const id = str(r, 'id')
		const name = str(r, 'name')
		if (id === null || name === null) continue
		out.push({ id, name, body: str(r, 'body') ?? '' })
	}
	return out
}

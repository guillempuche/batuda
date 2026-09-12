import { Effect } from 'effect'
import type { SqlError } from 'effect/unstable/sql'
import { SqlClient } from 'effect/unstable/sql'

import {
	ATTRIBUTE_DESCRIPTION_MAX,
	ATTRIBUTE_ENUM_VALUE_MAX,
	ATTRIBUTE_KEY_PATTERN,
	ATTRIBUTE_KINDS,
	ATTRIBUTE_LABEL_MAX,
	ATTRIBUTE_OPS,
	ATTRIBUTE_QUOTE_MAX,
	ATTRIBUTE_RESERVED_KEYS,
	ATTRIBUTE_SOURCE_MAX,
	ATTRIBUTE_UNIT_MAX,
	ATTRIBUTES_PER_STACK_MAX,
	type AttributeKind,
	type AttributeOp,
	type AttributeValue,
	type CompanyAttributesInput,
	coerceAttributeValue,
	foldLabel,
	isCalendarDay,
	OPS_FOR_KIND,
	type ResearchAttributeDeclaration,
} from '@batuda/domain'

import type { Agent, ResearchAttribute } from './domain'
import { type Eff, isUniqueViolation } from './sql'
import { isUuidRef } from './uuid'

// The attributes an organisation declares on its research stacks, and the
// rules every door applies to them: what a declaration may look like, what a
// value written under a key may be, and which filters fit a kind. The rules
// are plain functions so every caller refuses the same things for the same
// reasons. The SQL
// operations below run as the request-scoped role, so row-level security
// already limits what they can see or write; the admin gate on writes is
// composed by the app layer on top, as it is for stacks.

// ── Declaration rules ──────────────────────────────────────────────────────

export type DeclarationRefusal =
	| 'stack_not_org'
	| 'agent_not_research'
	| 'invalid_key'
	| 'reserved_key'
	| 'label_required'
	| 'label_too_long'
	| 'label_not_one_line'
	| 'unknown_kind'
	| 'enum_values_required'
	| 'enum_values_not_allowed'
	| 'enum_value_invalid'
	| 'unit_too_long'
	| 'description_too_long'
	| 'kind_mismatch'
	| 'key_in_use'
	| 'too_many_active'

export interface DeclarationInput {
	readonly key: string
	readonly label: string
	readonly kind: string
	readonly enumValues: ReadonlyArray<string> | null
	readonly unit: string | null
	readonly description: string | null
	readonly isActive: boolean
}

// What the rules need to know about the stack and the rest of the organisation.
export interface DeclarationContext {
	readonly stackAgent: string
	readonly stackOwnerUserId: string | null
	// Active declarations already on the stack, not counting the one being
	// written.
	readonly activeOnStack: number
	// Every other declaration of the same key in the organisation, retired ones
	// included: a retired declaration still says how the values companies hold
	// under the key read.
	readonly sameKeyElsewhere: ReadonlyArray<DeclaredShape>
}

// The part of a declaration that decides how a value is read.
export interface DeclaredShape {
	readonly kind: AttributeKind
	readonly enumValues: ReadonlyArray<string> | null
	readonly unit: string | null
}

export interface CleanDeclaration extends DeclaredShape {
	readonly key: string
	readonly label: string
	readonly description: string | null
	readonly isActive: boolean
}

export type DeclarationCheck =
	| { readonly ok: true; readonly declaration: CleanDeclaration }
	| { readonly ok: false; readonly reason: DeclarationRefusal }

const isKind = (raw: string): raw is AttributeKind =>
	(ATTRIBUTE_KINDS as ReadonlyArray<string>).includes(raw)

const isOp = (raw: string): raw is AttributeOp =>
	(ATTRIBUTE_OPS as ReadonlyArray<string>).includes(raw)

// Trimmed text, or null when nothing is left.
const cleanText = (raw: string | null): string | null => {
	const text = raw?.trim() ?? ''
	return text === '' ? null : text
}

// The same choice words, whatever their order, case or accents.
const sameWords = (
	a: ReadonlyArray<string> | null,
	b: ReadonlyArray<string> | null,
): boolean => {
	const fold = (values: ReadonlyArray<string> | null) =>
		JSON.stringify([...(values ?? [])].map(foldLabel).sort())
	return fold(a) === fold(b)
}

// Whether two declarations of one key read a value the same way. Two stacks
// may declare the same key only when they agree on this, so a filter or a
// reader that merges by key never meets two meanings of one name.
export const sameShape = (a: DeclaredShape, b: DeclaredShape): boolean =>
	a.kind === b.kind &&
	(a.unit ?? null) === (b.unit ?? null) &&
	sameWords(a.enumValues, b.enumValues)

// The key is checked once, when a declaration is created: it never changes
// afterwards, and a name that becomes reserved later must not stop the
// declaration already using it from being edited or retired.
export const validateKey = (
	raw: string,
): 'invalid_key' | 'reserved_key' | null => {
	const key = raw.trim()
	if (!ATTRIBUTE_KEY_PATTERN.test(key)) return 'invalid_key'
	if (ATTRIBUTE_RESERVED_KEYS.has(key)) return 'reserved_key'
	return null
}

export const validateDeclaration = (
	input: DeclarationInput,
	ctx: DeclarationContext,
): DeclarationCheck => {
	if (ctx.stackOwnerUserId !== null)
		return { ok: false, reason: 'stack_not_org' }
	if (ctx.stackAgent !== 'research')
		return { ok: false, reason: 'agent_not_research' }

	const key = input.key.trim()
	const label = input.label.trim()
	if (label === '') return { ok: false, reason: 'label_required' }
	if (label.length > ATTRIBUTE_LABEL_MAX)
		return { ok: false, reason: 'label_too_long' }
	if (/[\r\n]/.test(label)) return { ok: false, reason: 'label_not_one_line' }

	if (!isKind(input.kind)) return { ok: false, reason: 'unknown_kind' }
	const kind = input.kind

	const enumValues = input.enumValues?.map(value => value.trim()) ?? null
	if (kind === 'enum') {
		if (enumValues === null || enumValues.length === 0)
			return { ok: false, reason: 'enum_values_required' }
		const seen = new Set<string>()
		for (const value of enumValues) {
			const folded = foldLabel(value)
			if (folded === '' || value.length > ATTRIBUTE_ENUM_VALUE_MAX)
				return { ok: false, reason: 'enum_value_invalid' }
			if (seen.has(folded)) return { ok: false, reason: 'enum_value_invalid' }
			seen.add(folded)
		}
	} else if (enumValues !== null && enumValues.length > 0) {
		return { ok: false, reason: 'enum_values_not_allowed' }
	}

	const unit = cleanText(input.unit)
	if (unit !== null && unit.length > ATTRIBUTE_UNIT_MAX)
		return { ok: false, reason: 'unit_too_long' }

	const description = cleanText(input.description)
	if (description !== null && description.length > ATTRIBUTE_DESCRIPTION_MAX)
		return { ok: false, reason: 'description_too_long' }

	const shape: DeclaredShape = {
		kind,
		enumValues: kind === 'enum' ? enumValues : null,
		unit,
	}
	if (ctx.sameKeyElsewhere.some(other => !sameShape(shape, other)))
		return { ok: false, reason: 'kind_mismatch' }

	if (input.isActive && ctx.activeOnStack >= ATTRIBUTES_PER_STACK_MAX)
		return { ok: false, reason: 'too_many_active' }

	return {
		ok: true,
		declaration: {
			key,
			label,
			...shape,
			description,
			isActive: input.isActive,
		},
	}
}

// ── Value rules ────────────────────────────────────────────────────────────

// What a value check needs from a declaration.
export interface DeclaredAttribute extends DeclaredShape {
	readonly key: string
}

export type WriteRefusal = 'undeclared_key' | 'wrong_kind'

// One value ready to store, with whatever the caller said about where it came
// from. Who set it is stamped by the caller, which is the only one that knows.
export interface CheckedValue {
	readonly value: AttributeValue
	readonly source_id?: string
	readonly quote?: string
	readonly as_of?: string
}

export interface AttributeWritePlan {
	readonly values: Readonly<Record<string, CheckedValue>>
	readonly removed: ReadonlyArray<string>
}

export type AttributeWriteCheck =
	| { readonly ok: true; readonly plan: AttributeWritePlan }
	| { readonly ok: false; readonly reason: WriteRefusal; readonly key: string }

// Check every key a caller wants to write. A null removes the key, declared or
// not, so a value under a retired key can still be cleared. Anything else has
// to sit under an active key and read as that key's kind; the first key that
// does not is named in the refusal. The notes beside a value are kept when
// they say something: a page, a quote, and a date that names a real day.
export const validateAttributeWrite = (
	declared: ReadonlyMap<string, DeclaredAttribute>,
	input: CompanyAttributesInput,
): AttributeWriteCheck => {
	const values: Array<[string, CheckedValue]> = []
	const removed: Array<string> = []
	for (const [key, given] of Object.entries(input)) {
		if (given === null) {
			removed.push(key)
			continue
		}
		const declaration = declared.get(key)
		if (declaration === undefined)
			return { ok: false, reason: 'undeclared_key', key }
		const wrapped = typeof given === 'object'
		const raw = wrapped ? given.value : given
		const value = coerceAttributeValue(
			declaration.kind,
			raw,
			declaration.enumValues,
		)
		if (value === null) return { ok: false, reason: 'wrong_kind', key }
		if (!wrapped) {
			values.push([key, { value }])
			continue
		}
		// A page address longer than any real one is dropped; a quote is only a
		// note, so an over-long one is cut rather than refused.
		const sourceText = cleanText(given.source_id ?? null)
		const sourceId =
			sourceText !== null && sourceText.length <= ATTRIBUTE_SOURCE_MAX
				? sourceText
				: null
		const quote =
			cleanText(given.quote ?? null)?.slice(0, ATTRIBUTE_QUOTE_MAX) ?? null
		const asOfText = cleanText(given.as_of ?? null)
		const asOf = asOfText !== null && isCalendarDay(asOfText) ? asOfText : null
		values.push([
			key,
			{
				value,
				...(sourceId === null ? {} : { source_id: sourceId }),
				...(quote === null ? {} : { quote }),
				...(asOf === null ? {} : { as_of: asOf }),
			},
		])
	}
	return {
		ok: true,
		plan: { values: Object.fromEntries(values), removed },
	}
}

// ── Filter rules ───────────────────────────────────────────────────────────

export type FilterRefusal =
	| 'filter_incomplete'
	| 'unknown_operator'
	| 'operator_not_for_kind'
	| 'value_not_for_kind'

// A filter ready to turn into SQL. A key nobody declared matches nothing rather
// than failing: a saved view may outlive the declaration it was built on.
export type AttributeFilter =
	| {
			readonly key: string
			readonly kind: AttributeKind
			readonly op: AttributeOp
			// One value, or several for `in`.
			readonly values: ReadonlyArray<AttributeValue>
	  }
	| { readonly key: string; readonly undeclared: true }

export type AttributeFilterCheck =
	| { readonly ok: true; readonly filter: AttributeFilter | undefined }
	| { readonly ok: false; readonly reason: FilterRefusal }

// The three parts of a filter come separately over HTTP and MCP. All three or
// none: two of them cannot mean anything. For `in`, the value is the choices
// separated by commas.
export const validateAttributeFilter = (
	declared: ReadonlyMap<string, DeclaredAttribute>,
	parts: {
		readonly key?: string | undefined
		readonly op?: string | undefined
		readonly value?: string | undefined
	},
): AttributeFilterCheck => {
	const given = [parts.key, parts.op, parts.value].filter(
		part => part !== undefined,
	)
	if (given.length === 0) return { ok: true, filter: undefined }
	if (
		parts.key === undefined ||
		parts.op === undefined ||
		parts.value === undefined
	)
		return { ok: false, reason: 'filter_incomplete' }

	const key = parts.key.trim()
	if (!isOp(parts.op)) return { ok: false, reason: 'unknown_operator' }
	const op = parts.op
	const declaration = declared.get(key)
	if (declaration === undefined)
		return { ok: true, filter: { key, undeclared: true } }
	if (!OPS_FOR_KIND[declaration.kind].includes(op))
		return { ok: false, reason: 'operator_not_for_kind' }

	const rawValues =
		op === 'in'
			? parts.value
					.split(',')
					.map(part => part.trim())
					.filter(part => part !== '')
			: [parts.value]
	const values: Array<AttributeValue> = []
	for (const raw of rawValues) {
		const value = coerceAttributeValue(
			declaration.kind,
			raw,
			declaration.enumValues,
		)
		if (value === null) return { ok: false, reason: 'value_not_for_kind' }
		values.push(value)
	}
	if (values.length === 0) return { ok: false, reason: 'value_not_for_kind' }
	return { ok: true, filter: { key, kind: declaration.kind, op, values } }
}

// ── SQL ────────────────────────────────────────────────────────────────────

// transformResultNames camelCases result keys, so snake_case columns read back
// camelCased. The SELECTs keep the real (snake) column names.
interface AttributeRow {
	readonly id: string
	readonly organizationId: string
	readonly stackId: string
	readonly stackName: string
	readonly key: string
	readonly label: string
	readonly kind: AttributeKind
	readonly enumValues: ReadonlyArray<string> | null
	readonly unit: string | null
	readonly description: string | null
	readonly isActive: boolean
	readonly createdBy: string
	readonly createdAt: string
	readonly updatedAt: string
}

const ATTRIBUTE_COLUMNS = `a.id, a.organization_id, a.stack_id, s.name AS stack_name, a.key, a.label, a.kind, a.enum_values, a.unit, a.description, a.is_active, a.created_by, a.created_at::text AS created_at, a.updated_at::text AS updated_at`

const ATTRIBUTE_TABLES = `research_attributes a JOIN instruction_stacks s ON s.id = a.stack_id`

const toAttribute = (row: AttributeRow): ResearchAttribute => ({
	id: row.id,
	organizationId: row.organizationId,
	stackId: row.stackId,
	stackName: row.stackName,
	key: row.key,
	label: row.label,
	kind: row.kind,
	enumValues: row.enumValues,
	unit: row.unit,
	description: row.description,
	isActive: row.isActive,
	createdBy: row.createdBy,
	createdAt: row.createdAt,
	updatedAt: row.updatedAt,
})

export const toDeclaration = (
	attribute: ResearchAttribute,
): ResearchAttributeDeclaration => ({
	key: attribute.key,
	label: attribute.label,
	kind: attribute.kind,
	enumValues: attribute.enumValues,
	unit: attribute.unit,
	description: attribute.description,
})

// Every declaration the actor can read, optionally one stack's or one agent's.
// Retired ones included, so a settings page can show and revive them.
export const listAttributes = (filter: {
	readonly stackId?: string | undefined
	readonly agent?: Agent | undefined
}): Eff<ReadonlyArray<ResearchAttribute>> =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		if (filter.stackId !== undefined && !isUuidRef(filter.stackId)) return []
		const stackId = filter.stackId ?? null
		const agent = filter.agent ?? null
		const rows = yield* sql<AttributeRow>`
			SELECT ${sql.unsafe(ATTRIBUTE_COLUMNS)}
			FROM ${sql.unsafe(ATTRIBUTE_TABLES)}
			WHERE (${stackId}::uuid IS NULL OR a.stack_id = ${stackId}::uuid)
				AND (${agent}::text IS NULL OR s.agent = ${agent}::text)
			ORDER BY s.name ASC, a.created_at ASC, a.key ASC
		`
		return rows.map(toAttribute)
	})

// The declarations a value may be written under right now, across every stack
// of the organisation. Two stacks declaring one key agree on its shape, so the
// caller may keep the first per key. The organisation is named as well as
// left to row-level security, so a caller on a connection that sees every
// tenant still gets one organisation's declarations.
export const listActiveAttributes = (
	organizationId: string,
): Eff<ReadonlyArray<ResearchAttribute>> =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const rows = yield* sql<AttributeRow>`
			SELECT ${sql.unsafe(ATTRIBUTE_COLUMNS)}
			FROM ${sql.unsafe(ATTRIBUTE_TABLES)}
			WHERE a.organization_id = ${organizationId} AND a.is_active
			ORDER BY s.name ASC, a.created_at ASC, a.key ASC
		`
		return rows.map(toAttribute)
	})

// The active declarations keyed by key — what the value and filter checks read.
export const declaredByKey = (
	attributes: ReadonlyArray<ResearchAttribute>,
): ReadonlyMap<string, DeclaredAttribute> => {
	const byKey = new Map<string, DeclaredAttribute>()
	for (const attribute of attributes) {
		if (byKey.has(attribute.key)) continue
		byKey.set(attribute.key, {
			key: attribute.key,
			kind: attribute.kind,
			enumValues: attribute.enumValues,
			unit: attribute.unit,
		})
	}
	return byKey
}

export const getAttribute = (id: string): Eff<ResearchAttribute | undefined> =>
	Effect.gen(function* () {
		if (!isUuidRef(id)) return undefined
		const sql = yield* SqlClient.SqlClient
		const rows = yield* sql<AttributeRow>`
			SELECT ${sql.unsafe(ATTRIBUTE_COLUMNS)}
			FROM ${sql.unsafe(ATTRIBUTE_TABLES)}
			WHERE a.id = ${id} LIMIT 1
		`
		const row = rows[0]
		return row ? toAttribute(row) : undefined
	})

// What a research run is asked to fill for one stack: the active declarations,
// in the order they were declared.
export const readStackAttributesForRun = (
	sql: SqlClient.SqlClient,
	stackId: string,
): Effect.Effect<
	ReadonlyArray<ResearchAttributeDeclaration>,
	SqlError.SqlError
> =>
	Effect.map(
		sql<{
			key: string
			label: string
			kind: AttributeKind
			enumValues: ReadonlyArray<string> | null
			unit: string | null
			description: string | null
		}>`
			SELECT key, label, kind, enum_values, unit, description
			FROM research_attributes
			WHERE stack_id = ${stackId} AND is_active
			ORDER BY created_at ASC, key ASC
		`,
		rows =>
			rows.map(row => ({
				key: row.key,
				label: row.label,
				kind: row.kind,
				enumValues: row.enumValues,
				unit: row.unit,
				description: row.description,
			})),
	)

interface StackForWrite {
	readonly id: string
	readonly organizationId: string
	readonly ownerUserId: string | null
	readonly agent: string
}

const readStack = (
	sql: SqlClient.SqlClient,
	stackId: string,
): Effect.Effect<StackForWrite | undefined, SqlError.SqlError> =>
	isUuidRef(stackId)
		? Effect.map(
				sql<StackForWrite>`
					SELECT id, organization_id, owner_user_id, agent
					FROM instruction_stacks WHERE id = ${stackId}
				`,
				rows => rows[0],
			)
		: Effect.succeed(undefined)

// One writer at a time per organisation for the rest of the transaction. The
// rules below count and compare across every stack of the organisation, so a
// lock on one stack's row would let two writers on two stacks each pass a
// check the other's write breaks.
const lockDeclarations = (
	sql: SqlClient.SqlClient,
	organizationId: string,
): Effect.Effect<void, SqlError.SqlError> =>
	Effect.asVoid(
		sql`SELECT pg_advisory_xact_lock(hashtext(${`research_attributes:${organizationId}`}))`,
	)

// What the rules count and compare across the organisation. The row being
// edited is left out, so an update is never held against its own current shape.
const readContext = (
	sql: SqlClient.SqlClient,
	stack: StackForWrite,
	key: string,
	excludeId: string | null,
): Effect.Effect<
	Pick<DeclarationContext, 'activeOnStack' | 'sameKeyElsewhere'>,
	SqlError.SqlError
> =>
	Effect.gen(function* () {
		const counted = yield* sql<{ n: number }>`
			SELECT count(*)::int AS n FROM research_attributes
			WHERE stack_id = ${stack.id} AND is_active
				AND (${excludeId}::uuid IS NULL OR id <> ${excludeId}::uuid)
		`
		const elsewhere = yield* sql<DeclaredShape>`
			SELECT kind, enum_values, unit FROM research_attributes
			WHERE organization_id = ${stack.organizationId}
				AND key = ${key}
				AND (${excludeId}::uuid IS NULL OR id <> ${excludeId}::uuid)
		`
		return {
			activeOnStack: counted[0]?.n ?? 0,
			sameKeyElsewhere: elsewhere,
		}
	})

// Whether any company of the organisation holds a value under the key.
const valuesExist = (
	sql: SqlClient.SqlClient,
	organizationId: string,
	key: string,
): Effect.Effect<boolean, SqlError.SqlError> =>
	Effect.map(
		sql<{ one: number }>`
			SELECT 1 AS one FROM companies
			WHERE organization_id = ${organizationId} AND attributes ? ${key}
			LIMIT 1
		`,
		rows => rows[0] !== undefined,
	)

export type AttributeWriteResult =
	| { readonly ok: true; readonly attribute: ResearchAttribute }
	| {
			readonly ok: false
			readonly reason: DeclarationRefusal | 'unknown_stack' | 'duplicate_key'
	  }

export interface CreateAttributeInput {
	readonly stackId: string
	readonly key: string
	readonly label: string
	readonly kind: string
	readonly enumValues: ReadonlyArray<string> | null
	readonly unit: string | null
	readonly description: string | null
	readonly createdBy: string
}

export const createAttribute = (
	input: CreateAttributeInput,
): Eff<AttributeWriteResult> =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const stack = yield* readStack(sql, input.stackId)
		if (!stack) return { ok: false as const, reason: 'unknown_stack' as const }
		const badKey = validateKey(input.key)
		if (badKey !== null) return { ok: false as const, reason: badKey }
		yield* lockDeclarations(sql, stack.organizationId)
		const context = yield* readContext(sql, stack, input.key.trim(), null)
		const check = validateDeclaration(
			{ ...input, isActive: true },
			{
				stackAgent: stack.agent,
				stackOwnerUserId: stack.ownerUserId,
				...context,
			},
		)
		if (!check.ok) return check
		const { declaration } = check
		// No rule above refuses a key the stack already declares: the unique
		// index is what catches it, and the catch at the end words it.
		const created = yield* sql<{ id: string }>`
			INSERT INTO research_attributes
				(organization_id, stack_id, key, label, kind, enum_values, unit, description, created_by)
			VALUES (
				${stack.organizationId}, ${stack.id}, ${declaration.key}, ${declaration.label},
				${declaration.kind}, ${declaration.enumValues}::text[], ${declaration.unit},
				${declaration.description}, ${input.createdBy}
			)
			RETURNING id
		`
		const id = created[0]?.id
		if (id === undefined)
			return yield* Effect.die('research attribute insert returned no row')
		const attribute = yield* getAttribute(id)
		if (!attribute)
			return yield* Effect.die('research attribute vanished after insert')
		return { ok: true as const, attribute }
	}).pipe(
		Effect.catchTag('SqlError', err =>
			isUniqueViolation(err)
				? Effect.succeed({
						ok: false as const,
						reason: 'duplicate_key' as const,
					})
				: Effect.fail(err),
		),
	)

// The key never changes: it is what companies already file their values
// under. Everything else may, and an explicit null clears the choice words,
// the unit or the description.
export interface UpdateAttributeFields {
	readonly label?: string | undefined
	readonly kind?: string | undefined
	readonly enumValues?: ReadonlyArray<string> | null | undefined
	readonly unit?: string | null | undefined
	readonly description?: string | null | undefined
	readonly isActive?: boolean | undefined
}

export const updateAttribute = (
	id: string,
	fields: UpdateAttributeFields,
): Eff<AttributeWriteResult | 'not_found'> =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const existing = yield* getAttribute(id)
		if (!existing) return 'not_found'
		const stack = yield* readStack(sql, existing.stackId)
		if (!stack) return 'not_found'
		yield* lockDeclarations(sql, stack.organizationId)
		const context = yield* readContext(sql, stack, existing.key, existing.id)
		const check = validateDeclaration(
			{
				key: existing.key,
				label: fields.label ?? existing.label,
				kind: fields.kind ?? existing.kind,
				enumValues:
					fields.enumValues === undefined
						? existing.enumValues
						: fields.enumValues,
				unit: fields.unit === undefined ? existing.unit : fields.unit,
				description:
					fields.description === undefined
						? existing.description
						: fields.description,
				isActive: fields.isActive ?? existing.isActive,
			},
			{
				stackAgent: stack.agent,
				stackOwnerUserId: stack.ownerUserId,
				...context,
			},
		)
		if (!check.ok) return check
		const { declaration } = check
		// Values companies already hold were read the old way. Changing how the
		// key reads would leave them matching no filter, so the shape stays put
		// while any value is under it; retire the key and declare a new one.
		if (
			!sameShape(existing, declaration) &&
			(yield* valuesExist(sql, stack.organizationId, existing.key))
		)
			return { ok: false as const, reason: 'key_in_use' as const }
		yield* sql`
			UPDATE research_attributes
			SET label = ${declaration.label},
				kind = ${declaration.kind},
				enum_values = ${declaration.enumValues}::text[],
				unit = ${declaration.unit},
				description = ${declaration.description},
				is_active = ${declaration.isActive},
				updated_at = now()
			WHERE id = ${id}
		`
		const attribute = yield* getAttribute(id)
		return attribute ? { ok: true as const, attribute } : 'not_found'
	})

// Values companies carry under the key stay: they are the organisation's data,
// and a key can be declared again.
export const deleteAttribute = (id: string): Eff<'deleted' | 'not_found'> =>
	Effect.gen(function* () {
		if (!isUuidRef(id)) return 'not_found'
		const sql = yield* SqlClient.SqlClient
		const deleted = yield* sql<{ id: string }>`
			DELETE FROM research_attributes WHERE id = ${id} RETURNING id
		`
		return deleted[0] ? 'deleted' : 'not_found'
	})

import { useLingui } from '@lingui/react/macro'
import { X } from 'lucide-react'
import { styled } from 'next-yak'
import { useEffect, useMemo, useRef, useState } from 'react'

import {
	ATTRIBUTE_OPS,
	type AttributeKind,
	type AttributeOp,
} from '@batuda/domain'
import { PriButton, PriInput } from '@batuda/ui/pri'

import type { AttributeDeclaration } from '#/components/instructions/attribute-shapes'
import { ALL, FilterSelect } from '#/components/shared/filter-select'
import { MultiSelectFilter } from '#/components/shared/multi-select-filter'
import { attributeEditText } from '#/lib/attribute-kinds'
import type { AttributeFilterSearch } from '#/lib/companies-search-params'
import {
	clampOp,
	opsFor,
	parseValueParam,
	valueParam,
} from './attribute-filter-logic'
import { readLocaleNumber } from './attribute-input'
import { resolveDeclarations } from './attribute-rows'

// The three params, set together or dropped together.
type AttributeFilterPatch = {
	readonly attributeKey: string | undefined
	readonly attributeOp: AttributeOp | undefined
	readonly attributeValue: string | undefined
}

const CLEARED: AttributeFilterPatch = {
	attributeKey: undefined,
	attributeOp: undefined,
	attributeValue: undefined,
}

const isOp = (value: unknown): value is AttributeOp =>
	typeof value === 'string' &&
	(ATTRIBUTE_OPS as ReadonlyArray<string>).includes(value)

// What the control shows and is setting up: which attribute, how to compare, the
// value as a box holds it, and the words a "one of" list has ticked. This is what
// is drawn — the address is read where this is seeded from it, never straight
// onto the screen, so a half-chosen filter is never overwritten mid-thought.
type Draft = {
	readonly key: string | null
	readonly op: AttributeOp | null
	readonly text: string
	readonly words: ReadonlyArray<string>
}

const NOTHING_CHOSEN: Draft = { key: null, op: null, text: '', words: [] }

// The draft a filter in the address reads as: its key and comparison, and its
// value in whichever shape the attribute's own control needs.
function draftFrom(
	key: string,
	rawOp: unknown,
	value: string,
	declarations: ReadonlyArray<AttributeDeclaration>,
	locale: string,
): Draft {
	const declaration = declarations.find(d => d.key === key) ?? null
	const kind = declaration?.kind ?? 'text'
	// Kept as the address wrote it rather than held to the kind here: the
	// declarations may still be on their way, and what the comparison is allowed
	// to be is worked out again on every render, once the kind is known.
	const op = isOp(rawOp) ? rawOp : null
	const held = parseValueParam(
		kind,
		clampOp(kind, op),
		value,
		declaration?.enumValues ?? [],
	)
	return { key, op, text: boxText(kind, held.text, locale), words: held.values }
}

// The value as the box shows it. A number travels as plain digits and is shown
// the way the reader's own screen writes one, so what they read back is what
// they would type; anything the address holds that is not a number is shown as
// it stands, or there would be no way to see it and clear it.
function boxText(kind: AttributeKind, text: string, locale: string): string {
	if (kind !== 'number') return text
	const number = Number(text)
	return text !== '' && Number.isFinite(number)
		? attributeEditText('number', number, locale)
		: text
}

// The filter the address holds, or nothing chosen where it holds none: the three
// params mean something only together, so two of them are no filter at all.
function draftFromSearch(
	search: AttributeFilterSearch,
	declarations: ReadonlyArray<AttributeDeclaration>,
	locale: string,
): Draft {
	const { attributeKey, attributeOp, attributeValue } = search
	return attributeKey === undefined || attributeValue === undefined
		? NOTHING_CHOSEN
		: draftFrom(attributeKey, attributeOp, attributeValue, declarations, locale)
}

// The address value written the way this control writes one, so what is in force
// can be compared with what is about to be asked for.
function canonicalParam(
	kind: AttributeKind,
	op: AttributeOp,
	value: string,
	enumValues: ReadonlyArray<string>,
): string | null {
	const held = parseValueParam(kind, op, value, enumValues)
	return valueParam(kind, op, op === 'in' ? held.values : held.text, enumValues)
}

// The words in a draft that the declaration behind it does not list.
function undeclaredWords(
	draft: Draft,
	declarations: ReadonlyArray<AttributeDeclaration>,
): ReadonlyArray<string> {
	if (draft.key === null || draft.op !== 'in') return []
	const declaration = declarations.find(d => d.key === draft.key) ?? null
	if (declaration === null) return []
	return draft.words.filter(word => !declaration.enumValues.includes(word))
}

/**
 * Narrow the companies by one of the facts the organisation declares: which
 * attribute, how to compare, and what against.
 *
 * The address is the filter and this control edits it. What is on screen is
 * always the draft below, read off the address when the control appears and read
 * off it again whenever it changes — a value landing, the back button, a saved
 * view.
 *
 * A value is applied as soon as it says something the list can be narrowed by: on
 * the change for a dropdown or a ticked word, on Enter or on leaving the box for
 * one that is typed. Picking another comparison applies at once as well, where the
 * value already there still says something under it, so the control never shows a
 * whole filter the list was not narrowed by. Where it does not — an empty box, or
 * a word that has to be picked afresh from a dropdown — the filter in force is
 * lifted instead: the question has changed, and the list must not stay narrowed by
 * the one being replaced. Picking another attribute always lifts it, and what has
 * been picked has to survive the address going empty. A value that says nothing
 * applies nothing, and the control goes back to showing the value in force.
 */
export function AttributeFilter({
	declarations,
	search,
	onApply,
}: {
	// Null until the declarations are in — still loading, or the fetch failed —
	// which is not the same as none declared.
	readonly declarations: ReadonlyArray<AttributeDeclaration> | null
	readonly search: AttributeFilterSearch
	readonly onApply: (patch: AttributeFilterPatch) => void
}) {
	const { i18n, t } = useLingui()
	const resolved = useMemo(
		() => resolveDeclarations(declarations ?? []),
		[declarations],
	)
	const [draft, setDraft] = useState<Draft>(() =>
		draftFromSearch(search, resolved, i18n.locale),
	)
	// Set for the one navigation this control makes to lift a filter it is
	// replacing, and read by the effect below: the address goes empty on purpose
	// there, and what is being set up must not be swept away with it.
	const keepingPick = useRef(false)
	// Every word read off the address that the attribute does not declare, kept for
	// as long as this control stands. Unticking one would otherwise take it off the
	// list of words on offer, and the list holds its order while it is open — so the
	// row would come back with a count of nothing beside a word nobody can see.
	const undeclaredSeen = useRef<{
		readonly key: string | null
		readonly words: ReadonlyArray<string>
	}>({ key: null, words: [] })

	const { attributeKey, attributeOp, attributeValue } = search
	// The address can change without this control — the back button, a saved view,
	// "Clear filters", a link somebody sent — and it is the filter, so the control
	// follows it.
	// biome-ignore lint/correctness/useExhaustiveDependencies: the declarations are read as they stand, and their arriving must not throw away a filter being set up
	useEffect(() => {
		if (attributeKey === undefined || attributeValue === undefined) {
			if (keepingPick.current) {
				keepingPick.current = false
				return
			}
			setDraft(NOTHING_CHOSEN)
			return
		}
		keepingPick.current = false
		const seeded = draftFrom(
			attributeKey,
			attributeOp,
			attributeValue,
			resolved,
			i18n.locale,
		)
		const remembered =
			undeclaredSeen.current.key === seeded.key
				? undeclaredSeen.current.words
				: []
		undeclaredSeen.current = {
			key: seeded.key,
			words: [
				...new Set([...remembered, ...undeclaredWords(seeded, resolved)]),
			],
		}
		setDraft(seeded)
	}, [attributeKey, attributeOp, attributeValue])

	const chosenKey = draft.key
	const declaration =
		chosenKey === null
			? null
			: (resolved.find(d => d.key === chosenKey) ?? null)
	const kind: AttributeKind = declaration?.kind ?? 'text'
	const op = clampOp(kind, draft.op)
	const declaredWords = declaration?.enumValues ?? []
	// The filter in force, as this control would have written it. A comparison the
	// address spells in a way nothing here knows is no filter to compare against.
	const appliedOp = isOp(attributeOp) ? attributeOp : null
	const appliedParam =
		attributeKey === undefined ||
		attributeValue === undefined ||
		appliedOp === null
			? null
			: canonicalParam(kind, appliedOp, attributeValue, declaredWords)

	// The value narrowing the list, back on screen: the one the address holds for
	// this attribute and comparison, or an empty value where it holds none, so the
	// control never shows a value the list was not narrowed by.
	const restoreValue = () => {
		const held = draftFromSearch(search, resolved, i18n.locale)
		setDraft(kept =>
			held.key === kept.key && held.op === kept.op
				? held
				: { ...kept, text: '', words: [] },
		)
	}

	// What the address would hold for this value under this comparison, or null
	// where it says nothing the list can be narrowed by. A number is typed the way
	// the reader's own screen writes one — "1.200" is twelve hundred in Catalan and
	// one and a fifth in English — so it is read by the locale first, and what
	// travels is the machine number as text.
	const paramFor = (
		nextOp: AttributeOp,
		raw: string | ReadonlyArray<string>,
	): string | null => {
		const asked =
			kind === 'number' && typeof raw === 'string'
				? readLocaleNumber(raw.trim(), i18n.locale)
				: raw
		return asked === null
			? null
			: valueParam(kind, nextOp, asked, declaredWords)
	}

	const applyValue = (
		nextOp: AttributeOp,
		raw: string | ReadonlyArray<string>,
	) => {
		if (chosenKey === null) return
		const param = paramFor(nextOp, raw)
		if (param === null) {
			restoreValue()
			return
		}
		// Already the filter in force, whatever spelling the address wrote it in:
		// leaving a box nobody changed would otherwise ask for `007` all over again
		// as 7 and leave a dead step in the history behind.
		if (
			chosenKey === attributeKey &&
			nextOp === appliedOp &&
			param === appliedParam
		) {
			return
		}
		onApply({
			attributeKey: chosenKey,
			attributeOp: nextOp,
			attributeValue: param,
		})
	}

	// Lifts the filter in force so another can be set up in its place. The pick
	// itself is already in the draft, and nothing but the ref keeps the effect
	// above from reading the empty address as "nothing chosen".
	const liftForPick = () => {
		if (attributeKey === undefined) return
		keepingPick.current = true
		onApply(CLEARED)
	}

	// Lifts the filter and asks nothing in its place: the ×, "any attribute", "any
	// value", and a "one of" list with nothing left ticked all say this.
	const clear = () => {
		setDraft(NOTHING_CHOSEN)
		if (attributeKey !== undefined) onApply(CLEARED)
	}

	const clearButton = (
		<ClearButton
			type='button'
			$variant='text'
			onClick={clear}
			aria-label={t`Clear the attribute filter`}
			data-testid='companies-filter-attribute-clear'
		>
			<X size={14} aria-hidden />
		</ClearButton>
	)

	// Nothing is known about the attributes yet. A filter in force is still shown
	// by its key, so a list that came back short says why, but nothing about the
	// key can be claimed or edited until the declarations land.
	if (declarations === null) {
		if (chosenKey === null) return null
		return (
			<Group>
				<KeyChip
					type='button'
					$variant='outlined'
					disabled
					focusableWhenDisabled
					aria-label={t`Attribute ${chosenKey}`}
					data-testid='companies-filter-attribute'
				>
					{chosenKey}
				</KeyChip>
				{clearButton}
			</Group>
		)
	}

	// Nothing to offer and nothing in force: the organisation declares no facts
	// to narrow by, so the row is one control shorter.
	if (resolved.length === 0 && chosenKey === null) return null

	// A key nobody declares any more — a saved view or an old link. It cannot be
	// edited, but it is shown rather than hidden: otherwise the list comes back
	// short with nothing on screen saying why.
	if (chosenKey !== null && declaration === null) {
		return (
			<Group>
				<KeyChip
					type='button'
					$variant='outlined'
					disabled
					focusableWhenDisabled
					aria-label={t`Attribute ${chosenKey}, no longer declared`}
					data-testid='companies-filter-attribute'
				>
					{chosenKey}
				</KeyChip>
				{clearButton}
			</Group>
		)
	}

	const attributeItems = [
		{ value: ALL, label: t`Any attribute` },
		...resolved.map(d => ({ value: d.key, label: d.label })),
	]
	const opLabels: Record<AttributeOp, string> = {
		eq: t`is`,
		in: t`is one of`,
		contains: t`contains`,
		gte: t`at least`,
		lte: t`at most`,
	}
	const opItems = opsFor(kind).map(value => ({
		value,
		label: opLabels[value],
	}))
	const chosenWord = draft.text.trim()
	const offeredWords = kind === 'boolean' ? ['true', 'false'] : declaredWords
	const rememberedWords =
		undeclaredSeen.current.key === chosenKey ? undeclaredSeen.current.words : []
	// A word the filter was read with that is not on offer — one the declaration has
	// since dropped, or one no kind can read, like "maybe" for a yes/no — keeps its
	// place for as long as this control stands, or there is no way to read the
	// filter, and no way to take that word off it.
	const extraWords = [
		...new Set(
			op === 'in' ? [...rememberedWords, ...draft.words] : [chosenWord],
		),
	].filter(word => word !== '' && !offeredWords.includes(word))
	const unit = declaration?.unit ?? null

	const pickAttribute = (next: string) => {
		if (next === ALL) {
			clear()
			return
		}
		setDraft({ key: next, op: null, text: '', words: [] })
		liftForPick()
	}

	const pickOp = (next: string) => {
		if (!isOp(next) || chosenKey === null) return
		// Coming back from "one of", the first word is what the single value means.
		const carried =
			op === 'in' && next !== 'in' ? (draft.words[0] ?? '') : draft.text
		// Nothing is carried where the value is picked from a dropdown: one already
		// showing that word could not be picked again to apply it, leaving a value on
		// screen that narrows nothing.
		const picksOneWord =
			next !== 'in' && (kind === 'enum' || kind === 'boolean')
		const held = parseValueParam(
			kind,
			next,
			picksOneWord ? '' : carried,
			declaredWords,
		)
		setDraft({ key: chosenKey, op: next, text: held.text, words: held.values })
		const value = next === 'in' ? held.values : held.text
		// The value still says something under the new comparison, so the list is
		// narrowed by it at once: a control showing a whole filter that nothing on
		// the page was narrowed by reads as a page that ignored the reader.
		if (paramFor(next, value) !== null) {
			applyValue(next, value)
			return
		}
		liftForPick()
	}

	const pickValue = (next: string) => {
		if (next === ALL) {
			clear()
			return
		}
		setDraft(kept => ({ ...kept, text: next, words: [] }))
		applyValue(op, next)
	}

	// A value on its way to being typed is not another question yet, so the filter
	// in force stays in force until this one is worth applying.
	const typeValue = (typed: string) => {
		setDraft(kept => ({
			...kept,
			text: typed,
			// A box holding a "one of" list keeps its words in step with it, so
			// switching back to a single value carries the first of them.
			words:
				op === 'in'
					? parseValueParam(kind, op, typed, declaredWords).values
					: kept.words,
		}))
	}

	const toggleWord = (word: string) => {
		if (chosenKey === null) return
		const next = draft.words.includes(word)
			? draft.words.filter(other => other !== word)
			: [...draft.words, word]
		setDraft(kept => ({ ...kept, words: next, text: next.join(', ') }))
		const param = valueParam(kind, op, next, declaredWords)
		// Nothing the declaration still lists: the filter is lifted rather than left
		// standing on words nobody declares.
		if (param === null) {
			clear()
			return
		}
		onApply({
			attributeKey: chosenKey,
			attributeOp: op,
			attributeValue: param,
		})
	}

	return (
		<Group>
			<SelectSlot>
				<FilterSelect
					label={t`Attribute`}
					value={chosenKey ?? ALL}
					options={attributeItems}
					onChange={pickAttribute}
					testId='companies-filter-attribute'
				/>
			</SelectSlot>
			{declaration === null ? null : (
				<>
					<SelectSlot>
						<FilterSelect
							label={t`How to compare`}
							value={op}
							options={opItems}
							onChange={pickOp}
							testId='companies-filter-attribute-op'
						/>
					</SelectSlot>
					<ValueSlot>
						{kind === 'enum' && op === 'in' ? (
							<MultiSelectFilter
								label={t`Value`}
								options={[...declaredWords, ...extraWords].map(word => ({
									value: word,
									label: word,
								}))}
								selected={draft.words}
								onToggle={toggleWord}
								onClear={clear}
								describeCount={count => t`${count} companies`}
								testId='companies-filter-attribute-value'
							/>
						) : kind === 'enum' || kind === 'boolean' ? (
							<FilterSelect
								label={t`Value`}
								// No value yet reads as "any", since a dropdown always points
								// at one of its own options.
								value={chosenWord === '' ? ALL : chosenWord}
								options={[
									{ value: ALL, label: t`Any value` },
									...(kind === 'boolean'
										? [
												{ value: 'true', label: t`Yes` },
												{ value: 'false', label: t`No` },
											]
										: declaredWords.map(word => ({
												value: word,
												label: word,
											}))),
									...extraWords.map(word => ({
										value: word,
										label: word,
									})),
								]}
								onChange={pickValue}
								testId='companies-filter-attribute-value'
							/>
						) : (
							<PriInput
								// Never `type='number'`: it reports nothing at all for anything
								// it cannot parse while leaving what was typed on screen, so a
								// half-written number reads here as an empty box.
								type={kind === 'date' ? 'date' : 'text'}
								{...(kind === 'number'
									? { inputMode: 'decimal' as const }
									: {})}
								value={draft.text}
								onChange={event => {
									typeValue(event.target.value)
								}}
								onBlur={() => applyValue(op, draft.text)}
								onKeyDown={event => {
									if (event.key !== 'Enter') return
									event.preventDefault()
									applyValue(op, draft.text)
								}}
								aria-label={t`Value`}
								{...(op === 'in'
									? // Several values in one box: nothing else on screen says
										// how to write more than one.
										{ placeholder: t`Comma-separated` }
									: kind === 'number' && unit !== null && unit !== ''
										? { placeholder: unit }
										: {})}
								data-testid='companies-filter-attribute-value'
							/>
						)}
					</ValueSlot>
					{clearButton}
				</>
			)}
		</Group>
	)
}

// ── Styles ───────────────────────────────────────────────────────

// Three controls that mean one filter, so they stay together: a line of their
// own on a phone, and a wider share of the row once there is room for the rest
// of the filters beside them.
const Group = styled.div`
	display: flex;
	flex-wrap: wrap;
	align-items: stretch;
	gap: var(--space-2xs);
	flex: 1 1 100%;
	min-width: 0;

	@media (min-width: 768px) {
		flex: 2 1 24rem;
	}
`

// A dropdown gets its width from here rather than from the group, so the pieces
// that set their own — the clear button, a bare key — are not overruled by a
// rule aimed at every button inside it.
const SelectSlot = styled.div`
	display: flex;
	flex: 1 1 6rem;
	min-width: 0;

	> button {
		width: 100%;
	}
`

// The value takes the larger share: a date or a name needs the room, and the
// two dropdowns beside it are as wide as their words.
const ValueSlot = styled.div`
	display: flex;
	flex: 2 1 8rem;
	min-width: 0;

	> button {
		width: 100%;
	}
`

const KeyChip = styled(PriButton)`
	/* Shown, never stretched: it is the key as stored, not a label, so there is
	 * nothing to gain from giving it the room a name would need. */
	flex: 0 1 auto;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	text-transform: none;
`

const ClearButton = styled(PriButton)`
	flex: 0 0 auto;
	padding-inline: var(--space-xs);
`

import { Trans, useLingui } from '@lingui/react/macro'
import { Link } from '@tanstack/react-router'
import { styled } from 'next-yak'
import { useState } from 'react'

import { ATTRIBUTE_TEXT_MAX } from '@batuda/domain'
import { PriButton } from '@batuda/ui/pri'

import { readAttributeInput } from '#/components/companies/attribute-input'
import type { StoredAttribute } from '#/components/companies/attribute-rows'
import type { AttributeDeclaration } from '#/components/instructions/attribute-shapes'
import { SafeLink } from '#/components/research/safe-link'
import {
	EditableField,
	EditableSelect,
} from '#/components/shared/editable-field'
import { RelativeDate } from '#/components/shared/relative-date'
import {
	attributeEditText,
	formatAttributeValue,
	inferKind,
} from '#/lib/attribute-kinds'
import { sourceHost } from '#/lib/source-host'
import { agedPaperRow, stenciledTitle } from '#/lib/workshop-mixins'

// A dropdown needs a way back to nothing, and an empty option is it. The dash
// is a mark rather than a word, so it reads the same in every language.
const CLEAR_OPTION = { value: '', label: '—' }

/**
 * Where a value a research run read came from — the page, the run, when it was
 * read and the sentence it came from — because a number nobody can check is a
 * number nobody can argue with. Nothing for a value a person set themselves.
 */
function AttributeTrail({
	attributeKey,
	stored,
}: {
	readonly attributeKey: string
	readonly stored: StoredAttribute
}) {
	if (stored.setBy !== 'research') return null
	return (
		<Trail data-testid={`company-attribute-trail-${attributeKey}`}>
			<TrailLine>
				{stored.sourceUrl !== null ? (
					// The address was read off a page the run found, so it is only made
					// clickable when it is an ordinary web address.
					<TrailLinkWrap>
						<SafeLink href={stored.sourceUrl}>
							{sourceHost(stored.sourceUrl)}
						</SafeLink>
					</TrailLinkWrap>
				) : null}
				{stored.researchId !== null ? (
					<RunLinkWrap>
						<Link to='/research/$id' params={{ id: stored.researchId }}>
							<Trans>run</Trans>
						</Link>
					</RunLinkWrap>
				) : null}
				{stored.asOf !== null ? (
					<Qualifier>
						<Trans>as of</Trans> <RelativeDate value={stored.asOf} />
					</Qualifier>
				) : null}
				<SetByTag>
					<Trans>from research</Trans>
				</SetByTag>
			</TrailLine>
			{stored.quote !== null ? <Quote>“{stored.quote}”</Quote> : null}
		</Trail>
	)
}

/**
 * One declared attribute on a company, editable the way its kind asks to be:
 * a box for text, a number or a day, a dropdown for a choice or a yes/no.
 */
export function AttributeField({
	declaration,
	stored,
	onSave,
}: {
	readonly declaration: AttributeDeclaration
	readonly stored: StoredAttribute | null
	readonly onSave: (field: string, next: unknown) => Promise<void>
}) {
	const { t, i18n } = useLingui()
	const [error, setError] = useState<string | null>(null)
	const { key, kind, label, unit, enumValues } = declaration

	// Editing works on the value written in the reader's own marks, which is what
	// the box reads back. The reading printed beside it carries the unit too, and
	// is only for looking at.
	const raw =
		stored === null ? null : attributeEditText(kind, stored.value, i18n.locale)
	const shown =
		stored === null
			? undefined
			: formatAttributeValue(kind, stored.value, {
					locale: i18n.locale,
					unit,
					yes: t`Yes`,
					no: t`No`,
				})

	// Only the typed kinds can be got wrong. A dropdown offers the words the
	// declaration allows and nothing else, so it has nothing to be told.
	const hint =
		kind === 'number'
			? t`Enter a whole or decimal number.`
			: kind === 'date'
				? t`Enter a day as YYYY-MM-DD.`
				: t`Keep this to ${ATTRIBUTE_TEXT_MAX} characters or fewer.`

	const save = async (next: string | null) => {
		// Whatever was refused last time is answered for by this attempt, so it
		// goes before anything else can leave it standing.
		setError(null)
		// A number is read in the reader's own marks, the ones the value beside
		// the box is printed with.
		const read = readAttributeInput(kind, next, enumValues, i18n.locale)
		if (read.outcome === 'invalid') {
			setError(hint)
			// Throwing is what keeps the box open with what was typed still in it.
			throw new Error('attribute-invalid')
		}
		await onSave('attributes', {
			[key]: read.outcome === 'clear' ? null : read.value,
		})
	}

	const trail =
		stored === null ? undefined : (
			<AttributeTrail attributeKey={key} stored={stored} />
		)

	if (kind === 'enum' || kind === 'boolean') {
		const options =
			kind === 'boolean'
				? [
						CLEAR_OPTION,
						{ value: 'true', label: t`Yes` },
						{ value: 'false', label: t`No` },
					]
				: [
						CLEAR_OPTION,
						...enumValues.map(word => ({ value: word, label: word })),
					]
		return (
			<EditableSelect
				label={label}
				value={raw}
				options={options}
				onSave={save}
				trail={trail}
				testId={`company-attribute-${key}`}
			/>
		)
	}

	return (
		<EditableField
			label={label}
			value={raw}
			displayValue={shown}
			// A number goes in an ordinary text box: the native number box answers
			// with nothing at all for "12e" or "2,5", which would clear the value
			// instead of saying it could not read it, and it fights a reader typing
			// the comma their own screen shows them.
			type={kind === 'date' ? 'date' : 'text'}
			inputMode={kind === 'number' ? 'decimal' : undefined}
			// The unit belongs in the box while typing too, so nobody writes it into
			// the value and stores "12 sites" where a number goes.
			placeholder={unit ?? undefined}
			onSave={save}
			onCancel={() => setError(null)}
			trail={trail}
			error={error ?? undefined}
			testId={`company-attribute-${key}`}
		/>
	)
}

/**
 * A stored value shown as it sits: under the words it was declared with when
 * they are still around, under its bare key when they are not.
 *
 * Two screens use it. The keys nobody declares any more, which can be read or
 * cleared but not edited — there is no kind left to check a new value against.
 * And every value on a company while the page does not yet know what the
 * organisation declares, where nothing may be cleared either, because a key
 * that looks undeclared may simply not have arrived yet.
 */
export function StoredAttributeRow({
	attributeKey,
	stored,
	declaration,
	onClear,
	testId,
}: {
	readonly attributeKey: string
	readonly stored: StoredAttribute
	readonly declaration: AttributeDeclaration | null
	// Without one the row is read-only.
	readonly onClear?: (() => Promise<void>) | undefined
	readonly testId: string
}) {
	const { t, i18n } = useLingui()
	const [confirming, setConfirming] = useState(false)
	const [pending, setPending] = useState(false)

	const shown = formatAttributeValue(
		declaration?.kind ?? inferKind(stored.value),
		stored.value,
		{
			locale: i18n.locale,
			unit: declaration?.unit ?? null,
			yes: t`Yes`,
			no: t`No`,
		},
	)

	const clear = async () => {
		if (onClear === undefined) return
		setPending(true)
		try {
			await onClear()
			setConfirming(false)
		} catch {
			// The page already said the save failed. Leaving the confirm showing is
			// what lets it be pressed again.
		} finally {
			setPending(false)
		}
	}

	return (
		<OtherRow data-testid={testId}>
			<RowHead>
				<OtherKey>{declaration?.label ?? attributeKey}</OtherKey>
				<OtherValue>{shown}</OtherValue>
				{onClear !== undefined ? (
					<PriButton
						type='button'
						$variant='text'
						disabled={pending}
						onClick={() => {
							if (confirming) {
								void clear()
								return
							}
							setConfirming(true)
						}}
					>
						{confirming ? <Trans>Clear?</Trans> : <Trans>Clear</Trans>}
					</PriButton>
				) : null}
			</RowHead>
			<AttributeTrail attributeKey={attributeKey} stored={stored} />
		</OtherRow>
	)
}

const Trail = styled.div`
	display: flex;
	flex-direction: column;
	gap: var(--space-3xs);
	margin-top: var(--space-3xs);
`

const TrailLine = styled.div`
	display: flex;
	flex-wrap: wrap;
	align-items: baseline;
	gap: var(--space-2xs);
`

// The link inside carries its own colour and underline, and refuses an address
// that is not an ordinary one, so only its size is set here.
const TrailLinkWrap = styled.span`
	& > a,
	& > span {
		font-size: var(--typescale-label-small-size);
	}
`

const RunLinkWrap = styled.span`
	& > a {
		font-size: var(--typescale-label-small-size);
		color: var(--color-primary);
	}
`

const Qualifier = styled.span`
	display: inline-flex;
	align-items: baseline;
	gap: var(--space-3xs);
	font-size: var(--typescale-label-small-size);
	color: var(--color-on-surface-variant);
	white-space: nowrap;
`

const SetByTag = styled.span`
	${stenciledTitle}
	padding: 0 var(--space-3xs);
	border: 1px solid currentColor;
	border-radius: var(--shape-2xs);
	font-size: var(--typescale-label-small-size);
	color: var(--color-on-surface-variant);
`

const Quote = styled.span`
	font-size: var(--typescale-label-small-size);
	font-style: italic;
	color: var(--color-on-surface-variant);
`

const OtherRow = styled.div`
	${agedPaperRow}
	display: flex;
	flex-direction: column;
	padding: var(--space-2xs) var(--space-sm);
	border-bottom: 1px solid var(--color-ledger-line);
`

const RowHead = styled.div`
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--space-2xs);
`

const OtherKey = styled.span`
	${stenciledTitle}
	font-size: var(--typescale-label-small-size);
	color: var(--color-on-surface-variant);
`

const OtherValue = styled.span`
	flex: 1;
	min-width: 0;
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface);
	overflow-wrap: anywhere;
`

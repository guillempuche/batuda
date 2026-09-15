import { Trans, useLingui } from '@lingui/react/macro'
import { useMemo } from 'react'

import { resolveDeclarations } from '#/components/companies/attribute-rows'
import type { AttributeDeclaration } from '#/components/instructions/attribute-shapes'
import { useAttributeDeclarations } from '#/hooks/use-attribute-declarations'
import { formatAttributeValue, inferKind } from '#/lib/attribute-kinds'
import { type FoundAttribute, narrowFoundAttributes } from './found-attributes'
import {
	type Citation,
	CitationList,
	FieldKey,
	FieldRow,
	FieldsTable,
	FieldValue,
	Section,
	SectionTitle,
} from './shared'

/**
 * The attributes a run filled — the facts the organisation asked every company
 * to carry — shown the way the company page shows them: the declared label, the
 * value in the reader's own digits and words, and the page it was read on.
 *
 * A key nobody declares any more is still shown, under the key itself: the run
 * found it, and hiding it would leave a reader wondering where the value went.
 */

// The page a value was read on, in the shape every other citation here takes.
const citationsOf = (row: FoundAttribute): ReadonlyArray<Citation> =>
	row.sourceId === null
		? []
		: [
				{
					source_id: row.sourceId,
					...(row.quote === null ? {} : { quote: row.quote }),
				},
			]

/**
 * Every declared key once, to look a label and a kind up by.
 *
 * Two stacks may declare the same key, so they are resolved the way the company
 * page resolves them and a reader sees the same label in both places. While the
 * declarations are still on their way, or if they never arrive, the rows fall
 * back to their keys rather than waiting.
 */
function useDeclarationsByKey(): ReadonlyMap<string, AttributeDeclaration> {
	const declarations = useAttributeDeclarations()
	return useMemo(() => {
		const declared =
			declarations === null ? [] : resolveDeclarations(declarations)
		return new Map(declared.map(d => [d.key, d]))
	}, [declarations])
}

/**
 * The rows themselves, for a caller that already has its own surface to put them
 * on — the review screen lists them inside the card whose apply records them.
 */
export function AttributeRows({
	rows,
}: {
	readonly rows: ReadonlyArray<FoundAttribute>
}) {
	const { t, i18n } = useLingui()
	const byKey = useDeclarationsByKey()

	return (
		<>
			{rows.map(row => {
				const declaration = byKey.get(row.key)
				return (
					<FieldRow key={row.key} data-testid={`research-attribute-${row.key}`}>
						<FieldKey>{declaration?.label ?? row.key}</FieldKey>
						<FieldValue>
							{formatAttributeValue(
								declaration?.kind ?? inferKind(row.value),
								row.value,
								{
									locale: i18n.locale,
									unit: declaration?.unit ?? null,
									yes: t`Yes`,
									no: t`No`,
								},
							)}
							<CitationList citations={citationsOf(row)} />
						</FieldValue>
					</FieldRow>
				)
			})}
		</>
	)
}

export function AttributesBlock({
	attributes,
}: {
	/** The map as the findings carry it, or nothing when the run filled none. */
	readonly attributes: unknown
}) {
	const rows = useMemo(() => narrowFoundAttributes(attributes), [attributes])
	if (rows.length === 0) return null

	return (
		<Section data-testid='research-attributes'>
			<SectionTitle>
				<Trans>Attributes</Trans>
			</SectionTitle>
			<FieldsTable>
				<AttributeRows rows={rows} />
			</FieldsTable>
		</Section>
	)
}

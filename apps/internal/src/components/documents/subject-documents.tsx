import { useAtomValue } from '@effect/atom-react'
import { Trans } from '@lingui/react/macro'
import { Link } from '@tanstack/react-router'
import { AsyncResult } from 'effect/unstable/reactivity'
import { useMemo } from 'react'
import styled from 'styled-components'

import type { DocumentSubjectTable } from '@batuda/domain'

import { BatudaApiAtom } from '#/lib/batuda-api-atom'

/**
 * What has been written about one record, for somewhere there is no room to
 * write.
 *
 * A person, a task, an offer and a meeting are each shown in a popup rather
 * than on a page of their own, and a popup cannot hold another popup — so this
 * only lists, and every row leaves for the document's own page. Writing happens
 * on the company page or through an agent.
 */
export function SubjectDocuments({
	subjectTable,
	subjectId,
}: {
	readonly subjectTable: DocumentSubjectTable
	readonly subjectId: string
}) {
	const atom = useMemo(
		() =>
			BatudaApiAtom.query('documents', 'list', {
				query: { subjectTable, subjectId, limit: 10 },
				serializationKey: `documents:${subjectTable}:${subjectId}`,
			}),
		[subjectTable, subjectId],
	)
	const result = useAtomValue(atom)
	const items = AsyncResult.isSuccess(result) ? result.value.items : []

	// Nothing written yet is the ordinary case here, and an empty heading in
	// every popup is noise.
	if (items.length === 0) return null

	return (
		<Section data-testid={`subject-documents-${subjectTable}`}>
			<Heading>
				<Trans>Documents</Trans>
			</Heading>
			<List>
				{items.map(doc => (
					<li key={doc.id}>
						<Link
							to='/documents/$id'
							params={{ id: doc.id }}
							data-testid={`subject-document-${doc.id}`}
						>
							{doc.title ?? doc.type}
						</Link>
					</li>
				))}
			</List>
		</Section>
	)
}

const Section = styled.section`
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
	margin-top: var(--space-md);
`

const Heading = styled.h3`
	margin: 0;
	color: var(--color-text-muted);
	font-size: var(--font-size-xs);
	text-transform: uppercase;
	letter-spacing: 0.06em;
`

const List = styled.ul`
	display: flex;
	flex-direction: column;
	gap: var(--space-3xs);
	margin: 0;
	padding: 0;
	list-style: none;

	a {
		color: var(--color-primary);
		font-size: var(--font-size-sm);
		text-decoration: underline;
	}
`

import { Trans } from '@lingui/react/macro'
import { Link } from '@tanstack/react-router'
import styled from 'styled-components'

import type { DocumentSubjectTable } from '@batuda/domain'

import {
	documentsListAtom,
	SUBJECT_DOCUMENTS_PAGE_SIZE,
} from '#/atoms/documents-atoms'
import { InfiniteListFooter } from '#/components/shared/infinite-list-footer'
import { useInfiniteList } from '#/hooks/use-infinite-list'

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
	const list = useInfiniteList({
		resetKey: `subject-documents:${subjectTable}:${subjectId}`,
		pageSize: SUBJECT_DOCUMENTS_PAGE_SIZE,
		atomFor: page => documentsListAtom({ subjectTable, subjectId }, page),
	})
	const items = list.items

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
			<InfiniteListFooter list={list} testId='subject-documents-popup' />
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

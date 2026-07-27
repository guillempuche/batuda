import { msg } from '@lingui/core/macro'
import { Trans, useLingui } from '@lingui/react/macro'
import { createFileRoute, Link } from '@tanstack/react-router'
import { DateTime, Schema } from 'effect'
import { FileText } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import styled from 'styled-components'

import { DOCUMENT_TYPES } from '@batuda/domain'
import { PriInput } from '@batuda/ui/pri'

import {
	DOCUMENTS_PAGE_SIZE,
	type DocumentsSearch,
	documentsListAtom,
	documentsSearchKey,
} from '#/atoms/documents-atoms'
import { DOCUMENT_KIND_LABELS } from '#/components/documents/document-kinds'
import { useSetDocumentTitle } from '#/components/layout/top-bar-title'
import { InfiniteListFooter } from '#/components/shared/infinite-list-footer'
import { RelativeDate } from '#/components/shared/relative-date'
import { useInfiniteList } from '#/hooks/use-infinite-list'
import { validateSearchWith } from '#/lib/search-schema'
import { stenciledTitle } from '#/lib/workshop-mixins'

// Everything written down, in one place. The company page shows what is filed
// against that company; this is where you go when you only remember the words.
const DOC_TYPE_OPTIONS = [
	{ value: '', label: msg`Every kind` },
	...DOCUMENT_KIND_LABELS,
]

const validateSearch = validateSearchWith({
	q: Schema.String,
	type: Schema.String,
})

export const Route = createFileRoute('/documents/')({
	validateSearch,
	head: () => ({ meta: [{ title: 'Documents — Batuda' }] }),
	component: DocumentsPage,
})

type DocRow = {
	readonly id: string
	readonly type: string
	readonly title: string | null
	readonly snippet: string
	readonly updatedAt: string | null
}

// The snippet is the opening of the stored text, so for markdown it still
// carries the marks that make a heading a heading. They mean nothing in a
// one-line preview, so they come off before it is shown.
function plainPreview(text: string): string {
	return text
		.replace(/^\s*#{1,6}\s+/gm, '')
		.replace(/[*_`>]/g, '')
		.replace(/\s+/g, ' ')
		.trim()
}

function narrowDocs(rows: ReadonlyArray<unknown>): ReadonlyArray<DocRow> {
	const out: Array<DocRow> = []
	for (const row of rows) {
		if (!row || typeof row !== 'object') continue
		const r = row as Record<string, unknown>
		if (typeof r['id'] !== 'string') continue
		const updatedAt = r['updatedAt']
		out.push({
			id: r['id'],
			type: typeof r['type'] === 'string' ? r['type'] : 'general',
			title: typeof r['title'] === 'string' ? r['title'] : null,
			snippet:
				typeof r['snippet'] === 'string' ? plainPreview(r['snippet']) : '',
			updatedAt: DateTime.isDateTime(updatedAt)
				? DateTime.formatIso(updatedAt)
				: typeof updatedAt === 'string'
					? updatedAt
					: null,
		})
	}
	return out
}

function DocumentsPage() {
	const { i18n, t } = useLingui()
	useSetDocumentTitle(t`Documents`)
	const search = Route.useSearch()
	const navigate = Route.useNavigate()

	// An empty filter leaves the address bar rather than sitting there as an
	// empty parameter, so a shared link carries only what was actually chosen.
	const nextSearch = (patch: {
		readonly q?: string | undefined
		readonly type?: string | undefined
	}) => {
		const merged = { q: search.q, type: search.type, ...patch }
		const out: { q?: string; type?: string } = {}
		if (merged.q) out.q = merged.q
		if (merged.type) out.type = merged.type
		return out
	}

	// Typing puts a word in the box straight away and only asks the server once
	// the typing stops, so the field never lags behind the keyboard.
	const [draft, setDraft] = useState(search.q ?? '')
	useEffect(() => {
		const timer = setTimeout(() => {
			const next = draft.trim()
			if (next === (search.q ?? '')) return
			// The kind is read here rather than captured when the timer was set,
			// so changing the filter while still typing is not undone when the
			// pause finally lands.
			const params: { q?: string; type?: string } = {}
			if (next !== '') params.q = next
			if (search.type) params.type = search.type
			void navigate({ search: params, replace: true })
		}, 250)
		return () => clearTimeout(timer)
	}, [draft, search.q, search.type, navigate])

	// A kind pasted into the address bar that nothing offers is ignored rather
	// than sent on and rejected.
	const type = DOCUMENT_TYPES.find(value => value === search.type)
	const documentsSearch = useMemo<DocumentsSearch>(
		() => ({
			...(search.q ? { q: search.q } : {}),
			...(type ? { type } : {}),
		}),
		[search.q, type],
	)
	const list = useInfiniteList({
		resetKey: documentsSearchKey(documentsSearch),
		pageSize: DOCUMENTS_PAGE_SIZE,
		// Counted on purpose: the heading states how many documents match.
		count: 'exact',
		atomFor: page => documentsListAtom(documentsSearch, page),
	})
	const docs = narrowDocs(list.items)
	const total = list.total

	const typeLabel = (value: string) => {
		const found = DOC_TYPE_OPTIONS.find(o => o.value === value)
		return found ? i18n._(found.label) : value
	}

	return (
		<Page>
			<Header>
				<Title>
					<Trans>Documents</Trans>
				</Title>
				<Controls>
					<PriInput
						type='search'
						data-testid='documents-search'
						placeholder={t`Search titles and text`}
						value={draft}
						onChange={e => setDraft(e.target.value)}
					/>
					<TypeSelect
						data-testid='documents-type'
						value={search.type ?? ''}
						onChange={e =>
							void navigate({
								search: nextSearch({
									type: e.target.value === '' ? undefined : e.target.value,
								}),
								replace: true,
							})
						}
					>
						{DOC_TYPE_OPTIONS.map(option => (
							<option key={option.value} value={option.value}>
								{i18n._(option.label)}
							</option>
						))}
					</TypeSelect>
				</Controls>
			</Header>

			{docs.length === 0 ? (
				// Saying nothing matches while the first ones are still on their
				// way would be wrong, so the page waits before saying so.
				list.isLoadingFirstPage ? null : (
					<Empty data-testid='documents-empty'>
						<FileText size={18} aria-hidden />
						<Trans>Nothing written down matches that.</Trans>
					</Empty>
				)
			) : (
				<>
					<Count>
						<Trans>{total} documents</Trans>
					</Count>
					<List data-testid='documents-list'>
						{docs.map(doc => (
							<Row key={doc.id}>
								<Link
									to='/documents/$id'
									params={{ id: doc.id }}
									data-testid={`documents-row-${doc.id}`}
								>
									<RowTitle>{doc.title ?? typeLabel(doc.type)}</RowTitle>
									<RowSnippet>{doc.snippet}</RowSnippet>
									<RowMeta>
										<TypeTag>{typeLabel(doc.type)}</TypeTag>
										<RelativeDate value={doc.updatedAt} />
									</RowMeta>
								</Link>
							</Row>
						))}
					</List>
					<InfiniteListFooter list={list} testId='documents' />
				</>
			)}
		</Page>
	)
}

const Page = styled.section`
	display: flex;
	flex-direction: column;
	gap: var(--space-md);
	padding: var(--space-lg);
`

const Header = styled.header`
	display: flex;
	flex-direction: column;
	gap: var(--space-sm);
`

const Title = styled.h1`
	${stenciledTitle};
	margin: 0;
`

const Controls = styled.div`
	display: flex;
	flex-wrap: wrap;
	gap: var(--space-sm);
`

const TypeSelect = styled.select`
	border: 1px solid var(--color-border);
	border-radius: var(--radius-sm);
	background: var(--color-surface);
	color: var(--color-text);
	padding: var(--space-2xs) var(--space-xs);
	font: inherit;
`

const Count = styled.p`
	margin: 0;
	color: var(--color-text-muted);
	font-size: var(--font-size-sm);
`

const List = styled.ul`
	display: flex;
	flex-direction: column;
	gap: var(--space-xs);
	margin: 0;
	padding: 0;
	list-style: none;
`

const Row = styled.li`
	a {
		display: flex;
		flex-direction: column;
		gap: var(--space-3xs);
		padding: var(--space-sm);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: inherit;
		text-decoration: none;
	}

	a:hover {
		border-color: var(--color-primary);
	}
`

const RowTitle = styled.span`
	font-weight: 600;
`

const RowSnippet = styled.span`
	color: var(--color-text-muted);
	font-size: var(--font-size-sm);
	overflow: hidden;
	display: -webkit-box;
	-webkit-line-clamp: 2;
	-webkit-box-orient: vertical;
`

const TypeTag = styled.span`
	text-transform: uppercase;
	letter-spacing: 0.04em;
`

const RowMeta = styled.span`
	display: flex;
	gap: var(--space-sm);
	color: var(--color-text-muted);
	font-size: var(--font-size-xs);
`

const Empty = styled.p`
	display: flex;
	align-items: center;
	gap: var(--space-xs);
	color: var(--color-text-muted);
`

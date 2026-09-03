import { useLingui } from '@lingui/react/macro'
import { Bookmark, BookmarkPlus, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import styled from 'styled-components'

import {
	type CompaniesSearch,
	canonicalSearchKey,
} from '#/atoms/companies-atoms'
import { stenciledTitle } from '#/lib/workshop-mixins'

const STORAGE_KEY = 'batuda.companies.savedViews'

export type SavedView = {
	readonly name: string
	readonly search: CompaniesSearch
}

/**
 * Named sets of filters, kept in this browser.
 *
 * "My hot leads nobody has called in a month" is a question somebody asks every
 * morning, and every filter that answers it is already in the address bar — so
 * a saved view is only a name for one of those addresses. Saving them here
 * rather than on the account is the trade: they do not follow the person to
 * another machine, and it needs nothing of the server. Worth revisiting the day
 * somebody misses one.
 */
export function SavedViews({
	current,
	onApply,
}: {
	readonly current: CompaniesSearch
	readonly onApply: (search: CompaniesSearch) => void
}) {
	const { t } = useLingui()
	const [views, setViews] = useState<ReadonlyArray<SavedView>>([])

	// Read after mount: the server renders this too, and it has no localStorage
	// to read, so reading during render would make the two disagree.
	useEffect(() => {
		setViews(readViews())
	}, [])

	const persist = useCallback((next: ReadonlyArray<SavedView>) => {
		setViews(next)
		writeViews(next)
	}, [])

	const hasFilters = Object.keys(current).length > 0
	// The list's own way of spelling a search, rather than a second one here: it
	// ignores the order of the filters and of the values inside each one, so a
	// saved view still reads as the one in force when its two tags come back the
	// other way round.
	const activeName = views.find(
		v => canonicalSearchKey(v.search) === canonicalSearchKey(current),
	)?.name

	const save = () => {
		const name = window.prompt(t`Name this view`)?.trim()
		if (!name) return
		// Saving over a name replaces it, which is what somebody adjusting a view
		// and saving it again means.
		persist([...views.filter(v => v.name !== name), { name, search: current }])
	}

	if (views.length === 0 && !hasFilters) return null

	return (
		<Wrap role='group' aria-label={t`Saved views`}>
			{views.map(view => (
				<Chip key={view.name} $active={view.name === activeName}>
					<ChipButton
						type='button'
						onClick={() => onApply(view.search)}
						data-testid={`companies-saved-view-${view.name}`}
					>
						<Bookmark size={12} aria-hidden />
						{view.name}
					</ChipButton>
					<Remove
						type='button'
						aria-label={t`Forget the view ${view.name}`}
						onClick={() => persist(views.filter(v => v.name !== view.name))}
					>
						<X size={12} aria-hidden />
					</Remove>
				</Chip>
			))}
			{hasFilters && activeName === undefined && (
				<Chip $active={false}>
					<ChipButton
						type='button'
						onClick={save}
						data-testid='companies-save-view'
					>
						<BookmarkPlus size={12} aria-hidden />
						{t`Save these filters`}
					</ChipButton>
				</Chip>
			)}
		</Wrap>
	)
}

function readViews(): ReadonlyArray<SavedView> {
	if (typeof window === 'undefined') return []
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY)
		if (raw === null) return []
		const parsed: unknown = JSON.parse(raw)
		if (!Array.isArray(parsed)) return []
		// Anything that is not a name and a set of filters is dropped rather than
		// trusted: this comes back from a store a person can edit.
		return parsed.filter(
			(v): v is SavedView =>
				v !== null &&
				typeof v === 'object' &&
				typeof (v as SavedView).name === 'string' &&
				typeof (v as SavedView).search === 'object',
		)
	} catch {
		return []
	}
}

function writeViews(views: ReadonlyArray<SavedView>): void {
	if (typeof window === 'undefined') return
	try {
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(views))
	} catch {
		// A full or locked-down store just means the view is not remembered.
	}
}

const Wrap = styled.div.withConfig({ displayName: 'SavedViewsWrap' })`
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--space-2xs);
`

const Chip = styled.div.withConfig({
	displayName: 'SavedViewsChip',
	shouldForwardProp: prop => prop !== '$active',
})<{ $active: boolean }>`
	display: inline-flex;
	align-items: center;
	border: 1px dashed
		${p => (p.$active ? 'var(--color-primary)' : 'var(--color-outline)')};
	border-radius: var(--shape-2xs);
	background: ${p =>
		p.$active
			? 'color-mix(in oklab, var(--color-primary) 16%, transparent)'
			: 'transparent'};
	color: ${p =>
		p.$active ? 'var(--color-primary)' : 'var(--color-on-surface-variant)'};
`

const ChipButton = styled.button.withConfig({
	displayName: 'SavedViewsChipButton',
})`
	${stenciledTitle}
	display: inline-flex;
	align-items: center;
	gap: var(--space-3xs);
	min-block-size: 2.75rem;
	padding: 0 var(--space-2xs);
	border: none;
	background: transparent;
	color: inherit;
	font-size: var(--typescale-label-small-size);
	cursor: pointer;

	&:focus-visible {
		outline: none;
		box-shadow: var(--glow-active);
	}
`

const Remove = styled.button.withConfig({ displayName: 'SavedViewsRemove' })`
	display: inline-flex;
	align-items: center;
	justify-content: center;
	min-inline-size: 2.75rem;
	min-block-size: 2.75rem;
	border: none;
	background: transparent;
	color: inherit;
	cursor: pointer;
	opacity: 0.7;

	&:hover {
		opacity: 1;
	}

	&:focus-visible {
		outline: none;
		box-shadow: var(--glow-active);
	}
`

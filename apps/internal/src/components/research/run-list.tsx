import { useAtomRefresh, useAtomValue } from '@effect/atom-react'
import { Trans, useLingui } from '@lingui/react/macro'
import { Link, useNavigate } from '@tanstack/react-router'
import { AsyncResult } from 'effect/unstable/reactivity'
import { Search } from 'lucide-react'
import styled from 'styled-components'

import { PriButton } from '@batuda/ui/pri'

import { researchListAtom } from '#/atoms/research-atoms'
import { ErrorState } from '#/components/shared/error-state'
import { RelativeDate } from '#/components/shared/relative-date'
import { dlgNoId } from '#/lib/dlg-search'
import { formatMoneyCents } from '#/lib/format-money'
import { useDlg } from '#/lib/use-dlg'
import { stenciledTitle } from '#/lib/workshop-mixins'
import { Badge } from './badge'
import { ResearchDialog } from './research-dialog'
import { statusLabel, statusTone } from './run-labels'
import { narrowResearch } from './run-shapes'

export const RUN_LIST_LIMIT = 100

/** The all-runs list atom, shared by the route loader (to hydrate) and page. */
export function researchRunsAtom() {
	return researchListAtom({ limit: RUN_LIST_LIMIT })
}

// The "Find companies" dialog lives in `?dlg=discovery` so it is deep-linkable
// and Back closes it, matching the review-queue inbox. The route validates this
// schema; a value outside it decodes to nothing and the dialog stays closed.
export const researchRunsDlgSchema = dlgNoId('discovery')

export function ResearchRuns() {
	const { t, i18n } = useLingui()
	const navigate = useNavigate()
	const { dlg, open, close } = useDlg(researchRunsDlgSchema)
	const dialogOpen = dlg !== undefined
	const result = useAtomValue(researchRunsAtom())
	const refreshRuns = useAtomRefresh(researchRunsAtom())
	const runs = AsyncResult.isSuccess(result)
		? narrowResearch(result.value.items)
		: []

	return (
		<Wrap>
			<HeaderRow>
				<HeaderText>
					<PageTitle>
						<Trans>Research runs</Trans>
					</PageTitle>
					<BackLink to='/research'>
						<Trans>Back to review queue</Trans>
					</BackLink>
				</HeaderText>
				<PriButton
					type='button'
					$variant='filled'
					data-testid='discovery-open'
					onClick={() => open({ kind: 'discovery' })}
				>
					<Search size={16} aria-hidden />
					<Trans>Find companies</Trans>
				</PriButton>
			</HeaderRow>

			{AsyncResult.isInitial(result) ? (
				<Empty role='status'>
					<Trans>Loading runs…</Trans>
				</Empty>
			) : AsyncResult.isFailure(result) ? (
				<ErrorState
					variant='inline'
					data-testid='research-runs-error'
					title={t`Could not load your runs.`}
					onRetry={refreshRuns}
				/>
			) : runs.length === 0 ? (
				<Empty data-testid='runs-empty'>
					<Trans>No research runs yet. Find companies to get started.</Trans>
				</Empty>
			) : (
				<List>
					{runs.map(run => {
						const label = statusLabel(run.status)
						return (
							<Row key={run.id} data-testid={`run-row-${run.id}`}>
								<RowLinkOverlay>
									<Link
										to='/research/$id'
										params={{ id: run.id }}
										aria-label={run.query}
									/>
								</RowLinkOverlay>
								<RowMain>
									<RowQuery>{run.query}</RowQuery>
									<RowMeta>
										<Badge $tone={statusTone(run.status)}>
											{label ? i18n._(label) : run.status}
										</Badge>
										{run.kind === 'group' ? (
											<Badge $tone='info'>
												<Trans>Batch</Trans>
											</Badge>
										) : null}
									</RowMeta>
								</RowMain>
								<RowSide>
									<Cost>
										{formatMoneyCents(run.costCents + run.paidCostCents, {
											locale: i18n.locale,
										})}
									</Cost>
									<RelativeDate value={run.createdAt} />
								</RowSide>
							</Row>
						)
					})}
				</List>
			)}

			<ResearchDialog
				open={dialogOpen}
				onOpenChange={next => {
					if (!next) close()
				}}
				onCreated={id => {
					void navigate({ to: '/research/$id', params: { id } })
				}}
			/>
		</Wrap>
	)
}

const Wrap = styled.div`
	display: flex;
	flex-direction: column;
	gap: var(--space-lg);
	padding: var(--space-lg);
	max-width: 60rem;
	margin: 0 auto;
	width: 100%;
`

const HeaderRow = styled.div`
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	gap: var(--space-md);
	flex-wrap: wrap;
`

const HeaderText = styled.div`
	display: flex;
	flex-direction: column;
	gap: var(--space-3xs);
`

const PageTitle = styled.h1`
	${stenciledTitle}
	font-size: var(--typescale-headline-small-size);
	margin: 0;
`

const BackLink = styled(Link)`
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	color: var(--color-primary);
	text-decoration: underline;
	width: fit-content;
`

const List = styled.div`
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
`

const Row = styled.div`
	position: relative;
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--space-md);
	padding: var(--space-sm) var(--space-md);
	border-radius: var(--shape-2xs);
	border: 1px solid color-mix(in oklab, var(--color-on-surface) 12%, transparent);
	background: var(--color-surface);
	transition: border-color 140ms ease;

	&:hover {
		border-color: color-mix(in oklab, var(--color-primary) 50%, transparent);
	}

	&:focus-within {
		box-shadow: var(--glow-active);
	}
`

// Stretched-link overlay so the whole row navigates without a styled(Link),
// which would erase TanStack's typed route params. The visible content sits
// below; the transparent link on top catches the click.
const RowLinkOverlay = styled.div`
	position: absolute;
	inset: 0;
	z-index: 1;

	a {
		display: block;
		position: absolute;
		inset: 0;
	}

	a:focus-visible {
		outline: none;
	}
`

const RowMain = styled.div`
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
	min-width: 0;
`

const RowQuery = styled.span`
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	color: var(--color-on-surface);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
`

const RowMeta = styled.div`
	display: flex;
	gap: var(--space-2xs);
	flex-wrap: wrap;
`

const RowSide = styled.div`
	display: flex;
	flex-direction: column;
	align-items: flex-end;
	gap: var(--space-3xs);
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface-variant);
	white-space: nowrap;
`

const Cost = styled.span`
	font-family: var(--font-display);
	color: var(--color-on-surface);
`

const Empty = styled.p`
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	color: var(--color-on-surface-variant);
	text-align: center;
	padding: var(--space-xl);
`

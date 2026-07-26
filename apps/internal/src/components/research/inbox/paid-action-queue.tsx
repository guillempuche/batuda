import { useAtomRefresh, useAtomSet, useAtomValue } from '@effect/atom-react'
import { Trans, useLingui } from '@lingui/react/macro'
import { Link } from '@tanstack/react-router'
import { AsyncResult } from 'effect/unstable/reactivity'
import { useState } from 'react'
import styled from 'styled-components'

import { normalizePaidActionTool } from '@batuda/research/application/paid-action-tool'
import { PriButton, usePriToast } from '@batuda/ui/pri'

import {
	approvePaidActionAtom,
	type PendingPaidAction,
	pendingPaidActionsAtom,
	skipPaidActionAtom,
} from '#/atoms/research-atoms'
import { humanizeFieldKey } from '#/components/research/field-diff'
import { formatMoneyCents } from '#/lib/format-money'
import { agedPaperSurface, stenciledTitle } from '#/lib/workshop-mixins'

/** How many waiting lookups the queue shows at once. */
export const PAID_ACTION_LIMIT = 50

/**
 * Paid lookups that a run stopped short of paying for. Each one is real money
 * the run will not spend until somebody says so, and a run holding one reads as
 * finished everywhere else — so without this list they wait unnoticed until
 * somebody happens to open that particular run.
 */
export function PaidActionQueue() {
	const { t, i18n } = useLingui()
	const atom = pendingPaidActionsAtom(PAID_ACTION_LIMIT)
	const result = useAtomValue(atom)
	const refresh = useAtomRefresh(atom)
	const toast = usePriToast()
	const approve = useAtomSet(approvePaidActionAtom, { mode: 'promiseExit' })
	const skip = useAtomSet(skipPaidActionAtom, { mode: 'promiseExit' })
	const [busyId, setBusyId] = useState<string | null>(null)

	const actions: ReadonlyArray<PendingPaidAction> = AsyncResult.isSuccess(
		result,
	)
		? result.value.items
		: []
	if (actions.length === 0) return null

	const totalCents = actions.reduce(
		(sum, a) => sum + (a.estimatedCents ?? 0),
		0,
	)

	const decide = async (
		action: PendingPaidAction,
		decision: 'approve' | 'skip',
	) => {
		if (action.actionId === null) return
		setBusyId(action.actionId)
		const call = decision === 'approve' ? approve : skip
		const exit = await call({
			params: { id: action.researchId, paId: action.actionId },
		})
		setBusyId(null)
		if (exit._tag !== 'Success') {
			toast.add({ title: t`Could not update this lookup.`, type: 'error' })
			return
		}
		// The reply says what actually happened: someone may have decided this
		// already, or the run may have named a lookup that does not exist.
		const outcome = (exit.value as { outcome?: string } | null)?.outcome
		toast.add({
			title:
				outcome === 'approved'
					? t`Lookup approved — the run is picking it up.`
					: outcome === 'skipped'
						? t`Lookup skipped. Nothing was spent.`
						: outcome === 'not_pending'
							? t`Someone had already decided this one.`
							: t`That lookup isn't available, so it can only be skipped.`,
			type:
				outcome === 'approved' || outcome === 'skipped' ? 'success' : 'info',
		})
		refresh()
	}

	return (
		<Section data-testid='research-inbox-paid-actions'>
			<SectionTitle>
				<Trans>Paid lookups waiting for your OK</Trans>
			</SectionTitle>
			<SectionHint>
				<Trans>
					These cost money, so nothing runs until you say so. About{' '}
					{formatMoneyCents(totalCents, { locale: i18n.locale })} in total.
				</Trans>
			</SectionHint>
			<Rows>
				{actions.map(action => {
					const canApprove =
						action.actionId !== null &&
						normalizePaidActionTool(action.tool) !== null
					const busy = busyId !== null && busyId === action.actionId
					return (
						<Row key={`${action.researchId}:${action.actionId ?? action.tool}`}>
							<Main>
								<Head>
									<Tool>{humanizeFieldKey(action.tool)}</Tool>
									{action.estimatedCents !== null ? (
										<Cost>
											{formatMoneyCents(action.estimatedCents, {
												locale: i18n.locale,
											})}
										</Cost>
									) : null}
								</Head>
								<Subject>{action.subjectName ?? action.runQuery}</Subject>
								{action.reason !== null ? (
									<Reason>{action.reason}</Reason>
								) : null}
								<OpenRunChrome>
									<Link
										to='/research/$id'
										params={{ id: action.researchId }}
										aria-label={t`Open the run asking for this lookup`}
									>
										<Trans>Open run</Trans>
									</Link>
								</OpenRunChrome>
							</Main>
							<Actions>
								{action.actionId === null ? (
									<Unavailable>
										<Trans>
											Recorded before these could be decided — open the run.
										</Trans>
									</Unavailable>
								) : (
									<>
										{canApprove ? (
											<PriButton
												type='button'
												$variant='filled'
												disabled={busy}
												aria-label={t`Approve ${action.tool}`}
												data-testid='paid-queue-approve'
												onClick={() => void decide(action, 'approve')}
											>
												{busy ? t`Working…` : t`Approve`}
											</PriButton>
										) : null}
										<PriButton
											type='button'
											$variant='outlined'
											disabled={busy}
											aria-label={t`Skip ${action.tool}`}
											data-testid='paid-queue-skip'
											onClick={() => void decide(action, 'skip')}
										>
											<Trans>Skip</Trans>
										</PriButton>
									</>
								)}
							</Actions>
						</Row>
					)
				})}
			</Rows>
		</Section>
	)
}

const Section = styled.section`
	display: flex;
	flex-direction: column;
	gap: var(--space-sm);
`

const SectionTitle = styled.h3`
	${stenciledTitle}
	font-size: var(--typescale-title-medium-size);
	line-height: var(--typescale-title-medium-line);
	margin: 0;
`

const SectionHint = styled.p`
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	font-style: italic;
	color: var(--color-on-surface-variant);
	margin: 0;
`

const Rows = styled.div`
	display: flex;
	flex-direction: column;
	gap: var(--space-sm);
`

const Row = styled.div`
	${agedPaperSurface}
	display: flex;
	flex-wrap: wrap;
	gap: var(--space-sm);
	align-items: flex-start;
	justify-content: space-between;
	padding: var(--space-sm) var(--space-md);
	border-radius: var(--shape-2xs);
`

const Main = styled.div`
	display: flex;
	flex-direction: column;
	gap: var(--space-3xs);
	min-width: 12rem;
	flex: 1;
`

const Head = styled.div`
	display: inline-flex;
	flex-wrap: wrap;
	align-items: baseline;
	gap: var(--space-2xs);
`

const Tool = styled.span`
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--color-primary);
`

const Cost = styled.span`
	font-family: var(--font-mono);
	font-size: var(--typescale-body-small-size);
	font-variant-numeric: tabular-nums;
	color: var(--color-on-surface-variant);
`

const Subject = styled.span`
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	color: var(--color-on-surface);
`

const Reason = styled.p`
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	font-style: italic;
	color: var(--color-on-surface-variant);
	margin: 0;
`

const Unavailable = styled.span`
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	font-style: italic;
	color: var(--color-on-surface-variant);
	max-width: 16rem;
`

const Actions = styled.div`
	display: inline-flex;
	align-items: center;
	gap: var(--space-2xs);
`

// Styling `Link` directly erases TanStack's typed `params` inference, so the
// chrome lives on a wrapper and the real Link stays plain.
const OpenRunChrome = styled.span`
	& > a {
		font-family: var(--font-display);
		font-size: var(--typescale-label-small-size);
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--color-on-surface-variant);
		text-decoration: none;
	}

	& > a:hover {
		color: var(--color-primary);
	}
`

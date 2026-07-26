import { useAtomRefresh, useAtomSet } from '@effect/atom-react'
import { Trans, useLingui } from '@lingui/react/macro'
import { useNavigate } from '@tanstack/react-router'
import { RefreshCw, Trash2, XCircle } from 'lucide-react'
import { useState } from 'react'
import styled from 'styled-components'

import { PriButton, usePriToast } from '@batuda/ui/pri'

import {
	cancelResearchAtom,
	createResearchAtom,
	deleteResearchAtom,
	researchDetailAtom,
} from '#/atoms/research-atoms'

type Subject = { readonly table: 'companies' | 'contacts'; readonly id: string }

// Pull the input subjects back out of a run's stored context so a re-run
// targets the same rows. Anything unexpected reads as no subjects.
function subjectsOf(context: unknown): ReadonlyArray<Subject> {
	if (!context || typeof context !== 'object') return []
	const subjects = (context as { subjects?: unknown }).subjects
	if (!Array.isArray(subjects)) return []
	const out: Array<Subject> = []
	for (const s of subjects) {
		if (!s || typeof s !== 'object') continue
		const table = (s as { table?: unknown }).table
		const id = (s as { id?: unknown }).id
		if (
			(table === 'companies' || table === 'contacts') &&
			typeof id === 'string'
		) {
			out.push({ table, id })
		}
	}
	return out
}

/**
 * The parts of a run's stored setup that a repeat run can be started from: the
 * companies it was pointed at, the filter that chose them, and the search hints.
 */
function reusableContext(
	context: unknown,
): Record<string, unknown> | undefined {
	if (!context || typeof context !== 'object') return undefined
	const c = context as Record<string, unknown>
	const out: Record<string, unknown> = {}
	const subjects = subjectsOf(context)
	if (subjects.length > 0) out['subjects'] = subjects
	if (c['selector'] && typeof c['selector'] === 'object')
		out['selector'] = c['selector']
	if (c['hints'] && typeof c['hints'] === 'object') out['hints'] = c['hints']
	return Object.keys(out).length > 0 ? out : undefined
}

/** Cancel a live run, re-run a finished one, or delete it — the run-detail toolbar. */
export function RunActions({
	run,
}: {
	readonly run: {
		readonly id: string
		readonly query: string
		readonly schemaName: string | null
		readonly status: string
		readonly context: unknown
		readonly mode: string | null
		readonly templateIds: ReadonlyArray<string>
	}
}) {
	const { t } = useLingui()
	const navigate = useNavigate()
	const toast = usePriToast()
	const cancel = useAtomSet(cancelResearchAtom, { mode: 'promiseExit' })
	const del = useAtomSet(deleteResearchAtom, { mode: 'promiseExit' })
	const create = useAtomSet(createResearchAtom, { mode: 'promiseExit' })
	const refreshRun = useAtomRefresh(researchDetailAtom(run.id))
	const [busy, setBusy] = useState<null | 'cancel' | 'delete' | 'rerun'>(null)
	// Deleting takes the run, its findings and anything still waiting on review
	// with it, and there is no way back — so it asks first. The reversible
	// bulk-apply already works this way.
	const [confirmingDelete, setConfirmingDelete] = useState(false)

	const isActive = run.status === 'running' || run.status === 'queued'

	const onCancel = async () => {
		setBusy('cancel')
		const exit = await cancel({ params: { id: run.id } })
		setBusy(null)
		if (exit._tag === 'Success') {
			refreshRun()
			toast.add({ title: t`Run cancelled`, type: 'success' })
		} else {
			toast.add({ title: t`Could not cancel the run`, type: 'error' })
		}
	}

	const onDelete = async () => {
		setBusy('delete')
		const exit = await del({ params: { id: run.id } })
		setBusy(null)
		setConfirmingDelete(false)
		if (exit._tag === 'Success') {
			toast.add({ title: t`Run deleted`, type: 'success' })
			void navigate({ to: '/research/runs' })
		} else {
			toast.add({ title: t`Could not delete the run`, type: 'error' })
		}
	}

	const onRerun = async () => {
		setBusy('rerun')
		// Repeat the whole setup, not just the question. Sending only the question
		// and its subjects quietly dropped how thorough the run was, the
		// instructions that shaped it, and — on a batch — the filter that chose
		// which companies to cover, so the second run was not comparable with the
		// first and a batch collapsed into a single run about nothing.
		const context = reusableContext(run.context)
		const exit = await create({
			payload: {
				query: run.query,
				...(run.schemaName ? { schema_name: run.schemaName } : {}),
				...(run.mode ? { mode: run.mode } : {}),
				...(context === undefined ? {} : { context }),
				...(run.templateIds.length > 0
					? { template_ids: run.templateIds }
					: {}),
			},
		})
		setBusy(null)
		if (exit._tag === 'Success') {
			const value = exit.value as Record<string, unknown> | null
			const newId = typeof value?.['id'] === 'string' ? value['id'] : null
			if (newId) void navigate({ to: '/research/$id', params: { id: newId } })
		} else {
			toast.add({ title: t`Could not start a new run`, type: 'error' })
		}
	}

	return (
		<Actions data-testid='research-run-actions'>
			{isActive ? (
				<PriButton
					type='button'
					$variant='outlined'
					data-testid='run-cancel'
					disabled={busy !== null}
					onClick={() => void onCancel()}
				>
					<XCircle size={14} aria-hidden />
					<Trans>Cancel</Trans>
				</PriButton>
			) : (
				<PriButton
					type='button'
					$variant='outlined'
					data-testid='run-rerun'
					disabled={busy !== null}
					onClick={() => void onRerun()}
				>
					<RefreshCw size={14} aria-hidden />
					<Trans>Run again</Trans>
				</PriButton>
			)}
			{confirmingDelete ? (
				<>
					<PriButton
						type='button'
						$variant='filled'
						data-testid='run-delete-confirm'
						disabled={busy !== null}
						onClick={() => void onDelete()}
					>
						<Trash2 size={14} aria-hidden />
						{busy === 'delete' ? t`Deleting…` : t`Delete for good`}
					</PriButton>
					<PriButton
						type='button'
						$variant='text'
						data-testid='run-delete-cancel'
						disabled={busy !== null}
						onClick={() => setConfirmingDelete(false)}
					>
						<Trans>Keep it</Trans>
					</PriButton>
				</>
			) : (
				<PriButton
					type='button'
					$variant='text'
					data-testid='run-delete'
					disabled={busy !== null}
					onClick={() => setConfirmingDelete(true)}
				>
					<Trash2 size={14} aria-hidden />
					<Trans>Delete</Trans>
				</PriButton>
			)}
		</Actions>
	)
}

const Actions = styled.div`
	display: flex;
	gap: var(--space-2xs);
	flex-wrap: wrap;
`

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

	const isActive = run.status === 'running' || run.status === 'queued'

	const onCancel = async () => {
		setBusy('cancel')
		const exit = await cancel({ params: { id: run.id } } as never)
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
		const exit = await del({ params: { id: run.id } } as never)
		setBusy(null)
		if (exit._tag === 'Success') {
			void navigate({ to: '/research/runs' })
		} else {
			toast.add({ title: t`Could not delete the run`, type: 'error' })
		}
	}

	const onRerun = async () => {
		setBusy('rerun')
		const subjects = subjectsOf(run.context)
		const exit = await create({
			payload: {
				query: run.query,
				...(run.schemaName ? { schema_name: run.schemaName } : {}),
				...(subjects.length > 0 ? { context: { subjects } } : {}),
			},
		} as never)
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
			<PriButton
				type='button'
				$variant='text'
				data-testid='run-delete'
				disabled={busy !== null}
				onClick={() => void onDelete()}
			>
				<Trash2 size={14} aria-hidden />
				<Trans>Delete</Trans>
			</PriButton>
		</Actions>
	)
}

const Actions = styled.div`
	display: flex;
	gap: var(--space-2xs);
	flex-wrap: wrap;
`

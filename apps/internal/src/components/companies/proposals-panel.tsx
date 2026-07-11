import { useAtomRefresh, useAtomSet, useAtomValue } from '@effect/atom-react'
import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import { Trans, useLingui } from '@lingui/react/macro'
import { AsyncResult } from 'effect/unstable/reactivity'
import { FileSignature, Plus, X } from 'lucide-react'
import { type FormEvent, useMemo, useRef, useState } from 'react'
import styled from 'styled-components'

import {
	PriButton,
	PriDialog,
	PriInput,
	PriTextarea,
	usePriToast,
} from '@batuda/ui/pri'

import { RelativeDate } from '#/components/shared/relative-date'
import { BatudaApiAtom } from '#/lib/batuda-api-atom'
import { formatMoneyCents } from '#/lib/format-money'
import { stenciledTitle } from '#/lib/workshop-mixins'

type ProposalRow = {
	readonly id: string
	readonly title: string
	readonly status: string
	readonly totalValue: string | null
	readonly currency: string | null
	readonly notes: string | null
	readonly expiresAt: string | null
	readonly updatedAt: string | null
}

// The proposal lifecycle statuses (see proposals.ts schema).
const STATUSES: ReadonlyArray<{
	readonly value: string
	readonly label: MessageDescriptor
}> = [
	{ value: 'draft', label: msg`Draft` },
	{ value: 'sent', label: msg`Sent` },
	{ value: 'viewed', label: msg`Viewed` },
	{ value: 'negotiating', label: msg`Negotiating` },
	{ value: 'accepted', label: msg`Accepted` },
	{ value: 'rejected', label: msg`Rejected` },
	{ value: 'expired', label: msg`Expired` },
]

function narrowProposals(
	rows: ReadonlyArray<unknown>,
): ReadonlyArray<ProposalRow> {
	const out: Array<ProposalRow> = []
	for (const row of rows) {
		if (!row || typeof row !== 'object') continue
		const r = row as Record<string, unknown>
		if (typeof r['id'] !== 'string') continue
		out.push({
			id: r['id'],
			title: typeof r['title'] === 'string' ? r['title'] : '',
			status: typeof r['status'] === 'string' ? r['status'] : 'draft',
			totalValue: typeof r['totalValue'] === 'string' ? r['totalValue'] : null,
			currency: typeof r['currency'] === 'string' ? r['currency'] : null,
			notes: typeof r['notes'] === 'string' ? r['notes'] : null,
			expiresAt: typeof r['expiresAt'] === 'string' ? r['expiresAt'] : null,
			updatedAt: typeof r['updatedAt'] === 'string' ? r['updatedAt'] : null,
		})
	}
	return out
}

// The stored total is a numeric string of major units (e.g. "1500.00"); show it
// with the proposal's currency, or the raw value if it isn't a clean number.
function formatTotal(
	value: string | null,
	currency: string | null,
	locale: string,
): string | null {
	if (value === null) return null
	const amount = Number.parseFloat(value)
	if (!Number.isFinite(amount)) return value
	return formatMoneyCents(Math.round(amount * 100), {
		currency: currency ?? 'EUR',
		locale,
	})
}

/** List, create, and edit a company's proposals + move them through the pipeline. */
export function ProposalsPanel({ companyId }: { readonly companyId: string }) {
	const { i18n } = useLingui()
	const proposalsAtom = useMemo(
		() => BatudaApiAtom.query('proposals', 'list', { query: { companyId } }),
		[companyId],
	)
	const result = useAtomValue(proposalsAtom)
	const refresh = useAtomRefresh(proposalsAtom)
	const proposals = AsyncResult.isSuccess(result)
		? narrowProposals(result.value)
		: []
	const [editing, setEditing] = useState<ProposalRow | 'new' | null>(null)

	const statusLabel = (status: string) => {
		const found = STATUSES.find(s => s.value === status)
		return found ? i18n._(found.label) : status
	}

	return (
		<>
			<Head>
				<PriButton
					type='button'
					$variant='outlined'
					data-testid='company-add-proposal'
					onClick={() => setEditing('new')}
				>
					<Plus size={14} aria-hidden />
					<Trans>New proposal</Trans>
				</PriButton>
			</Head>

			{proposals.length === 0 ? (
				<Empty>
					<FileSignature size={18} aria-hidden />
					<Trans>No proposals yet.</Trans>
				</Empty>
			) : (
				<List>
					{proposals.map(p => (
						<Row
							key={p.id}
							type='button'
							data-testid={`proposal-row-${p.id}`}
							onClick={() => setEditing(p)}
						>
							<RowMain>
								<RowTitle>{p.title}</RowTitle>
								<RowMeta>
									<StatusTag>{statusLabel(p.status)}</StatusTag>
									<RelativeDate value={p.updatedAt} />
								</RowMeta>
							</RowMain>
							{formatTotal(p.totalValue, p.currency, i18n.locale) !== null ? (
								<RowTotal>
									{formatTotal(p.totalValue, p.currency, i18n.locale)}
								</RowTotal>
							) : null}
						</Row>
					))}
				</List>
			)}

			<ProposalDialog
				companyId={companyId}
				target={editing}
				onClose={() => setEditing(null)}
				onSaved={() => {
					refresh()
					setEditing(null)
				}}
			/>
		</>
	)
}

function ProposalDialog({
	companyId,
	target,
	onClose,
	onSaved,
}: {
	readonly companyId: string
	readonly target: ProposalRow | 'new' | null
	readonly onClose: () => void
	readonly onSaved: () => void
}) {
	const { i18n, t } = useLingui()
	const toast = usePriToast()
	const create = useAtomSet(BatudaApiAtom.mutation('proposals', 'create'), {
		mode: 'promiseExit',
	})
	const update = useAtomSet(BatudaApiAtom.mutation('proposals', 'update'), {
		mode: 'promiseExit',
	})

	const editing = target !== 'new' && target !== null ? target : null
	const [title, setTitle] = useState('')
	const [status, setStatus] = useState('draft')
	const [totalValue, setTotalValue] = useState('')
	const [currency, setCurrency] = useState('EUR')
	const [expiresAt, setExpiresAt] = useState('')
	const [notes, setNotes] = useState('')
	const [busy, setBusy] = useState(false)

	const key = editing ? editing.id : target === 'new' ? 'new' : 'closed'
	const seeded = useRef<string | null>(null)
	if (seeded.current !== key) {
		seeded.current = key
		setTitle(editing?.title ?? '')
		setStatus(editing?.status ?? 'draft')
		setTotalValue(editing?.totalValue ?? '')
		setCurrency(editing?.currency ?? 'EUR')
		setExpiresAt(editing?.expiresAt ? editing.expiresAt.slice(0, 10) : '')
		setNotes(editing?.notes ?? '')
		setBusy(false)
	}

	const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		const trimmedTitle = title.trim()
		if (trimmedTitle.length === 0 || busy) return
		setBusy(true)
		const exit = editing
			? await update({
					params: { id: editing.id },
					payload: {
						title: trimmedTitle,
						status,
						...(totalValue.trim() ? { totalValue: totalValue.trim() } : {}),
						notes,
					},
				} as never)
			: await create({
					payload: {
						companyId,
						title: trimmedTitle,
						// A draft starts with no line items; they're edited later.
						lineItems: [],
						currency,
						...(totalValue.trim() ? { totalValue: totalValue.trim() } : {}),
						...(expiresAt ? { expiresAt } : {}),
						...(notes.trim() ? { notes } : {}),
					},
				} as never)
		setBusy(false)
		if (exit._tag === 'Success') {
			onSaved()
			return
		}
		toast.add({ title: t`Could not save the proposal`, type: 'error' })
	}

	return (
		<PriDialog.Root
			open={target !== null}
			onOpenChange={next => !next && onClose()}
		>
			<PriDialog.Portal>
				<PriDialog.Backdrop />
				<PriDialog.Popup data-testid='proposal-dialog'>
					<DialogHead>
						<PriDialog.Title>
							<Heading>
								{editing ? (
									<Trans>Edit proposal</Trans>
								) : (
									<Trans>New proposal</Trans>
								)}
							</Heading>
						</PriDialog.Title>
						<PriDialog.Close
							render={props => (
								<CloseButton type='button' aria-label={t`Close`} {...props}>
									<X size={18} />
								</CloseButton>
							)}
						/>
					</DialogHead>

					<Form onSubmit={handleSubmit}>
						<Field>
							<Label htmlFor='proposal-title'>
								<Trans>Title</Trans>
							</Label>
							<PriInput
								id='proposal-title'
								data-testid='proposal-title'
								value={title}
								maxLength={200}
								onChange={e => setTitle(e.target.value)}
								required
							/>
						</Field>
						<TwoCol>
							<Field>
								<Label htmlFor='proposal-total'>
									<Trans>Total value</Trans>
								</Label>
								<PriInput
									id='proposal-total'
									data-testid='proposal-total'
									value={totalValue}
									inputMode='decimal'
									placeholder='0.00'
									onChange={e => setTotalValue(e.target.value)}
								/>
							</Field>
							<Field>
								<Label htmlFor='proposal-currency'>
									<Trans>Currency</Trans>
								</Label>
								<PriInput
									id='proposal-currency'
									data-testid='proposal-currency'
									value={currency}
									maxLength={3}
									disabled={editing !== null}
									onChange={e => setCurrency(e.target.value.toUpperCase())}
								/>
							</Field>
						</TwoCol>
						{editing ? (
							<Field>
								<Label htmlFor='proposal-status'>
									<Trans>Status</Trans>
								</Label>
								<StatusSelect
									id='proposal-status'
									data-testid='proposal-status'
									value={status}
									onChange={e => setStatus(e.target.value)}
								>
									{STATUSES.map(s => (
										<option key={s.value} value={s.value}>
											{i18n._(s.label)}
										</option>
									))}
								</StatusSelect>
							</Field>
						) : (
							<Field>
								<Label htmlFor='proposal-expires'>
									<Trans>Expires (optional)</Trans>
								</Label>
								<PriInput
									id='proposal-expires'
									data-testid='proposal-expires'
									type='date'
									value={expiresAt}
									onChange={e => setExpiresAt(e.target.value)}
								/>
							</Field>
						)}
						<Field>
							<Label htmlFor='proposal-notes'>
								<Trans>Notes (optional)</Trans>
							</Label>
							<PriTextarea
								id='proposal-notes'
								data-testid='proposal-notes'
								value={notes}
								rows={4}
								onChange={e => setNotes(e.target.value)}
							/>
						</Field>
						<Footer>
							<PriButton
								type='submit'
								$variant='filled'
								data-testid='proposal-save'
								disabled={busy || title.trim().length === 0}
							>
								{busy ? <Trans>Saving…</Trans> : <Trans>Save</Trans>}
							</PriButton>
							<PriDialog.Close
								render={props => (
									<PriButton type='button' $variant='text' {...props}>
										<Trans>Cancel</Trans>
									</PriButton>
								)}
							/>
						</Footer>
					</Form>
				</PriDialog.Popup>
			</PriDialog.Portal>
		</PriDialog.Root>
	)
}

const Head = styled.div`
	display: flex;
	justify-content: flex-end;
	margin-bottom: var(--space-sm);
`

const Empty = styled.p`
	display: flex;
	align-items: center;
	gap: var(--space-2xs);
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	font-style: italic;
	color: var(--color-on-surface-variant);
	margin: 0;
`

const List = styled.div`
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
`

const Row = styled.button`
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--space-md);
	padding: var(--space-sm) var(--space-md);
	border: 1px solid color-mix(in oklab, var(--color-on-surface) 12%, transparent);
	border-radius: var(--shape-2xs);
	background: var(--color-surface);
	text-align: left;
	cursor: pointer;

	&:hover {
		border-color: color-mix(in oklab, var(--color-primary) 50%, transparent);
	}
`

const RowMain = styled.span`
	display: flex;
	flex-direction: column;
	gap: var(--space-3xs);
	min-width: 0;
`

const RowTitle = styled.span`
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	color: var(--color-on-surface);
`

const RowMeta = styled.span`
	display: inline-flex;
	gap: var(--space-2xs);
	align-items: center;
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface-variant);
`

const StatusTag = styled.span`
	font-family: var(--font-display);
	letter-spacing: 0.04em;
	text-transform: uppercase;
	color: var(--color-primary);
`

const RowTotal = styled.span`
	font-family: var(--font-display);
	color: var(--color-on-surface);
	white-space: nowrap;
`

const DialogHead = styled.div`
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	gap: var(--space-sm);
`

const Heading = styled.span`
	${stenciledTitle}
	font-size: var(--typescale-title-large-size);
`

const CloseButton = styled.button`
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 1.75rem;
	height: 1.75rem;
	padding: 0;
	border: none;
	border-radius: var(--shape-2xs);
	background: transparent;
	color: var(--color-on-surface-variant);
	cursor: pointer;
`

const Form = styled.form`
	display: flex;
	flex-direction: column;
	gap: var(--space-md);
	margin-top: var(--space-sm);
`

const TwoCol = styled.div`
	display: grid;
	grid-template-columns: 2fr 1fr;
	gap: var(--space-sm);
`

const Field = styled.div`
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
`

const Label = styled.label`
	${stenciledTitle}
	font-size: var(--typescale-label-small-size);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--color-on-surface-variant);
`

const StatusSelect = styled.select`
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	padding: var(--space-2xs) var(--space-xs);
	border-radius: var(--shape-2xs);
	border: 1px solid color-mix(in oklab, var(--color-on-surface) 24%, transparent);
	background: var(--color-surface);
	color: var(--color-on-surface);
`

const Footer = styled.div`
	display: flex;
	gap: var(--space-sm);
	justify-content: flex-end;
	margin-top: var(--space-sm);
`

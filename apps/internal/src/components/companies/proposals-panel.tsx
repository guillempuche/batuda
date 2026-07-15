import { useAtomRefresh, useAtomSet, useAtomValue } from '@effect/atom-react'
import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import { Trans, useLingui } from '@lingui/react/macro'
import { DateTime } from 'effect'
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
	readonly lineItems: unknown
}

// One editable row in the proposal — a thing being quoted, its quantity, and
// its unit price. Kept as strings while editing so a half-typed number is fine.
// `id` is a client-only key so removing a middle row doesn't shuffle the inputs
// (a plain array index would); it isn't saved.
type LineItem = {
	readonly id: string
	readonly description: string
	readonly qty: string
	readonly price: string
}

let lineIdCounter = 0
const nextLineId = () => {
	lineIdCounter += 1
	return `line-${lineIdCounter}`
}

// Pull saved line items back into the editable shape. Anything unexpected in the
// stored JSON is skipped rather than breaking the form.
function narrowLineItems(raw: unknown): ReadonlyArray<LineItem> {
	if (!Array.isArray(raw)) return []
	const out: Array<LineItem> = []
	for (const item of raw) {
		if (!item || typeof item !== 'object') continue
		const r = item as Record<string, unknown>
		const description =
			typeof r['description'] === 'string'
				? r['description']
				: typeof r['notes'] === 'string'
					? r['notes']
					: ''
		out.push({
			id: nextLineId(),
			description,
			qty: r['qty'] === undefined || r['qty'] === null ? '' : String(r['qty']),
			price:
				r['price'] === undefined || r['price'] === null
					? ''
					: String(r['price']),
		})
	}
	return out
}

// Sum the line items into a proposal total (quantity × unit price).
function lineItemsTotal(items: ReadonlyArray<LineItem>): number {
	return items.reduce((sum, item) => {
		const qty = Number.parseFloat(item.qty)
		const price = Number.parseFloat(item.price)
		if (!Number.isFinite(qty) || !Number.isFinite(price)) return sum
		return sum + qty * price
	}, 0)
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

// Typed date fields decode to DateTime.Utc on the wire; fall back to their
// string form for anything already an ISO string.
function dateToIsoOrNull(value: unknown): string | null {
	if (typeof value === 'string') return value
	if (DateTime.isDateTime(value)) return DateTime.formatIso(value)
	return null
}

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
			expiresAt: dateToIsoOrNull(r['expiresAt']),
			updatedAt: dateToIsoOrNull(r['updatedAt']),
			lineItems: r['lineItems'] ?? null,
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
	const [currency, setCurrency] = useState('EUR')
	const [expiresAt, setExpiresAt] = useState('')
	const [notes, setNotes] = useState('')
	const [lineItems, setLineItems] = useState<ReadonlyArray<LineItem>>([])
	const [busy, setBusy] = useState(false)

	const key = editing ? editing.id : target === 'new' ? 'new' : 'closed'
	const seeded = useRef<string | null>(null)
	if (seeded.current !== key) {
		seeded.current = key
		setTitle(editing?.title ?? '')
		setStatus(editing?.status ?? 'draft')
		setCurrency(editing?.currency ?? 'EUR')
		setExpiresAt(editing?.expiresAt ? editing.expiresAt.slice(0, 10) : '')
		setNotes(editing?.notes ?? '')
		setLineItems(editing ? narrowLineItems(editing.lineItems) : [])
		setBusy(false)
	}

	const total = lineItemsTotal(lineItems)

	const setLine = (index: number, patch: Partial<LineItem>) =>
		setLineItems(items =>
			items.map((item, i) => (i === index ? { ...item, ...patch } : item)),
		)
	const addLine = () =>
		setLineItems(items => [
			...items,
			{ id: nextLineId(), description: '', qty: '1', price: '' },
		])
	const removeLine = (index: number) =>
		setLineItems(items => items.filter((_, i) => i !== index))

	const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		const trimmedTitle = title.trim()
		if (trimmedTitle.length === 0 || busy) return
		setBusy(true)
		// Drop blank rows; the total is derived from the lines, not typed by hand.
		const cleanItems = lineItems
			.filter(li => li.description.trim() || li.qty.trim() || li.price.trim())
			.map(li => ({
				product_id: null,
				notes: li.description.trim(),
				qty: Number.parseFloat(li.qty) || 0,
				price: Number.parseFloat(li.price) || 0,
			}))
		const totalValue = total > 0 ? total.toFixed(2) : undefined
		const exit = editing
			? await update({
					params: { id: editing.id },
					payload: {
						title: trimmedTitle,
						status,
						lineItems: cleanItems,
						...(totalValue ? { totalValue } : {}),
						notes,
					},
				} as never)
			: await create({
					payload: {
						companyId,
						title: trimmedTitle,
						lineItems: cleanItems,
						currency,
						...(totalValue ? { totalValue } : {}),
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
						<Field>
							<Label>
								<Trans>Line items</Trans>
							</Label>
							<Lines>
								{lineItems.map((line, index) => (
									<LineRow key={line.id} data-testid='proposal-line'>
										<PriInput
											aria-label={t`Description`}
											data-testid='proposal-line-description'
											value={line.description}
											maxLength={200}
											placeholder={t`e.g. Setup fee`}
											onChange={e =>
												setLine(index, { description: e.target.value })
											}
										/>
										<QtyInput
											aria-label={t`Quantity`}
											data-testid='proposal-line-qty'
											value={line.qty}
											inputMode='decimal'
											placeholder={t`Qty`}
											onChange={e => setLine(index, { qty: e.target.value })}
										/>
										<PriceInput
											aria-label={t`Unit price`}
											data-testid='proposal-line-price'
											value={line.price}
											inputMode='decimal'
											placeholder={t`Price`}
											onChange={e => setLine(index, { price: e.target.value })}
										/>
										<RemoveLine
											type='button'
											aria-label={t`Remove line`}
											data-testid='proposal-line-remove'
											onClick={() => removeLine(index)}
										>
											<X size={14} aria-hidden />
										</RemoveLine>
									</LineRow>
								))}
								<AddLine
									type='button'
									data-testid='proposal-line-add'
									onClick={addLine}
								>
									<Plus size={14} aria-hidden />
									<Trans>Add line</Trans>
								</AddLine>
								<TotalRow data-testid='proposal-computed-total'>
									<Trans>Total</Trans>
									<TotalValue>
										{formatMoneyCents(Math.round(total * 100), {
											currency: currency || 'EUR',
											locale: i18n.locale,
										})}
									</TotalValue>
								</TotalRow>
							</Lines>
						</Field>
						{!editing ? (
							<Field>
								<Label htmlFor='proposal-currency'>
									<Trans>Currency</Trans>
								</Label>
								<CurrencyInput
									id='proposal-currency'
									data-testid='proposal-currency'
									value={currency}
									maxLength={3}
									onChange={e => setCurrency(e.target.value.toUpperCase())}
								/>
							</Field>
						) : null}
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

const Lines = styled.div`
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
`

const LineRow = styled.div`
	display: grid;
	grid-template-columns: 1fr 4rem 6rem auto;
	gap: var(--space-2xs);
	align-items: center;
`

const QtyInput = styled(PriInput)`
	text-align: right;
`

const PriceInput = styled(PriInput)`
	text-align: right;
`

const CurrencyInput = styled(PriInput)`
	max-width: 6rem;
`

const RemoveLine = styled.button`
	display: inline-flex;
	align-items: center;
	justify-content: center;
	padding: var(--space-2xs);
	background: none;
	border: none;
	color: var(--color-on-surface-variant);
	cursor: pointer;

	&:hover {
		color: var(--color-error);
	}
`

const AddLine = styled.button`
	display: inline-flex;
	align-items: center;
	gap: var(--space-3xs);
	align-self: flex-start;
	padding: var(--space-2xs) 0;
	background: none;
	border: none;
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	color: var(--color-primary);
	cursor: pointer;

	&:hover {
		text-decoration: underline;
	}
`

const TotalRow = styled.div`
	display: flex;
	justify-content: space-between;
	align-items: baseline;
	padding-top: var(--space-2xs);
	border-top: 1px solid var(--color-outline-variant);
	font-family: var(--font-display);
	letter-spacing: 0.04em;
	text-transform: uppercase;
	font-size: var(--typescale-label-small-size);
	color: var(--color-on-surface-variant);
`

const TotalValue = styled.span`
	font-size: var(--typescale-title-medium-size);
	color: var(--color-on-surface);
	text-transform: none;
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

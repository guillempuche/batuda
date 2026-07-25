import { useAtomRefresh, useAtomSet, useAtomValue } from '@effect/atom-react'
import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import { Trans, useLingui } from '@lingui/react/macro'
import { DateTime } from 'effect'
import { AsyncResult } from 'effect/unstable/reactivity'
import { FileText, Pencil, Plus, X } from 'lucide-react'
import { type FormEvent, useMemo, useRef, useState } from 'react'
import styled from 'styled-components'

import {
	PriButton,
	PriDialog,
	PriInput,
	PriTextarea,
	usePriToast,
} from '@batuda/ui/pri'

import { MarkdownView } from '#/components/markdown/markdown-view'
import { RelativeDate } from '#/components/shared/relative-date'
import { BatudaApiAtom } from '#/lib/batuda-api-atom'
import { stenciledTitle } from '#/lib/workshop-mixins'

type DocRow = {
	readonly id: string
	readonly type: string
	readonly title: string | null
	readonly content: string
	readonly updatedAt: string | null
}

// The document kinds the picker offers; `type` is free text server-side.
const DOC_TYPES: ReadonlyArray<{
	readonly value: string
	readonly label: MessageDescriptor
}> = [
	{ value: 'general', label: msg`General` },
	{ value: 'prenote', label: msg`Meeting prep` },
	{ value: 'postnote', label: msg`Meeting notes` },
	{ value: 'call_notes', label: msg`Call notes` },
	{ value: 'visit_notes', label: msg`Visit notes` },
	{ value: 'research', label: msg`Research` },
]

// Typed date fields decode to DateTime.Utc on the wire; fall back to their
// string form for anything already an ISO string.
function dateToIsoOrNull(value: unknown): string | null {
	if (typeof value === 'string') return value
	if (DateTime.isDateTime(value)) return DateTime.formatIso(value)
	return null
}

function narrowDocs(rows: ReadonlyArray<unknown>): ReadonlyArray<DocRow> {
	const out: Array<DocRow> = []
	for (const row of rows) {
		if (!row || typeof row !== 'object') continue
		const r = row as Record<string, unknown>
		if (typeof r['id'] !== 'string') continue
		out.push({
			id: r['id'],
			type: typeof r['type'] === 'string' ? r['type'] : 'general',
			title: typeof r['title'] === 'string' ? r['title'] : null,
			content: typeof r['content'] === 'string' ? r['content'] : '',
			updatedAt: dateToIsoOrNull(r['updatedAt']),
		})
	}
	return out
}

type DialogState =
	| { readonly mode: 'closed' }
	| { readonly mode: 'view'; readonly doc: DocRow }
	| { readonly mode: 'edit'; readonly doc: DocRow }
	| { readonly mode: 'add' }

/** List, read, create, and edit a company's documents (markdown), on the Files tab. */
export function DocumentsPanel({ companyId }: { readonly companyId: string }) {
	const { i18n, t } = useLingui()
	const docsAtom = useMemo(
		() => BatudaApiAtom.query('documents', 'list', { query: { companyId } }),
		[companyId],
	)
	const result = useAtomValue(docsAtom)
	const refresh = useAtomRefresh(docsAtom)
	const docs = AsyncResult.isSuccess(result)
		? narrowDocs(result.value.items)
		: []
	const [dialog, setDialog] = useState<DialogState>({ mode: 'closed' })

	const typeLabel = (type: string) => {
		const found = DOC_TYPES.find(dt => dt.value === type)
		return found ? i18n._(found.label) : type
	}

	return (
		<>
			<Head>
				<PriButton
					type='button'
					$variant='outlined'
					data-testid='company-add-document'
					onClick={() => setDialog({ mode: 'add' })}
				>
					<Plus size={14} aria-hidden />
					<Trans>Add document</Trans>
				</PriButton>
			</Head>

			{docs.length === 0 ? (
				<Empty>
					<FileText size={18} aria-hidden />
					<Trans>No documents yet.</Trans>
				</Empty>
			) : (
				<List>
					{docs.map(doc => (
						<Row key={doc.id} data-testid={`document-row-${doc.id}`}>
							<RowButton
								type='button'
								onClick={() => setDialog({ mode: 'view', doc })}
							>
								<RowTitle>{doc.title ?? typeLabel(doc.type)}</RowTitle>
								<RowMeta>
									<TypeTag>{typeLabel(doc.type)}</TypeTag>
									<RelativeDate value={doc.updatedAt} />
								</RowMeta>
							</RowButton>
							<EditButton
								type='button'
								aria-label={t`Edit document`}
								data-testid={`document-edit-${doc.id}`}
								onClick={() => setDialog({ mode: 'edit', doc })}
							>
								<Pencil size={14} aria-hidden />
							</EditButton>
						</Row>
					))}
				</List>
			)}

			<DocumentDialog
				state={dialog}
				companyId={companyId}
				onClose={() => setDialog({ mode: 'closed' })}
				onSaved={() => {
					refresh()
					setDialog({ mode: 'closed' })
				}}
				onEdit={doc => setDialog({ mode: 'edit', doc })}
			/>
		</>
	)
}

function DocumentDialog({
	state,
	companyId,
	onClose,
	onSaved,
	onEdit,
}: {
	readonly state: DialogState
	readonly companyId: string
	readonly onClose: () => void
	readonly onSaved: () => void
	readonly onEdit: (doc: DocRow) => void
}) {
	const { i18n, t } = useLingui()
	const toast = usePriToast()
	const create = useAtomSet(BatudaApiAtom.mutation('documents', 'create'), {
		mode: 'promiseExit',
	})
	const update = useAtomSet(BatudaApiAtom.mutation('documents', 'update'), {
		mode: 'promiseExit',
	})

	const editing = state.mode === 'edit' ? state.doc : null
	const [title, setTitle] = useState('')
	const [type, setType] = useState('general')
	const [content, setContent] = useState('')
	const [busy, setBusy] = useState(false)

	// Re-seed the form each time the dialog opens for a different doc/mode.
	const formKey = state.mode === 'edit' ? state.doc.id : state.mode
	const seededKey = useRef<string | null>(null)
	if (seededKey.current !== formKey) {
		seededKey.current = formKey
		setTitle(editing?.title ?? '')
		setType(editing?.type ?? 'general')
		setContent(editing?.content ?? '')
		setBusy(false)
	}

	const open = state.mode !== 'closed'
	const isForm = state.mode === 'add' || state.mode === 'edit'

	const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		if (content.trim().length === 0 || busy) return
		setBusy(true)
		const trimmedTitle = title.trim()
		const exit = editing
			? await update({
					params: { id: editing.id },
					payload: {
						...(trimmedTitle ? { title: trimmedTitle } : {}),
						content,
					},
				} as never)
			: await create({
					payload: {
						companyId,
						type,
						...(trimmedTitle ? { title: trimmedTitle } : {}),
						content,
					},
				} as never)
		setBusy(false)
		if (exit._tag === 'Success') {
			onSaved()
			return
		}
		toast.add({ title: t`Could not save the document`, type: 'error' })
	}

	return (
		<PriDialog.Root open={open} onOpenChange={next => !next && onClose()}>
			<PriDialog.Portal>
				<PriDialog.Backdrop />
				<PriDialog.Popup data-testid='document-dialog'>
					<DialogHead>
						<PriDialog.Title>
							<Heading>
								{state.mode === 'add' ? (
									<Trans>Add document</Trans>
								) : state.mode === 'edit' ? (
									<Trans>Edit document</Trans>
								) : state.mode === 'view' ? (
									(state.doc.title ?? <Trans>Document</Trans>)
								) : null}
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

					{state.mode === 'view' ? (
						<>
							<ViewBody data-testid='document-view'>
								<MarkdownView source={state.doc.content} />
							</ViewBody>
							<Footer>
								<PriButton
									type='button'
									$variant='filled'
									onClick={() => onEdit(state.doc)}
								>
									<Trans>Edit</Trans>
								</PriButton>
							</Footer>
						</>
					) : isForm ? (
						<Form onSubmit={handleSubmit}>
							<Field>
								<Label htmlFor='document-title'>
									<Trans>Title (optional)</Trans>
								</Label>
								<PriInput
									id='document-title'
									data-testid='document-title'
									value={title}
									maxLength={200}
									onChange={e => setTitle(e.target.value)}
								/>
							</Field>
							{state.mode === 'add' ? (
								<Field>
									<Label htmlFor='document-type'>
										<Trans>Type</Trans>
									</Label>
									<TypeSelect
										id='document-type'
										data-testid='document-type'
										value={type}
										onChange={e => setType(e.target.value)}
									>
										{DOC_TYPES.map(dt => (
											<option key={dt.value} value={dt.value}>
												{i18n._(dt.label)}
											</option>
										))}
									</TypeSelect>
								</Field>
							) : null}
							<Field>
								<Label htmlFor='document-content'>
									<Trans>Content (Markdown)</Trans>
								</Label>
								<PriTextarea
									id='document-content'
									data-testid='document-content'
									value={content}
									rows={12}
									onChange={e => setContent(e.target.value)}
									required
								/>
							</Field>
							<Footer>
								<PriButton
									type='submit'
									$variant='filled'
									data-testid='document-save'
									disabled={busy || content.trim().length === 0}
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
					) : null}
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

const Row = styled.div`
	display: flex;
	align-items: center;
	gap: var(--space-2xs);
	border: 1px solid color-mix(in oklab, var(--color-on-surface) 12%, transparent);
	border-radius: var(--shape-2xs);
	background: var(--color-surface);
`

const RowButton = styled.button`
	flex: 1 1 auto;
	display: flex;
	flex-direction: column;
	gap: var(--space-3xs);
	padding: var(--space-sm) var(--space-md);
	background: none;
	border: none;
	text-align: left;
	cursor: pointer;

	&:hover {
		background: color-mix(in oklab, var(--color-primary) 6%, transparent);
	}
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

const TypeTag = styled.span`
	font-family: var(--font-display);
	letter-spacing: 0.04em;
	text-transform: uppercase;
	color: var(--color-primary);
`

const EditButton = styled.button`
	display: inline-flex;
	align-items: center;
	padding: var(--space-2xs) var(--space-sm);
	background: none;
	border: none;
	color: var(--color-on-surface-variant);
	cursor: pointer;

	&:hover {
		color: var(--color-on-surface);
	}
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

const ViewBody = styled.div`
	margin-top: var(--space-sm);
	max-height: 60vh;
	overflow-y: auto;
`

const Form = styled.form`
	display: flex;
	flex-direction: column;
	gap: var(--space-md);
	margin-top: var(--space-sm);
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

const TypeSelect = styled.select`
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

import { useAtomSet, useAtomValue } from '@effect/atom-react'
import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import { Trans, useLingui } from '@lingui/react/macro'
import { Link } from '@tanstack/react-router'
import { DateTime, Schema } from 'effect'
import { AsyncResult } from 'effect/unstable/reactivity'
import { FileText, Pencil, Plus, X } from 'lucide-react'
import { type FormEvent, useMemo, useRef, useState } from 'react'
import styled from 'styled-components'

import type { DocumentSubjectTable } from '@batuda/domain'
import {
	PriButton,
	PriDialog,
	PriInput,
	PriTextarea,
	usePriToast,
} from '@batuda/ui/pri'

import {
	documentsListAtom,
	SUBJECT_DOCUMENTS_PAGE_SIZE,
} from '#/atoms/documents-atoms'
import { MarkdownView } from '#/components/markdown/markdown-view'
import { InfiniteListFooter } from '#/components/shared/infinite-list-footer'
import { RelativeDate } from '#/components/shared/relative-date'
import { useInfiniteList } from '#/hooks/use-infinite-list'
import { BatudaApiAtom } from '#/lib/batuda-api-atom'
import { dlgNoId, dlgWithId } from '#/lib/dlg-search'
import { documentOpenUrl } from '#/lib/document-links'
import { useDlg } from '#/lib/use-dlg'
import { stenciledTitle } from '#/lib/workshop-mixins'

// Prefixed because the company page this panel sits on carries one `?dlg=` for
// all of its dialogs: two kinds sharing a name would leave the second
// unreachable.
export const documentsDlgMembers = [
	dlgWithId('doc-view'),
	dlgWithId('doc-edit'),
	dlgNoId('doc-add'),
] as const
const documentsDlgSchema = Schema.Union(documentsDlgMembers)

type DocRow = {
	readonly id: string
	readonly type: string
	readonly format: string
	readonly title: string | null
	readonly snippet: string
	readonly updatedAt: string | null
}

// The document kinds the picker offers, matching the list the server accepts.
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
			format: r['format'] === 'html' ? 'html' : 'markdown',
			title: typeof r['title'] === 'string' ? r['title'] : null,
			snippet: typeof r['snippet'] === 'string' ? r['snippet'] : '',
			updatedAt: dateToIsoOrNull(r['updatedAt']),
		})
	}
	return out
}

type DocBody = {
	readonly content: string
}

function narrowBody(value: unknown): DocBody | null {
	if (!value || typeof value !== 'object') return null
	const content = (value as Record<string, unknown>)['content']
	return typeof content === 'string' ? { content } : null
}

type DialogState =
	| { readonly mode: 'closed' }
	| { readonly mode: 'view'; readonly doc: DocRow }
	| { readonly mode: 'edit'; readonly doc: DocRow }
	| { readonly mode: 'add' }

/**
 * List, read, write and delete the documents filed against one record.
 *
 * The record is whatever it is handed — a company, a person, a task, an offer,
 * a meeting — so the same panel serves every surface that keeps notes.
 */
export function DocumentsPanel({
	subjectTable,
	subjectId,
}: {
	readonly subjectTable: DocumentSubjectTable
	readonly subjectId: string
}) {
	const { i18n, t } = useLingui()
	const list = useInfiniteList({
		resetKey: `documents:${subjectTable}:${subjectId}`,
		pageSize: SUBJECT_DOCUMENTS_PAGE_SIZE,
		count: 'exact',
		atomFor: page => documentsListAtom({ subjectTable, subjectId }, page),
	})
	const refresh = list.refresh
	const docs = narrowDocs(list.items)

	const { dlg, open: openDlg, close: closeDlg } = useDlg(documentsDlgSchema)
	// Only the id travels in the URL; the row is rebuilt from the loaded list, so
	// a link reopens the same document, and one that has since gone leaves the
	// dialog closed.
	const dialog = useMemo<DialogState>(() => {
		if (dlg === undefined) return { mode: 'closed' }
		if (dlg.kind === 'doc-add') return { mode: 'add' }
		const doc = docs.find(d => d.id === dlg.id)
		if (doc === undefined) return { mode: 'closed' }
		return dlg.kind === 'doc-view'
			? { mode: 'view', doc }
			: { mode: 'edit', doc }
	}, [dlg, docs])

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
					onClick={() => openDlg({ kind: 'doc-add' })}
				>
					<Plus size={14} aria-hidden />
					<Trans>Add document</Trans>
				</PriButton>
			</Head>

			{docs.length === 0 ? (
				// Saying "none yet" while the first ones are still arriving would
				// be wrong, so the panel waits before saying anything.
				list.isLoadingFirstPage ? null : (
					<Empty>
						<FileText size={18} aria-hidden />
						<Trans>No documents yet.</Trans>
					</Empty>
				)
			) : (
				<List>
					{docs.map(doc => (
						<Row key={doc.id} data-testid={`document-row-${doc.id}`}>
							<RowButton
								type='button'
								onClick={() => openDlg({ kind: 'doc-view', id: doc.id })}
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
								onClick={() => openDlg({ kind: 'doc-edit', id: doc.id })}
							>
								<Pencil size={14} aria-hidden />
							</EditButton>
						</Row>
					))}
				</List>
			)}

			<InfiniteListFooter
				list={list}
				testId='subject-documents'
				listLabel={t`documents`}
			/>

			{dialog.mode === 'closed' ? null : (
				<DocumentDialogHost
					state={dialog}
					subjectTable={subjectTable}
					subjectId={subjectId}
					onClose={closeDlg}
					onSaved={() => {
						refresh()
						closeDlg()
					}}
					// Reading and editing the same document are one step, so Back
					// leaves the document instead of returning to the read view.
					onEdit={doc =>
						openDlg({ kind: 'doc-edit', id: doc.id }, { replace: true })
					}
				/>
			)}
		</>
	)
}

// The host is only rendered while a dialog is open, so everything below it can
// count on there being something to show.
type OpenDialogState = Exclude<DialogState, { readonly mode: 'closed' }>

type DialogProps = {
	readonly state: OpenDialogState
	readonly subjectTable: DocumentSubjectTable
	readonly subjectId: string
	readonly onClose: () => void
	readonly onSaved: () => void
	readonly onEdit: (doc: DocRow) => void
}

/**
 * Fetches the body only when there is a document to read.
 *
 * The list carries a snippet, not the whole document, so reading or editing one
 * needs a second request — but writing a new one does not, and a component that
 * always asked would fetch on every open of the Add dialog for nothing.
 */
function DocumentDialogHost(props: DialogProps) {
	if (props.state.mode === 'add') {
		return <DocumentDialog {...props} body={{ content: '' }} />
	}
	return <DocumentDialogWithBody {...props} id={props.state.doc.id} />
}

function DocumentDialogWithBody(props: DialogProps & { readonly id: string }) {
	const bodyAtom = useMemo(
		() => BatudaApiAtom.query('documents', 'get', { params: { id: props.id } }),
		[props.id],
	)
	const result = useAtomValue(bodyAtom)
	const body = AsyncResult.isSuccess(result) ? narrowBody(result.value) : null
	return <DocumentDialog {...props} body={body} />
}

function DocumentDialog({
	state,
	subjectTable,
	subjectId,
	body,
	onClose,
	onSaved,
	onEdit,
}: DialogProps & { readonly body: DocBody | null }) {
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

	// Re-seed the form each time the dialog opens for a different doc/mode, and
	// again once the body has arrived for the one being edited — until then the
	// box would hold nothing, and saving would wipe the document.
	const formKey =
		state.mode === 'edit'
			? `${state.doc.id}:${body === null ? 'loading' : 'ready'}`
			: state.mode
	const seededKey = useRef<string | null>(null)
	if (seededKey.current !== formKey) {
		seededKey.current = formKey
		setTitle(editing?.title ?? '')
		setType(editing?.type ?? 'general')
		setContent(body?.content ?? '')
		setBusy(false)
	}

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
						subjectTable,
						subjectId,
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
		<PriDialog.Root open onOpenChange={next => !next && onClose()}>
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
							<ViewBody
								data-testid='document-view'
								role='region'
								aria-label={t`Document`}
								tabIndex={0}
							>
								{state.doc.format === 'html' ? (
									// A web page opens in its own tab, exactly as it was
									// saved. Showing it here would mean stripping it down
									// to something safe to put beside the rest of the app,
									// and a stripped page is not what someone opening a
									// report wants to see.
									<HtmlNotice>
										<Trans>
											This document is a web page. It opens in a new tab.
										</Trans>
										<OpenPageLink
											href={documentOpenUrl(state.doc.id)}
											target='_blank'
											rel='noreferrer'
											data-testid='document-open-original'
										>
											<Trans>Open the page</Trans>
										</OpenPageLink>
									</HtmlNotice>
								) : (
									<MarkdownView source={body?.content ?? state.doc.snippet} />
								)}
							</ViewBody>
							<Footer>
								{state.doc.format === 'html' ? null : (
									<PriButton
										type='button'
										$variant='filled'
										onClick={() => onEdit(state.doc)}
									>
										<Trans>Edit</Trans>
									</PriButton>
								)}
								{/* This popup is for a quick look. The page behind the
								    link is the one that can be sent to somebody. */}
								<FullPageLink>
									<Link
										to='/documents/$id'
										params={{ id: state.doc.id }}
										data-testid='document-open-full-page'
									>
										<Trans>Open full page</Trans>
									</Link>
								</FullPageLink>
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

// A document longer than the dialog scrolls here, and the region takes keyboard
// focus so it can be read without a mouse.
const ViewBody = styled.div`
	margin-top: var(--space-sm);
	max-height: 60vh;
	overflow-y: auto;

	&:focus-visible {
		outline: none;
		box-shadow: var(--glow-active);
	}
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

const HtmlNotice = styled.div`
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	gap: var(--space-md);
	color: var(--color-on-surface-variant);
	font-size: var(--typescale-body-medium-size);
`

// Styling wraps the link rather than the router's own component, whose typed
// route parameters do not survive being wrapped.
const FullPageLink = styled.span`
	align-self: center;

	a {
		color: var(--color-primary);
		font-size: var(--typescale-body-medium-size);
		text-decoration: underline;
	}
`

const OpenPageLink = styled.a`
	color: var(--color-primary);
	font-size: var(--typescale-body-medium-size);
	text-decoration: underline;
`

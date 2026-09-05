import { useLingui } from '@lingui/react/macro'
import { AlertTriangle, Loader2, Paperclip, X } from 'lucide-react'
import { keyframes, styled } from 'next-yak'
import { useCallback, useEffect, useId, useRef, useState } from 'react'

import {
	discardAttachment,
	formatBytes,
	type StagedAttachment,
	uploadAttachment,
} from '#/lib/email-attachments'

type PendingUpload = {
	readonly id: string
	readonly file: File
	readonly controller: AbortController
	status: 'uploading' | 'error'
	error?: string
}

/**
 * Attachment picker — paperclip button + drop zone. Streams each file
 * to the staging endpoint and reports completed `StagedAttachment`
 * objects up to the parent via `onChange`. In-flight uploads live in
 * local state with abort controllers so the user can cancel mid-flight.
 *
 * `inboxId` is required by the staging endpoint — every attachment is
 * scoped to the inbox that will eventually send it, both for org-scope
 * isolation and for storage-key namespacing.
 */
export function AttachmentPicker({
	value,
	onChange,
	onUploadingChange,
	disabled,
	inboxId,
	draftId,
}: {
	readonly value: ReadonlyArray<StagedAttachment>
	readonly onChange: (next: ReadonlyArray<StagedAttachment>) => void
	/**
	 * Called while a file is not yet on the message — still on its way up, or
	 * stopped on an error the sender has not cleared. The sender has to know:
	 * sending now sends the message without it, and nothing afterwards says so.
	 */
	readonly onUploadingChange?: (uploading: boolean) => void
	readonly disabled?: boolean
	readonly inboxId: string | null
	readonly draftId?: string
}) {
	const { t } = useLingui()
	const inputId = useId()
	const inputRef = useRef<HTMLInputElement | null>(null)
	const [pending, setPending] = useState<ReadonlyArray<PendingUpload>>([])

	// The list as it stands after every change dispatched so far, which is not
	// the same as the list last rendered: files chosen together finish in the
	// same tick, and each would otherwise be added to the list as it was before
	// any of them began, so all but one would vanish from the window.
	//
	// Seeded once and written only here, which is sound because nothing else
	// writes it — the parent sets this list from this component and from
	// nowhere else.
	const settled = useRef(value)
	const replaceValue = useCallback(
		(next: ReadonlyArray<StagedAttachment>) => {
			settled.current = next
			onChange(next)
		},
		[onChange],
	)

	// An upload stopped on an error is not on the message either, and clearing
	// it is the sender's to do — so it holds Send just as an in-flight one does.
	const unfinished = pending.length > 0
	useEffect(() => {
		onUploadingChange?.(unfinished)
	}, [unfinished, onUploadingChange])

	const startUpload = useCallback(
		(file: File) => {
			if (inboxId === null) return // No inbox yet; the picker should be disabled.
			const controller = new AbortController()
			const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
			const entry: PendingUpload = {
				id,
				file,
				controller,
				status: 'uploading',
			}
			setPending(prev => [...prev, entry])

			uploadAttachment(file, {
				inboxId,
				...(draftId !== undefined && { draftId }),
				signal: controller.signal,
			})
				.then(result => {
					setPending(prev => prev.filter(p => p.id !== id))
					replaceValue([...settled.current, result])
				})
				.catch((error: unknown) => {
					if (controller.signal.aborted) {
						setPending(prev => prev.filter(p => p.id !== id))
						return
					}
					const message =
						error instanceof Error ? error.message : 'Upload failed'
					setPending(prev =>
						prev.map(p =>
							p.id === id ? { ...p, status: 'error', error: message } : p,
						),
					)
				})
		},
		[replaceValue, inboxId, draftId],
	)

	const handleFiles = useCallback(
		(files: FileList | null) => {
			if (files === null) return
			for (const file of Array.from(files)) {
				startUpload(file)
			}
		},
		[startUpload],
	)

	const handleCancel = useCallback((id: string) => {
		setPending(prev => {
			const entry = prev.find(p => p.id === id)
			if (entry !== undefined) entry.controller.abort()
			return prev.filter(p => p.id !== id)
		})
	}, [])

	const handleRemove = useCallback(
		(stagingId: string) => {
			replaceValue(settled.current.filter(v => v.stagingId !== stagingId))
			// The send reads every file staged against the draft, not this list —
			// so dropping the chip alone leaves the file on the message and it
			// goes out after somebody took it off on purpose. Nothing to do if
			// the call fails: the chip is already gone, and the sweep that
			// expires staged files will catch the row.
			if (inboxId !== null) {
				void discardAttachment(stagingId, { inboxId }).catch(() => {})
			}
		},
		[replaceValue, inboxId],
	)

	const hasAny = value.length > 0 || pending.length > 0

	return (
		<Wrapper>
			<PickerButton
				type='button'
				data-testid='compose-attach'
				onClick={() => inputRef.current?.click()}
				disabled={disabled}
				aria-label={t`Add attachment`}
			>
				<Paperclip size={14} aria-hidden />
				<span>{t`Attach`}</span>
			</PickerButton>
			<input
				ref={inputRef}
				id={inputId}
				type='file'
				multiple
				hidden
				onChange={event => {
					handleFiles(event.target.files)
					event.target.value = ''
				}}
			/>
			{hasAny ? (
				<ChipList>
					{value.map(att => (
						<Chip key={att.stagingId}>
							<Paperclip size={12} aria-hidden />
							<ChipText>
								<ChipName>{att.filename}</ChipName>
								<ChipSize>{formatBytes(att.size)}</ChipSize>
							</ChipText>
							<ChipRemove
								type='button'
								onClick={() => handleRemove(att.stagingId)}
								aria-label={t`Remove ${att.filename}`}
							>
								<X size={10} aria-hidden />
							</ChipRemove>
						</Chip>
					))}
					{pending.map(up => (
						<Chip key={up.id} $state={up.status}>
							{up.status === 'uploading' ? (
								<Spinner size={12} aria-hidden />
							) : (
								<AlertTriangle size={12} aria-hidden />
							)}
							<ChipText>
								<ChipName>{up.file.name}</ChipName>
								<ChipSize>
									{up.status === 'uploading'
										? t`Uploading…`
										: (up.error ?? t`Upload failed`)}
								</ChipSize>
							</ChipText>
							<ChipRemove
								type='button'
								onClick={() => handleCancel(up.id)}
								aria-label={t`Cancel upload`}
							>
								<X size={10} aria-hidden />
							</ChipRemove>
						</Chip>
					))}
				</ChipList>
			) : null}
		</Wrapper>
	)
}

const Wrapper = styled.div`
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
`

const PickerButton = styled.button`
	display: inline-flex;
	align-items: center;
	gap: var(--space-2xs);
	padding: var(--space-2xs) var(--space-sm);
	border: 1px dashed var(--color-outline);
	border-radius: var(--shape-2xs);
	background: transparent;
	color: var(--color-on-surface-variant);
	font-family: var(--font-display);
	font-size: var(--typescale-label-medium-size);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	cursor: pointer;
	align-self: flex-start;

	&:hover:not(:disabled) {
		color: var(--color-primary);
		border-color: var(--color-primary);
	}

	&:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
`

const ChipList = styled.div`
	display: flex;
	flex-wrap: wrap;
	gap: var(--space-2xs);
`

const Chip = styled.div<{ $state?: 'uploading' | 'error' }>`
	display: inline-flex;
	align-items: center;
	gap: var(--space-2xs);
	padding: var(--space-3xs) var(--space-2xs);
	border: 1px solid
		${p =>
			p.$state === 'error'
				? 'color-mix(in oklab, var(--color-error) 40%, transparent)'
				: 'var(--color-outline)'};
	border-radius: var(--shape-2xs);
	background: var(--color-surface);
	color: ${p => (p.$state === 'error' ? 'var(--color-error)' : 'inherit')};
	max-width: 220px;
`

const ChipText = styled.div`
	display: flex;
	flex-direction: column;
	min-width: 0;
`

const ChipName = styled.span`
	font-size: var(--typescale-body-small-size);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
`

const ChipSize = styled.span`
	font-size: var(--typescale-label-small-size);
	color: var(--color-on-surface-variant);
`

const ChipRemove = styled.button`
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 1.125rem;
	height: 1.125rem;
	padding: 0;
	border: none;
	border-radius: var(--shape-2xs);
	background: transparent;
	color: inherit;
	cursor: pointer;

	&:hover {
		background: color-mix(in oklab, var(--color-on-surface) 12%, transparent);
	}
`

const spin = keyframes`
	from {
		transform: rotate(0deg);
	}
	to {
		transform: rotate(360deg);
	}
`

const Spinner = styled(Loader2)`
	animation: ${spin} 1s linear infinite;

`

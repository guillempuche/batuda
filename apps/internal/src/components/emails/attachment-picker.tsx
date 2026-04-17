import { useLingui } from '@lingui/react/macro'
import { AlertTriangle, Loader2, Paperclip, X } from 'lucide-react'
import { useCallback, useId, useRef, useState } from 'react'
import styled from 'styled-components'

import {
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
 */
export function AttachmentPicker({
	value,
	onChange,
	disabled,
}: {
	readonly value: ReadonlyArray<StagedAttachment>
	readonly onChange: (next: ReadonlyArray<StagedAttachment>) => void
	readonly disabled?: boolean
}) {
	const { t } = useLingui()
	const inputId = useId()
	const inputRef = useRef<HTMLInputElement | null>(null)
	const [pending, setPending] = useState<ReadonlyArray<PendingUpload>>([])

	const startUpload = useCallback(
		(file: File) => {
			const controller = new AbortController()
			const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
			const entry: PendingUpload = {
				id,
				file,
				controller,
				status: 'uploading',
			}
			setPending(prev => [...prev, entry])

			uploadAttachment(file, { signal: controller.signal })
				.then(result => {
					setPending(prev => prev.filter(p => p.id !== id))
					onChange([...value, result])
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
		[onChange, value],
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
			onChange(value.filter(v => v.stagingId !== stagingId))
		},
		[onChange, value],
	)

	const hasAny = value.length > 0 || pending.length > 0

	return (
		<Wrapper>
			<PickerButton
				type='button'
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

const Wrapper = styled.div.withConfig({ displayName: 'AttachmentPicker' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
`

const PickerButton = styled.button.withConfig({
	displayName: 'AttachmentPickerButton',
})`
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

const ChipList = styled.div.withConfig({
	displayName: 'AttachmentPickerChipList',
})`
	display: flex;
	flex-wrap: wrap;
	gap: var(--space-2xs);
`

const Chip = styled.div.withConfig({
	displayName: 'AttachmentPickerChip',
	shouldForwardProp: prop => prop !== '$state',
})<{ $state?: 'uploading' | 'error' }>`
	display: inline-flex;
	align-items: center;
	gap: var(--space-2xs);
	padding: var(--space-3xs) var(--space-2xs);
	border: 1px solid
		${p =>
			p.$state === 'error'
				? 'color-mix(in oklab, var(--color-error, #c6664b) 40%, transparent)'
				: 'var(--color-outline)'};
	border-radius: var(--shape-2xs);
	background: var(--color-surface);
	color: ${p =>
		p.$state === 'error' ? 'var(--color-error, #c6664b)' : 'inherit'};
	max-width: 220px;
`

const ChipText = styled.div.withConfig({
	displayName: 'AttachmentPickerChipText',
})`
	display: flex;
	flex-direction: column;
	min-width: 0;
`

const ChipName = styled.span.withConfig({
	displayName: 'AttachmentPickerChipName',
})`
	font-size: var(--typescale-body-small-size);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
`

const ChipSize = styled.span.withConfig({
	displayName: 'AttachmentPickerChipSize',
})`
	font-size: var(--typescale-label-small-size);
	color: var(--color-on-surface-variant);
`

const ChipRemove = styled.button.withConfig({
	displayName: 'AttachmentPickerChipRemove',
})`
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

const Spinner = styled(Loader2)`
	animation: spin 1s linear infinite;

	@keyframes spin {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}
`

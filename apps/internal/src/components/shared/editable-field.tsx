import { useLingui } from '@lingui/react/macro'
import { Check, ChevronsUpDown, Pencil, X } from 'lucide-react'
import {
	type KeyboardEvent,
	type ReactNode,
	useCallback,
	useEffect,
	useRef,
	useState,
} from 'react'
import styled from 'styled-components'

import { PriInput, PriSelect } from '@batuda/ui/pri'

import {
	agedPaperSurface,
	brushedMetalPlate,
	stenciledTitle,
} from '#/lib/workshop-mixins'

type InputKind = 'text' | 'email' | 'url' | 'tel' | 'number'

export interface EditableFieldProps {
	readonly label: string
	readonly value: string | null
	readonly onSave: (next: string | null) => Promise<void>
	readonly type?: InputKind
	readonly multiline?: boolean
	readonly placeholder?: string
}

/**
 * Click-to-edit replacement for the read-only ProfileField.
 * Enter commits (Ctrl+Enter for multiline), Escape cancels, blur commits.
 * Empty string saves as `null`. Stays in edit mode if `onSave` throws so
 * the draft isn't lost.
 */
export function EditableField({
	label,
	value,
	onSave,
	type = 'text',
	multiline = false,
	placeholder,
}: EditableFieldProps) {
	const { t } = useLingui()
	const [editing, setEditing] = useState(false)
	const [draft, setDraft] = useState(value ?? '')
	const [pending, setPending] = useState(false)
	const cancelledRef = useRef(false)
	const inputRef = useRef<HTMLInputElement | null>(null)
	const textareaRef = useRef<HTMLTextAreaElement | null>(null)

	useEffect(() => {
		if (!editing) setDraft(value ?? '')
	}, [editing, value])

	useEffect(() => {
		if (!editing) return
		const el = multiline ? textareaRef.current : inputRef.current
		if (el === null) return
		el.focus()
		el.select()
	}, [editing, multiline])

	const commit = useCallback(async () => {
		if (cancelledRef.current) {
			cancelledRef.current = false
			return
		}
		const next = draft.trim()
		const canonical = next.length === 0 ? null : next
		if (canonical === (value ?? null)) {
			setEditing(false)
			return
		}
		setPending(true)
		try {
			await onSave(canonical)
			setEditing(false)
		} finally {
			setPending(false)
		}
	}, [draft, value, onSave])

	const cancel = useCallback(() => {
		cancelledRef.current = true
		setDraft(value ?? '')
		setEditing(false)
	}, [value])

	const handleKey = (
		e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
	) => {
		if (e.key === 'Escape') {
			e.preventDefault()
			cancel()
			return
		}
		if (e.key === 'Enter') {
			if (multiline && !(e.ctrlKey || e.metaKey)) return
			e.preventDefault()
			void commit()
		}
	}

	return (
		<Field>
			<FieldLabel>{label}</FieldLabel>
			{editing ? (
				multiline ? (
					<TextArea
						ref={textareaRef}
						value={draft}
						onChange={e => setDraft(e.target.value)}
						onBlur={() => void commit()}
						onKeyDown={handleKey}
						placeholder={placeholder}
						disabled={pending}
						rows={3}
						aria-label={label}
					/>
				) : (
					<PriInput
						ref={inputRef}
						type={type}
						value={draft}
						onChange={e => setDraft(e.target.value)}
						onBlur={() => void commit()}
						onKeyDown={handleKey}
						placeholder={placeholder}
						disabled={pending}
						aria-label={label}
					/>
				)
			) : (
				<ReadTrigger
					type='button'
					onClick={() => setEditing(true)}
					$multiline={multiline}
					aria-label={t`Edit ${label}`}
				>
					{value !== null && value !== '' ? (
						multiline ? (
							<ValueMultiline>{value}</ValueMultiline>
						) : (
							<Value>{value}</Value>
						)
					) : (
						<Empty>—</Empty>
					)}
					<PencilMark aria-hidden>
						<Pencil size={12} />
					</PencilMark>
				</ReadTrigger>
			)}
		</Field>
	)
}

export interface EditableSelectOption {
	readonly value: string
	readonly label: string
}

export interface EditableSelectProps {
	readonly label: string
	readonly value: string | null
	readonly options: ReadonlyArray<EditableSelectOption>
	readonly onSave: (next: string | null) => Promise<void>
	readonly placeholder?: string
}

/**
 * Dropdown editor — commits immediately when the user picks a different
 * option. No separate edit/read modes because selection is atomic.
 * Trigger displays the option label, falling back to placeholder/em-dash.
 */
export function EditableSelect({
	label,
	value,
	options,
	onSave,
	placeholder,
}: EditableSelectProps) {
	const [pending, setPending] = useState(false)
	const current =
		options.find(o => o.value === value) ??
		(value !== null ? { value, label: value } : null)

	const handleChange = async (next: unknown) => {
		if (typeof next !== 'string') return
		if (next === (value ?? '')) return
		setPending(true)
		try {
			await onSave(next.length === 0 ? null : next)
		} finally {
			setPending(false)
		}
	}

	return (
		<Field>
			<FieldLabel>{label}</FieldLabel>
			<PriSelect.Root
				items={options as Array<EditableSelectOption>}
				value={value ?? ''}
				onValueChange={handleChange}
				disabled={pending}
			>
				<SelectTrigger>
					{current !== null ? (
						<PriSelect.Value>{current.label}</PriSelect.Value>
					) : (
						<Empty>{placeholder ?? '—'}</Empty>
					)}
					<PriSelect.Icon>
						<ChevronsUpDown size={12} aria-hidden />
					</PriSelect.Icon>
				</SelectTrigger>
				<PriSelect.Portal>
					<PriSelect.Positioner alignItemWithTrigger={false} sideOffset={6}>
						<PriSelect.Popup>
							<PriSelect.List>
								{options.map(opt => (
									<PriSelect.Item key={opt.value} value={opt.value}>
										<PriSelect.ItemIndicator>
											<Check size={12} />
										</PriSelect.ItemIndicator>
										<PriSelect.ItemText>{opt.label}</PriSelect.ItemText>
									</PriSelect.Item>
								))}
							</PriSelect.List>
						</PriSelect.Popup>
					</PriSelect.Positioner>
				</PriSelect.Portal>
			</PriSelect.Root>
		</Field>
	)
}

export interface EditableChipsProps {
	readonly label: string
	readonly values: ReadonlyArray<string>
	readonly onSave: (next: ReadonlyArray<string>) => Promise<void>
	readonly placeholder?: string
	readonly emptyHint?: ReactNode
}

/**
 * Chip list with inline add/remove. Enter on the input appends; × on a
 * chip removes. Both call `onSave` with the full updated array.
 */
export function EditableChips({
	label,
	values,
	onSave,
	placeholder,
	emptyHint,
}: EditableChipsProps) {
	const { t } = useLingui()
	const [draft, setDraft] = useState('')
	const [pending, setPending] = useState(false)

	const mutate = async (next: ReadonlyArray<string>) => {
		setPending(true)
		try {
			await onSave(next)
		} finally {
			setPending(false)
		}
	}

	const addChip = async () => {
		const next = draft.trim()
		if (next.length === 0) return
		if (values.includes(next)) {
			setDraft('')
			return
		}
		setDraft('')
		await mutate([...values, next])
	}

	const removeChip = (chip: string) => mutate(values.filter(v => v !== chip))

	return (
		<Field>
			<FieldLabel>{label}</FieldLabel>
			<ChipRow>
				{values.length === 0 && emptyHint !== undefined ? (
					<Empty>{emptyHint}</Empty>
				) : (
					values.map(chip => (
						<Chip key={chip}>
							<span>{chip}</span>
							<ChipRemove
								type='button'
								onClick={() => void removeChip(chip)}
								aria-label={t`Remove ${chip}`}
								disabled={pending}
							>
								<X size={10} aria-hidden />
							</ChipRemove>
						</Chip>
					))
				)}
			</ChipRow>
			<PriInput
				type='text'
				value={draft}
				onChange={e => setDraft(e.target.value)}
				onKeyDown={e => {
					if (e.key === 'Enter') {
						e.preventDefault()
						void addChip()
					}
				}}
				onBlur={() => void addChip()}
				placeholder={placeholder ?? t`Type and press Enter`}
				disabled={pending}
				aria-label={t`Add ${label}`}
			/>
		</Field>
	)
}

// ── Styles ────────────────────────────────────────────────────────

const Field = styled.div.withConfig({ displayName: 'EditableFieldShell' })`
	${agedPaperSurface}
	display: flex;
	flex-direction: column;
	gap: var(--space-3xs);
	padding: var(--space-sm) var(--space-md);
	border-bottom-width: 2px;
`

const FieldLabel = styled.span.withConfig({
	displayName: 'EditableFieldLabel',
})`
	${stenciledTitle}
	font-size: var(--typescale-label-small-size);
	color: var(--color-on-surface-variant);
`

const ReadTrigger = styled.button.withConfig({
	displayName: 'EditableFieldReadTrigger',
	shouldForwardProp: prop => prop !== '$multiline',
})<{ $multiline: boolean }>`
	position: relative;
	display: flex;
	align-items: ${p => (p.$multiline ? 'flex-start' : 'center')};
	justify-content: space-between;
	gap: var(--space-sm);
	background: transparent;
	border: 1px dashed transparent;
	border-radius: var(--shape-2xs);
	padding: var(--space-3xs) var(--space-2xs);
	margin: calc(var(--space-3xs) * -1) calc(var(--space-2xs) * -1);
	text-align: left;
	cursor: text;
	color: inherit;
	font: inherit;
	transition:
		border-color 140ms ease,
		background 140ms ease;

	&:hover,
	&:focus-visible {
		border-color: color-mix(in srgb, var(--color-on-surface) 25%, transparent);
		background: color-mix(in srgb, var(--color-paper-fibre-a) 45%, transparent);
		outline: none;
	}
`

const Value = styled.span.withConfig({ displayName: 'EditableFieldValue' })`
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	line-height: var(--typescale-body-medium-line);
	color: var(--color-on-surface);
	overflow-wrap: anywhere;
`

const ValueMultiline = styled.span.withConfig({
	displayName: 'EditableFieldValueMultiline',
})`
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	line-height: var(--typescale-body-medium-line);
	color: var(--color-on-surface);
	white-space: pre-wrap;
	overflow-wrap: anywhere;
`

const Empty = styled.span.withConfig({ displayName: 'EditableFieldEmpty' })`
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	font-style: italic;
	color: var(--color-on-surface-variant);
	opacity: 0.55;
`

const PencilMark = styled.span.withConfig({
	displayName: 'EditableFieldPencilMark',
})`
	flex-shrink: 0;
	display: inline-flex;
	align-items: center;
	color: var(--color-on-surface-variant);
	opacity: 0;
	transition: opacity 140ms ease;

	${ReadTrigger}:hover &,
	${ReadTrigger}:focus-visible & {
		opacity: 0.7;
	}
`

const TextArea = styled.textarea.withConfig({
	displayName: 'EditableFieldTextArea',
})`
	width: 100%;
	padding: var(--space-xs) var(--space-sm);
	background: #f0e8d0;
	color: var(--color-on-surface);
	border: none;
	border-bottom: 2px solid var(--color-outline);
	border-radius: 0;
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	line-height: var(--typescale-body-medium-line);
	letter-spacing: var(--typescale-body-medium-tracking);
	resize: vertical;
	box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.04);
	transition: border-color 160ms ease, background 160ms ease;

	&::placeholder {
		color: var(--color-on-surface-variant);
		opacity: 0.7;
		font-style: italic;
	}

	&:focus,
	&:focus-visible {
		outline: none;
		border-bottom-color: var(--color-primary);
		background: #f5ecd6;
	}

	&:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
`

const SelectTrigger = styled(PriSelect.Trigger).withConfig({
	displayName: 'EditableSelectTrigger',
})`
	justify-content: space-between;
	width: 100%;
	background: transparent;
	border: 1px dashed transparent;
	box-shadow: none;
	text-transform: none;
	letter-spacing: normal;
	font-family: var(--font-body);
	font-weight: var(--font-weight-regular);
	font-size: var(--typescale-body-medium-size);
	text-shadow: none;
	padding: var(--space-3xs) var(--space-2xs);
	margin: calc(var(--space-3xs) * -1) calc(var(--space-2xs) * -1);
	color: var(--color-on-surface);

	&::before {
		display: none;
	}

	&:hover:not(:disabled),
	&:focus-visible {
		border-color: color-mix(in srgb, var(--color-on-surface) 25%, transparent);
		background: color-mix(in srgb, var(--color-paper-fibre-a) 45%, transparent);
		box-shadow: none;
	}
`

const ChipRow = styled.div.withConfig({ displayName: 'EditableChipsRow' })`
	display: flex;
	flex-wrap: wrap;
	gap: var(--space-2xs);
	min-height: calc(var(--typescale-body-medium-size) * 1.4);
`

const Chip = styled.span.withConfig({ displayName: 'EditableChip' })`
	${brushedMetalPlate}
	${stenciledTitle}
	display: inline-flex;
	align-items: center;
	gap: var(--space-3xs);
	padding: var(--space-3xs) var(--space-2xs);
	font-size: var(--typescale-label-small-size);
	line-height: var(--typescale-label-small-line);
`

const ChipRemove = styled.button.withConfig({
	displayName: 'EditableChipRemove',
})`
	display: inline-flex;
	align-items: center;
	justify-content: center;
	padding: 0;
	width: 1rem;
	height: 1rem;
	background: transparent;
	border: none;
	color: var(--color-on-surface-variant);
	cursor: pointer;
	border-radius: 50%;
	transition: color 140ms ease, background 140ms ease;

	&:hover:not(:disabled) {
		color: var(--color-error);
		background: color-mix(in srgb, var(--color-error) 15%, transparent);
	}
`

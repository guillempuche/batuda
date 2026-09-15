import { useAtomSet } from '@effect/atom-react'
import { Trans, useLingui } from '@lingui/react/macro'
import { Check, ChevronsUpDown, X } from 'lucide-react'
import { styled } from 'next-yak'
import { useEffect, useState } from 'react'

import {
	ATTRIBUTE_DESCRIPTION_MAX,
	ATTRIBUTE_KINDS,
	ATTRIBUTE_LABEL_MAX,
	ATTRIBUTE_UNIT_MAX,
	type AttributeKind,
} from '@batuda/domain'
import {
	PriButton,
	PriDialog,
	PriField,
	PriInput,
	PriSelect,
	PriTextarea,
	usePriToast,
} from '@batuda/ui/pri'

import {
	createAttributeAtom,
	updateAttributeAtom,
} from '#/atoms/attribute-atoms'
import { stenciledTitle } from '#/lib/workshop-mixins'
import {
	type AttributeField,
	checkDraft,
	fieldForOutcome,
	formatChoices,
	parseChoices,
} from './attribute-checks'
import { kindLabel, outcomeMessage, SAVE_FAILED } from './attribute-messages'
import { type AttributeDeclaration, isKind } from './attribute-shapes'
import { outcomeOf } from './instruction-shapes'

/**
 * Declaring one fact a campaign records on every company, or editing what was
 * declared.
 *
 * The key is what a value is filed under on the company, so it is written once
 * and then only read: changing it would leave every value already stored under
 * the old name. The kind decides how a value is checked and filtered, which is
 * why choosing "Choice" is what asks for the words it may take.
 *
 * A refusal about one box is shown beside that box; one about the whole write —
 * who may do it, or how the key reads on another stack — is shown in a banner,
 * because no single box is to blame.
 */
export function AttributeDialog({
	open,
	stackId,
	stackName,
	declaration,
	onOpenChange,
	onSaved,
}: {
	readonly open: boolean
	// The campaign a new declaration lands on; null while editing one, which
	// already knows its stack.
	readonly stackId: string | null
	readonly stackName: string | null
	// null = declaring a new attribute rather than editing one.
	readonly declaration: AttributeDeclaration | null
	readonly onOpenChange: (next: boolean) => void
	readonly onSaved: () => void
}) {
	const { t, i18n } = useLingui()
	const toast = usePriToast()
	const createAttribute = useAtomSet(createAttributeAtom, {
		mode: 'promiseExit',
	})
	const updateAttribute = useAtomSet(updateAttributeAtom, {
		mode: 'promiseExit',
	})

	const isCreate = declaration === null
	const [key, setKey] = useState('')
	const [label, setLabel] = useState('')
	const [kind, setKind] = useState<AttributeKind>('text')
	const [choices, setChoices] = useState('')
	const [unit, setUnit] = useState('')
	const [description, setDescription] = useState('')
	const [submitting, setSubmitting] = useState(false)
	// One refusal code at a time, whether this form raised it or the server did.
	const [refusal, setRefusal] = useState<string | null>(null)

	// Re-seed when the dialog opens or moves to another declaration. Keyed on the
	// id rather than the row, so a list refresh in the background cannot wipe
	// what is half typed.
	const targetId = declaration?.id ?? null
	// biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the declaration being opened, not the row object the list rebuilds on every refresh
	useEffect(() => {
		setKey(declaration?.key ?? '')
		setLabel(declaration?.label ?? '')
		setKind(declaration?.kind ?? 'text')
		setChoices(formatChoices(declaration?.enumValues ?? []))
		setUnit(declaration?.unit ?? '')
		setDescription(declaration?.description ?? '')
		setRefusal(null)
		setSubmitting(false)
	}, [targetId, open])

	const enumValues = kind === 'enum' ? parseChoices(choices) : []
	const refusedField = fieldForOutcome(refusal)
	const refusalText =
		refusal === null ? null : i18n._(outcomeMessage(refusal, SAVE_FAILED))
	// A refusal about one box sits beside it; anything else is about the write.
	const bannerText = refusedField === null ? refusalText : null
	const errorFor = (field: AttributeField) =>
		refusedField === field ? refusalText : null

	const save = async () => {
		if (submitting) return
		const problem = checkDraft({
			key: isCreate ? key : null,
			label,
			kind,
			enumValues,
			unit,
			description,
		})
		if (problem !== null) {
			setRefusal(problem)
			return
		}
		setSubmitting(true)
		setRefusal(null)
		const trimmedUnit = unit.trim()
		const trimmedDescription = description.trim()
		const fields = {
			label: label.trim(),
			kind,
			// Explicit null clears what was there: a kind that is no longer a choice
			// must not keep the words it used to allow.
			enum_values: kind === 'enum' ? enumValues : null,
			unit: trimmedUnit === '' ? null : trimmedUnit,
			description: trimmedDescription === '' ? null : trimmedDescription,
		}
		const exit =
			declaration === null
				? await createAttribute({
						payload: { stack_id: stackId ?? '', key: key.trim(), ...fields },
					} as never)
				: await updateAttribute({
						params: { id: declaration.id },
						payload: fields,
					} as never)
		const outcome = outcomeOf(exit)
		setSubmitting(false)
		if (outcome !== 'created' && outcome !== 'updated') {
			// A call that never landed carries no code; it still has to say something,
			// so it falls through to the general "try again".
			setRefusal(outcome ?? 'request_failed')
			return
		}
		toast.add({ title: t`Attribute saved`, type: 'success' })
		onSaved()
		onOpenChange(false)
	}

	return (
		<PriDialog.Root
			open={open}
			onOpenChange={(next: boolean) => {
				if (!next && submitting) return
				onOpenChange(next)
			}}
		>
			<PriDialog.Portal>
				<PriDialog.Backdrop />
				<PriDialog.Popup mobile='sheet' data-testid='attribute-dialog'>
					<Header>
						<PriDialog.Title>
							<Heading>
								{isCreate ? (
									<Trans>New attribute</Trans>
								) : (
									<Trans>Edit attribute</Trans>
								)}
							</Heading>
						</PriDialog.Title>
						<PriDialog.Close
							render={props => (
								<CloseButton type='button' aria-label={t`Close`} {...props}>
									<X size={18} aria-hidden />
								</CloseButton>
							)}
						/>
					</Header>

					<PriDialog.Description
						render={props => (
							<Description {...props}>
								{stackName === null ? (
									<Trans>A fact I record on every company I research.</Trans>
								) : (
									<Trans>
										A fact I record on every company "{stackName}" researches.
									</Trans>
								)}
							</Description>
						)}
					/>

					<Form
						onSubmit={event => {
							event.preventDefault()
							void save()
						}}
					>
						<PriField.Root>
							<PriField.Label htmlFor='attribute-key'>
								<Trans>Key</Trans>
							</PriField.Label>
							<PriInput
								id='attribute-key'
								data-testid='attribute-key'
								value={key}
								disabled={!isCreate}
								placeholder='site_count'
								onChange={event => {
									setKey(event.target.value)
									setRefusal(null)
								}}
							/>
							<PriField.Description>
								{isCreate ? (
									<Trans>
										Lowercase letters, digits and underscores, e.g. site_count.
										It cannot change later.
									</Trans>
								) : (
									<Trans>
										A key stays as it was declared, so the values companies
										already hold keep their name.
									</Trans>
								)}
							</PriField.Description>
							<FieldError text={errorFor('key')} />
						</PriField.Root>

						<PriField.Root>
							<PriField.Label htmlFor='attribute-label'>
								<Trans>Name</Trans>
							</PriField.Label>
							<PriInput
								id='attribute-label'
								data-testid='attribute-label'
								value={label}
								maxLength={ATTRIBUTE_LABEL_MAX}
								placeholder={t`e.g. Number of sites`}
								onChange={event => {
									setLabel(event.target.value)
									setRefusal(null)
								}}
							/>
							<PriField.Description>
								<Trans>What people see on the company page.</Trans>
							</PriField.Description>
							<FieldError text={errorFor('label')} />
						</PriField.Root>

						<PriField.Root>
							<PriField.Label htmlFor='attribute-kind'>
								<Trans>Kind</Trans>
							</PriField.Label>
							<PriSelect.Root
								items={KIND_ITEMS.map(value => ({
									value,
									label: i18n._(kindLabel(value)),
								}))}
								value={kind}
								onValueChange={(next: unknown) => {
									if (isKind(next)) {
										setKind(next)
										setRefusal(null)
									}
								}}
							>
								<PriSelect.Trigger
									id='attribute-kind'
									data-testid='attribute-kind'
								>
									<PriSelect.Value />
									<PriSelect.Icon>
										<ChevronsUpDown size={12} aria-hidden />
									</PriSelect.Icon>
								</PriSelect.Trigger>
								<PriSelect.Portal>
									<PriSelect.Positioner
										alignItemWithTrigger={false}
										sideOffset={6}
									>
										<PriSelect.Popup>
											<PriSelect.List>
												{KIND_ITEMS.map(value => (
													<PriSelect.Item
														key={value}
														value={value}
														data-testid={`attribute-kind-option-${value}`}
													>
														<PriSelect.ItemIndicator>
															<Check size={12} aria-hidden />
														</PriSelect.ItemIndicator>
														<PriSelect.ItemText>
															{i18n._(kindLabel(value))}
														</PriSelect.ItemText>
													</PriSelect.Item>
												))}
											</PriSelect.List>
										</PriSelect.Popup>
									</PriSelect.Positioner>
								</PriSelect.Portal>
							</PriSelect.Root>
							<PriField.Description>
								<Trans>
									How a value is read and filtered. It cannot change once
									companies hold values under this key.
								</Trans>
							</PriField.Description>
							<FieldError text={errorFor('kind')} />
						</PriField.Root>

						{kind === 'enum' ? (
							<PriField.Root>
								<PriField.Label htmlFor='attribute-enum-values'>
									<Trans>Allowed values</Trans>
								</PriField.Label>
								<PriInput
									id='attribute-enum-values'
									data-testid='attribute-enum-values'
									value={choices}
									placeholder={t`e.g. own fleet, hired, both`}
									onChange={event => {
										setChoices(event.target.value)
										setRefusal(null)
									}}
								/>
								<PriField.Description>
									<Trans>
										Separate the words with commas. A value can only be one of
										them.
									</Trans>
								</PriField.Description>
								<FieldError text={errorFor('enumValues')} />
							</PriField.Root>
						) : null}

						<PriField.Root>
							<PriField.Label htmlFor='attribute-unit'>
								<Trans>Unit</Trans>
							</PriField.Label>
							<PriInput
								id='attribute-unit'
								data-testid='attribute-unit'
								value={unit}
								maxLength={ATTRIBUTE_UNIT_MAX}
								placeholder={t`e.g. sites`}
								onChange={event => {
									setUnit(event.target.value)
									setRefusal(null)
								}}
							/>
							<PriField.Description>
								<Trans>
									Optional. Written after a number, like "12 sites".
								</Trans>
							</PriField.Description>
							<FieldError text={errorFor('unit')} />
						</PriField.Root>

						<PriField.Root>
							<PriField.Label htmlFor='attribute-description'>
								<Trans>Note</Trans>
							</PriField.Label>
							<PriTextarea
								id='attribute-description'
								data-testid='attribute-description'
								value={description}
								rows={3}
								maxLength={ATTRIBUTE_DESCRIPTION_MAX}
								aria-describedby='attribute-description-hint'
								placeholder={t`e.g. Premises the company runs, not the ones it sells to.`}
								onChange={event => {
									setDescription(event.target.value)
									setRefusal(null)
								}}
							/>
							<PriField.Description id='attribute-description-hint'>
								<Trans>Read by research runs to know what to look for.</Trans>
							</PriField.Description>
							<FieldError text={errorFor('description')} />
						</PriField.Root>

						{bannerText !== null ? (
							<ErrorBanner role='alert' data-testid='attribute-banner'>
								{bannerText}
							</ErrorBanner>
						) : null}

						<Footer>
							{/* aria-disabled, not disabled: moving a focused button out of the
							    tab order drops the writer at the top of the page, and a refused
							    save would leave them stranded there. `save` ignores the repeat
							    press instead. */}
							<PriButton
								type='submit'
								$variant='filled'
								data-testid='attribute-submit'
								aria-disabled={submitting}
							>
								{submitting ? <Trans>Saving…</Trans> : <Trans>Save</Trans>}
							</PriButton>
							<PriButton
								type='button'
								$variant='text'
								data-testid='attribute-cancel'
								onClick={() => {
									if (!submitting) onOpenChange(false)
								}}
							>
								<Trans>Cancel</Trans>
							</PriButton>
						</Footer>
					</Form>
				</PriDialog.Popup>
			</PriDialog.Portal>
		</PriDialog.Root>
	)
}

// The refusal that belongs beside one box, read in one line wherever a field
// needs it. Nothing to say is nothing rendered.
function FieldError({ text }: { readonly text: string | null }) {
	if (text === null) return null
	return (
		<PriField.Error match={true} data-testid='attribute-error'>
			{text}
		</PriField.Error>
	)
}

const KIND_ITEMS: ReadonlyArray<AttributeKind> = ATTRIBUTE_KINDS

const Header = styled.div`
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	gap: var(--space-sm);
`

const Heading = styled.span`
	${stenciledTitle}
	font-size: var(--typescale-title-large-size);
	line-height: var(--typescale-title-large-line);
`

const Description = styled.p`
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface-variant);
	margin: var(--space-3xs) 0 0;
`

const CloseButton = styled.button`
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 1.75rem;
	height: 1.75rem;
	padding: 0;

	/* Bigger tap target on touch, matching the other dialogs. */
	@media (pointer: coarse) {
		width: 2.75rem;
		height: 2.75rem;
	}
	border: none;
	border-radius: var(--shape-2xs);
	background: transparent;
	color: var(--color-on-surface-variant);
	cursor: pointer;

	&:hover {
		background: color-mix(in oklab, var(--color-on-surface) 12%, transparent);
		color: var(--color-on-surface);
	}

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

	/* On the phone sheet the fields scroll under the pinned actions rather than
	 * pushing them off the screen. */
	@media (max-width: 40rem) {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
	}
`

const ErrorBanner = styled.div`
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	color: var(--color-error);
	padding: var(--space-2xs) var(--space-sm);
	border: 1px solid var(--color-error);
	border-radius: var(--shape-2xs);
`

const Footer = styled.div`
	display: flex;
	align-items: center;
	gap: var(--space-sm);
	justify-content: flex-end;
	margin-top: var(--space-md);

	/* Thumb-friendly full-width actions on the phone sheet, the primary one on
	 * top, pinned above the keyboard while the fields scroll under it. */
	@media (max-width: 40rem) {
		position: sticky;
		bottom: 0;
		flex-direction: column;
		align-items: stretch;
		gap: var(--space-2xs);
		padding-top: var(--space-2xs);
		background: var(--color-paper-aged);
		box-shadow: 0 -0.75rem 0.75rem -0.5rem var(--shadow-color-deep);

		& > * {
			width: 100%;
		}
	}
`

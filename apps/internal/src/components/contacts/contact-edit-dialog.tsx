import { useAtomSet } from '@effect/atom-react'
import { Trans, useLingui } from '@lingui/react/macro'
import { X } from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'
import styled from 'styled-components'

import { PriButton, PriDialog, PriInput, usePriToast } from '@batuda/ui/pri'

import { BatudaApiAtom } from '#/lib/batuda-api-atom'
import { stenciledTitle } from '#/lib/workshop-mixins'

export type EditableContact = {
	readonly id: string
	readonly name: string
	readonly role: string | null
	readonly isDecisionMaker: boolean
}

type Props = {
	readonly open: boolean
	readonly companyId: string
	// The contact being edited, or null to add a new one.
	readonly contact: EditableContact | null
	readonly onClose: () => void
	readonly onSaved: () => void
}

/** Add a new contact or edit an existing one's name, role, and decision-maker flag. */
export function ContactEditDialog({
	open,
	companyId,
	contact,
	onClose,
	onSaved,
}: Props) {
	const { t } = useLingui()
	const toast = usePriToast()
	const createContact = useAtomSet(
		BatudaApiAtom.mutation('contacts', 'create'),
		{
			mode: 'promiseExit',
		},
	)
	const updateContact = useAtomSet(
		BatudaApiAtom.mutation('contacts', 'update'),
		{
			mode: 'promiseExit',
		},
	)

	const [name, setName] = useState('')
	const [role, setRole] = useState('')
	const [isDecisionMaker, setIsDecisionMaker] = useState(false)
	const [busy, setBusy] = useState(false)

	useEffect(() => {
		if (!open) return
		setName(contact?.name ?? '')
		setRole(contact?.role ?? '')
		setIsDecisionMaker(contact?.isDecisionMaker ?? false)
		setBusy(false)
	}, [open, contact])

	const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		const trimmedName = name.trim()
		if (trimmedName.length === 0 || busy) return
		setBusy(true)
		const trimmedRole = role.trim()
		const exit =
			contact === null
				? await createContact({
						payload: {
							companyId,
							name: trimmedName,
							...(trimmedRole ? { role: trimmedRole } : {}),
							isDecisionMaker,
						},
					} as never)
				: await updateContact({
						params: { id: contact.id },
						payload: {
							name: trimmedName,
							role: trimmedRole,
							isDecisionMaker,
						},
					} as never)
		setBusy(false)
		if (exit._tag === 'Success') {
			onSaved()
			onClose()
			return
		}
		toast.add({ title: t`Could not save the contact`, type: 'error' })
	}

	return (
		<PriDialog.Root open={open} onOpenChange={next => !next && onClose()}>
			<PriDialog.Portal>
				<PriDialog.Backdrop />
				<PriDialog.Popup data-testid='contact-edit-dialog'>
					<Header>
						<PriDialog.Title>
							<Heading>
								{contact === null ? (
									<Trans>Add contact</Trans>
								) : (
									<Trans>Edit contact</Trans>
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
					</Header>

					<Form onSubmit={handleSubmit}>
						<Field>
							<Label htmlFor='contact-name'>
								<Trans>Name</Trans>
							</Label>
							<PriInput
								id='contact-name'
								data-testid='contact-name'
								value={name}
								maxLength={200}
								placeholder={t`e.g. Marta Puig`}
								onChange={e => setName(e.target.value)}
								required
							/>
						</Field>
						<Field>
							<Label htmlFor='contact-role'>
								<Trans>Role (optional)</Trans>
							</Label>
							<PriInput
								id='contact-role'
								data-testid='contact-role'
								value={role}
								maxLength={200}
								placeholder={t`e.g. Head of Operations`}
								onChange={e => setRole(e.target.value)}
							/>
						</Field>
						<ToggleLabel>
							<input
								type='checkbox'
								checked={isDecisionMaker}
								data-testid='contact-decision-maker'
								onChange={e => setIsDecisionMaker(e.target.checked)}
							/>
							<Trans>Decision maker</Trans>
						</ToggleLabel>

						<Footer>
							<PriButton
								type='submit'
								$variant='filled'
								data-testid='contact-save'
								disabled={busy || name.trim().length === 0}
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

const Header = styled.div`
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

	&:hover {
		background: color-mix(in oklab, var(--color-on-surface) 12%, transparent);
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

const ToggleLabel = styled.label`
	display: inline-flex;
	align-items: center;
	gap: var(--space-2xs);
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	color: var(--color-on-surface);
	cursor: pointer;
`

const Footer = styled.div`
	display: flex;
	gap: var(--space-sm);
	justify-content: flex-end;
`

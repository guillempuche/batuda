import { useAtomSet } from '@effect/atom-react'
import { Trans, useLingui } from '@lingui/react/macro'
import { DateTime } from 'effect'
import { X } from 'lucide-react'
import { styled } from 'next-yak'
import { type FormEvent, useEffect, useState } from 'react'

import { PriButton, PriDialog, PriInput } from '@batuda/ui/pri'

import { createTaskAtom } from '#/atoms/tasks-atoms'
import { stenciledTitle } from '#/lib/workshop-mixins'

type Props = {
	readonly open: boolean
	readonly companyId: string
	// Set when the follow-up is created from a specific email thread.
	readonly threadLinkId?: string | null
	readonly onClose: () => void
	readonly onSaved: () => void
}

/** Create a follow-up task for a company (optionally tied to an email thread). */
export function FollowupDialog({
	open,
	companyId,
	threadLinkId,
	onClose,
	onSaved,
}: Props) {
	const { t } = useLingui()
	const createTask = useAtomSet(createTaskAtom, { mode: 'promiseExit' })
	const [title, setTitle] = useState('')
	const [dueAt, setDueAt] = useState('')
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		if (!open) return
		setTitle(t`Follow up`)
		setDueAt('')
		setBusy(false)
		setError(null)
	}, [open, t])

	const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		const trimmed = title.trim()
		if (trimmed.length === 0 || busy) return
		setBusy(true)
		setError(null)
		// A date-only pick becomes 9am local time — a due moment at the start of the workday.
		const due = dueAt ? new Date(`${dueAt}T09:00:00`) : null
		const exit = await createTask({
			payload: {
				companyId,
				type: 'followup',
				title: trimmed,
				...(due && !Number.isNaN(due.getTime())
					? { dueAt: DateTime.fromDateUnsafe(due) }
					: {}),
				...(threadLinkId ? { linkedThreadLinkId: threadLinkId } : {}),
			},
		} as never)
		setBusy(false)
		if (exit._tag === 'Success') {
			onSaved()
			onClose()
			return
		}
		setError(t`Could not create the follow-up. Try again.`)
	}

	return (
		<PriDialog.Root open={open} onOpenChange={next => !next && onClose()}>
			<PriDialog.Portal>
				<PriDialog.Backdrop />
				<PriDialog.Popup mobile='sheet' data-testid='followup-dialog'>
					<Header>
						<PriDialog.Title>
							<Heading>
								<Trans>New follow-up</Trans>
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
							<Label htmlFor='followup-title'>
								<Trans>What to follow up on</Trans>
							</Label>
							<PriInput
								id='followup-title'
								data-testid='followup-title'
								value={title}
								maxLength={200}
								onChange={e => setTitle(e.target.value)}
								required
							/>
						</Field>
						<Field>
							<Label htmlFor='followup-due'>
								<Trans>Due date (optional)</Trans>
							</Label>
							<PriInput
								id='followup-due'
								data-testid='followup-due'
								type='date'
								value={dueAt}
								onChange={e => setDueAt(e.target.value)}
							/>
						</Field>
						{error !== null ? (
							<ErrorText role='alert'>{error}</ErrorText>
						) : null}
						<Footer>
							<PriButton
								type='submit'
								$variant='filled'
								data-testid='followup-save'
								disabled={busy || title.trim().length === 0}
							>
								{busy ? (
									<Trans>Creating…</Trans>
								) : (
									<Trans>Create follow-up</Trans>
								)}
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

const ErrorText = styled.p`
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	color: var(--color-error);
	margin: 0;
`

const Footer = styled.div`
	display: flex;
	gap: var(--space-sm);
	justify-content: flex-end;
`

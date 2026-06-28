import { useAtomSet } from '@effect/atom-react'
import { Trans, useLingui } from '@lingui/react/macro'
import { Star, Trash2, X } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import styled from 'styled-components'

import { PriButton, PriDialog, PriInput, usePriToast } from '@batuda/ui/pri'

import { BatudaApiAtom } from '#/lib/batuda-api-atom'
import { agedPaperRow, stenciledTitle } from '#/lib/workshop-mixins'
import type { DisplayChannel } from './display-channels'

// Kinds the picker offers; `kind` is open server-side, these are the common set.
const CHANNEL_KINDS = [
	'email',
	'phone',
	'whatsapp',
	'linkedin',
	'x',
	'instagram',
	'website',
	'bluesky',
] as const

type Props = {
	// `null` keeps the dialog closed; any id opens it for that contact.
	readonly contactId: string | null
	readonly contactName: string
	readonly channels: ReadonlyArray<DisplayChannel>
	readonly onClose: () => void
	readonly onChanged: () => void
}

export function ManageChannelsDialog({
	contactId,
	contactName,
	channels,
	onClose,
	onChanged,
}: Props) {
	const { t } = useLingui()
	const toast = usePriToast()

	const addChannel = useAtomSet(
		BatudaApiAtom.mutation('contacts', 'addChannel'),
		{ mode: 'promiseExit' },
	)
	const updateChannel = useAtomSet(
		BatudaApiAtom.mutation('contacts', 'updateChannel'),
		{ mode: 'promiseExit' },
	)
	const deleteChannel = useAtomSet(
		BatudaApiAtom.mutation('contacts', 'deleteChannel'),
		{ mode: 'promiseExit' },
	)

	const [newKind, setNewKind] = useState<string>('email')
	const [newValue, setNewValue] = useState<string>('')
	const [busy, setBusy] = useState(false)

	const failed = () =>
		toast.add({
			title: t`Could not update channels`,
			description: t`The change didn't go through. Try again.`,
			type: 'error',
		})

	const handleAdd = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		const value = newValue.trim()
		if (!contactId || !value || busy) return
		setBusy(true)
		const exit = await addChannel({
			params: { id: contactId },
			payload: { kind: newKind, value },
		} as never)
		setBusy(false)
		if (exit._tag === 'Success') {
			setNewValue('')
			onChanged()
		} else failed()
	}

	const handleRemove = async (channelId: string) => {
		if (!contactId || busy) return
		setBusy(true)
		const exit = await deleteChannel({
			params: { id: contactId, channelId },
		} as never)
		setBusy(false)
		if (exit._tag === 'Success') onChanged()
		else failed()
	}

	const handleMakePrimary = async (channelId: string) => {
		if (!contactId || busy) return
		setBusy(true)
		const exit = await updateChannel({
			params: { id: contactId, channelId },
			payload: { is_primary: true },
		} as never)
		setBusy(false)
		if (exit._tag === 'Success') onChanged()
		else failed()
	}

	return (
		<PriDialog.Root
			open={contactId !== null}
			onOpenChange={(open: boolean) => {
				if (!open) onClose()
			}}
		>
			<PriDialog.Portal>
				<PriDialog.Backdrop />
				<PriDialog.Popup>
					<Header>
						<PriDialog.Title render={<Title />}>
							<Trans>Channels — {contactName}</Trans>
						</PriDialog.Title>
						<PriDialog.Close
							render={props => (
								<CloseButton type='button' aria-label={t`Close`} {...props}>
									<X size={18} />
								</CloseButton>
							)}
						/>
					</Header>

					{channels.length === 0 ? (
						<Empty>
							<Trans>
								No channels yet. Add the first reachable address below.
							</Trans>
						</Empty>
					) : (
						<ChannelList>
							{channels.map(ch => (
								<ChannelRow key={ch.id}>
									<Kind>{ch.kind}</Kind>
									<Value>{ch.value}</Value>
									{ch.kind === 'email' && (
										<IconButton
											type='button'
											aria-label={t`Make primary`}
											$active={ch.isPrimary}
											disabled={ch.isPrimary || busy}
											onClick={() => handleMakePrimary(ch.id)}
										>
											<Star
												size={14}
												{...(ch.isPrimary ? { fill: 'currentColor' } : {})}
											/>
										</IconButton>
									)}
									<IconButton
										type='button'
										aria-label={t`Remove channel`}
										disabled={busy}
										onClick={() => handleRemove(ch.id)}
									>
										<Trash2 size={14} />
									</IconButton>
								</ChannelRow>
							))}
						</ChannelList>
					)}

					<AddForm onSubmit={handleAdd}>
						<KindSelect
							aria-label={t`Channel kind`}
							value={newKind}
							onChange={e => setNewKind(e.target.value)}
						>
							{CHANNEL_KINDS.map(k => (
								<option key={k} value={k}>
									{k}
								</option>
							))}
						</KindSelect>
						<PriInput
							aria-label={t`Channel value`}
							placeholder={t`name@company.com`}
							value={newValue}
							onChange={e => setNewValue(e.target.value)}
						/>
						<PriButton type='submit' disabled={busy || newValue.trim() === ''}>
							<Trans>Add</Trans>
						</PriButton>
					</AddForm>
				</PriDialog.Popup>
			</PriDialog.Portal>
		</PriDialog.Root>
	)
}

const Header = styled.div`
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--space-sm);
	margin-bottom: var(--space-md);
`

const Title = styled.h2`
	${stenciledTitle}
	font-size: var(--typescale-title-medium-size);
`

const CloseButton = styled.button`
	display: inline-flex;
	padding: var(--space-2xs);
	color: var(--color-on-surface-variant);
	background: transparent;
	border: none;
	cursor: pointer;
`

const Empty = styled.p`
	color: var(--color-on-surface-variant);
	font-size: var(--typescale-body-small-size);
	margin: 0 0 var(--space-md);
`

const ChannelList = styled.ul`
	list-style: none;
	margin: 0 0 var(--space-md);
	padding: 0;
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
`

const ChannelRow = styled.li`
	${agedPaperRow}
	display: flex;
	align-items: center;
	gap: var(--space-xs);
	padding: var(--space-2xs) var(--space-xs);
`

const Kind = styled.span`
	font-size: var(--typescale-label-small-size);
	text-transform: uppercase;
	color: var(--color-on-surface-variant);
	min-width: 4.5rem;
`

const Value = styled.span`
	flex: 1;
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface);
	overflow-wrap: anywhere;
`

const IconButton = styled.button<{ $active?: boolean }>`
	display: inline-flex;
	padding: var(--space-2xs);
	color: ${p =>
		p.$active ? 'var(--color-primary)' : 'var(--color-on-surface-variant)'};
	background: transparent;
	border: none;
	cursor: pointer;

	&:disabled {
		cursor: default;
		opacity: ${p => (p.$active ? 1 : 0.4)};
	}
`

const AddForm = styled.form`
	display: flex;
	gap: var(--space-xs);
	align-items: center;
`

const KindSelect = styled.select`
	padding: var(--space-xs) var(--space-sm);
	background: #f0e8d0;
	color: var(--color-on-surface);
	border: none;
	border-bottom: 2px solid var(--color-outline);
	font-size: var(--typescale-body-small-size);
`

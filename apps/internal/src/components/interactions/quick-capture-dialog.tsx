import { useAtomSet, useAtomValue } from '@effect/atom-react'
import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import { useLingui as useLinguiCore } from '@lingui/react'
import { Trans, useLingui } from '@lingui/react/macro'
import { AsyncResult } from 'effect/unstable/reactivity'
import { X } from 'lucide-react'
import type { FormEvent } from 'react'
import { useEffect, useMemo, useState } from 'react'
import styled from 'styled-components'

import { PriButton, PriDialog, PriInput } from '@engranatge/ui/pri'

import {
	ChannelIcon,
	type InteractionChannel,
} from '#/components/shared/channel-icon'
import { useQuickCapture } from '#/context/quick-capture-context'
import { ForjaApiAtom } from '#/lib/forja-api-atom'

type CompanyOption = {
	readonly id: string
	readonly name: string
}

/**
 * Quick Capture — the global interaction-logging dialog.
 *
 * Rendered once by `<QuickCaptureProvider>` (so there is a single
 * instance in the tree). Reads open-state from context and submits via
 * `ForjaApiAtom.mutation('interactions', 'create')` — the server handler
 * writes the interaction AND updates `company.lastContactedAt` +
 * `nextAction`/`nextActionAt` in the same transaction, so we only need
 * the one mutation call here.
 *
 * Company selection has two paths:
 *   - Pre-filled (via `open({ companyId, companyName })`) → read-only
 *     chip at the top of the dialog, no lookup needed.
 *   - Empty → load all companies once via a module-level atom and render
 *     a native `<select>` so the user can pick. Avoids the complexity of
 *     a debounced autocomplete for the first pass; the company list is
 *     tiny enough (hundreds, not thousands) that a full list is fine.
 */
export function QuickCaptureDialog() {
	const { t } = useLingui()
	const { i18n } = useLinguiCore()
	const { isOpen, prefill, close } = useQuickCapture()

	const createInteraction = useAtomSet(
		ForjaApiAtom.mutation('interactions', 'create'),
		{ mode: 'promiseExit' },
	)

	// Form state — reset on every open via the effect below.
	const [companyId, setCompanyId] = useState<string>('')
	const [contactId, setContactId] = useState<string>('')
	const [channel, setChannel] = useState<InteractionChannel>('phone')
	const [direction, setDirection] = useState<'outbound' | 'inbound'>('outbound')
	const [type, setType] = useState<'call' | 'meeting' | 'email' | 'note'>(
		'call',
	)
	const [subject, setSubject] = useState('')
	const [summary, setSummary] = useState('')
	const [outcome, setOutcome] = useState('')
	const [nextAction, setNextAction] = useState('')
	const [nextActionAt, setNextActionAt] = useState('')
	const [durationMin, setDurationMin] = useState('')
	const [submitting, setSubmitting] = useState(false)
	const [errorMessage, setErrorMessage] = useState<string | null>(null)

	// Load companies for the fallback select (only when the dialog is
	// open and there is no pre-filled company). Using useMemo so the atom
	// identity is stable across renders while the dialog is mounted.
	const companiesAtom = useMemo(
		() =>
			ForjaApiAtom.query('companies', 'list', {
				query: { limit: 500 },
			}),
		[],
	)
	const companiesResult = useAtomValue(companiesAtom)
	const companyOptions = useMemo<ReadonlyArray<CompanyOption>>(() => {
		if (!AsyncResult.isSuccess(companiesResult)) return []
		const rows = companiesResult.value as ReadonlyArray<unknown>
		const result: Array<CompanyOption> = []
		for (const row of rows) {
			if (row && typeof row === 'object') {
				const r = row as Record<string, unknown>
				if (typeof r['id'] === 'string' && typeof r['name'] === 'string') {
					result.push({ id: r['id'], name: r['name'] })
				}
			}
		}
		return result.sort((a, b) => a.name.localeCompare(b.name, 'ca'))
	}, [companiesResult])

	// Reset form whenever the dialog opens. Prefill wins over empty defaults.
	useEffect(() => {
		if (!isOpen) return
		setCompanyId(prefill?.companyId ?? '')
		setContactId(prefill?.contactId ?? '')
		setChannel('phone')
		setDirection('outbound')
		setType('call')
		setSubject('')
		setSummary('')
		setOutcome('')
		setNextAction('')
		setNextActionAt('')
		setDurationMin('')
		setErrorMessage(null)
		setSubmitting(false)
	}, [isOpen, prefill])

	const canSubmit = companyId.length > 0 && !submitting

	const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		if (!canSubmit) return
		setSubmitting(true)
		setErrorMessage(null)

		const payload: Record<string, unknown> = {
			companyId,
			channel,
			direction,
			type,
		}
		if (contactId) payload['contactId'] = contactId
		if (subject) payload['subject'] = subject
		if (summary) payload['summary'] = summary
		if (outcome) payload['outcome'] = outcome
		if (nextAction) payload['nextAction'] = nextAction
		if (nextActionAt) payload['nextActionAt'] = nextActionAt
		if (durationMin) {
			const parsed = Number(durationMin)
			if (Number.isFinite(parsed)) payload['durationMin'] = parsed
		}

		const exit = await createInteraction({ payload } as never)
		if (exit._tag === 'Success') {
			// Fire the caller-supplied post-submit hook *before* close(),
			// so page atoms refresh while the prefill is still on the
			// context (close() clears the dialog state).
			prefill?.onSubmitted?.()
			close()
			return
		}
		const defect = exit.cause
		setErrorMessage(t`Could not log the interaction. Please try again.`)
		// biome-ignore lint/suspicious/noConsole: error logging for dev
		console.error('[forja] interactions.create failed', defect)
		setSubmitting(false)
	}

	const showCompanyPicker = !prefill

	return (
		<PriDialog.Root
			open={isOpen}
			onOpenChange={(nextOpen: boolean) => {
				if (!nextOpen) close()
			}}
		>
			<PriDialog.Portal>
				<PriDialog.Backdrop />
				<PriDialog.Popup>
					<Header>
						<PriDialog.Title>
							<Trans>Log interaction</Trans>
						</PriDialog.Title>
						<PriDialog.Close
							render={props => (
								<CloseButton type='button' aria-label={t`Close`} {...props}>
									<X size={18} />
								</CloseButton>
							)}
						/>
					</Header>
					{prefill && (
						<PrefillChip>
							<span>
								<Trans>Company:</Trans>
							</span>
							<strong>{prefill.companyName}</strong>
						</PrefillChip>
					)}
					<Form onSubmit={handleSubmit}>
						{showCompanyPicker && (
							<Field>
								<Label htmlFor='qc-company'>
									<Trans>Company</Trans>
								</Label>
								<Select
									id='qc-company'
									value={companyId}
									onChange={event => setCompanyId(event.target.value)}
									required
								>
									<option value='' disabled>
										{t`— Select a company —`}
									</option>
									{companyOptions.map(option => (
										<option key={option.id} value={option.id}>
											{option.name}
										</option>
									))}
								</Select>
							</Field>
						)}

						<Row>
							<Field>
								<Label>
									<Trans>Channel</Trans>
								</Label>
								<ChannelPills>
									{(
										[
											'phone',
											'email',
											'visit',
											'linkedin',
											'instagram',
											'whatsapp',
											'event',
											'other',
										] as const
									).map(value => (
										<ChannelPill
											key={value}
											type='button'
											$active={channel === value}
											onClick={() => setChannel(value)}
										>
											<ChannelIcon channel={value} size={14} />
										</ChannelPill>
									))}
								</ChannelPills>
							</Field>
						</Row>

						<Row>
							<Field>
								<Label>
									<Trans>Direction</Trans>
								</Label>
								<Toggle>
									<ToggleButton
										type='button'
										$active={direction === 'outbound'}
										onClick={() => setDirection('outbound')}
									>
										<Trans>Outbound</Trans>
									</ToggleButton>
									<ToggleButton
										type='button'
										$active={direction === 'inbound'}
										onClick={() => setDirection('inbound')}
									>
										<Trans>Inbound</Trans>
									</ToggleButton>
								</Toggle>
							</Field>
							<Field>
								<Label>
									<Trans>Type</Trans>
								</Label>
								<Toggle>
									{(['call', 'meeting', 'email', 'note'] as const).map(
										value => (
											<ToggleButton
												key={value}
												type='button'
												$active={type === value}
												onClick={() => setType(value)}
											>
												{i18n._(typeLabels[value])}
											</ToggleButton>
										),
									)}
								</Toggle>
							</Field>
						</Row>

						<Field>
							<Label htmlFor='qc-subject'>
								<Trans>Subject</Trans>
							</Label>
							<PriInput
								id='qc-subject'
								type='text'
								value={subject}
								onChange={event => setSubject(event.target.value)}
								placeholder={t`Brief summary (optional)`}
							/>
						</Field>

						<Field>
							<Label htmlFor='qc-summary'>
								<Trans>Summary</Trans>
							</Label>
							<Textarea
								id='qc-summary'
								rows={3}
								value={summary}
								onChange={event => setSummary(event.target.value)}
								placeholder={t`What happened?`}
							/>
						</Field>

						<Field>
							<Label htmlFor='qc-outcome'>
								<Trans>Outcome</Trans>
							</Label>
							<Textarea
								id='qc-outcome'
								rows={2}
								value={outcome}
								onChange={event => setOutcome(event.target.value)}
								placeholder={t`Conclusion or commitment (optional)`}
							/>
						</Field>

						<Row>
							<Field>
								<Label htmlFor='qc-next-action'>
									<Trans>Next action</Trans>
								</Label>
								<PriInput
									id='qc-next-action'
									type='text'
									value={nextAction}
									onChange={event => setNextAction(event.target.value)}
									placeholder={t`What needs to happen?`}
								/>
							</Field>
							<Field>
								<Label htmlFor='qc-next-action-at'>
									<Trans>Date</Trans>
								</Label>
								<PriInput
									id='qc-next-action-at'
									type='date'
									value={nextActionAt}
									onChange={event => setNextActionAt(event.target.value)}
								/>
							</Field>
						</Row>

						{(channel === 'phone' || channel === 'visit') && (
							<Field>
								<Label htmlFor='qc-duration'>
									<Trans>Duration (min)</Trans>
								</Label>
								<PriInput
									id='qc-duration'
									type='number'
									min={0}
									value={durationMin}
									onChange={event => setDurationMin(event.target.value)}
								/>
							</Field>
						)}

						{errorMessage && <ErrorText role='alert'>{errorMessage}</ErrorText>}

						<Footer>
							<PriButton
								type='button'
								$variant='text'
								onClick={close}
								disabled={submitting}
							>
								<Trans>Cancel</Trans>
							</PriButton>
							<PriButton type='submit' $variant='filled' disabled={!canSubmit}>
								{submitting ? t`Logging…` : t`Log`}
							</PriButton>
						</Footer>
					</Form>
				</PriDialog.Popup>
			</PriDialog.Portal>
		</PriDialog.Root>
	)
}

const typeLabels: Record<
	'call' | 'meeting' | 'email' | 'note',
	MessageDescriptor
> = {
	call: msg`Call`,
	meeting: msg`Meeting`,
	email: msg`Email`,
	note: msg`Note`,
}

const Header = styled.div.withConfig({ displayName: 'QuickCaptureHeader' })`
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--space-sm);
`

const CloseButton = styled.button.withConfig({
	displayName: 'QuickCaptureClose',
})`
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 2rem;
	height: 2rem;
	padding: 0;
	background: transparent;
	border: none;
	color: var(--color-on-surface-variant);
	border-radius: var(--shape-full);
	cursor: pointer;

	&:hover {
		background: color-mix(in srgb, var(--color-on-surface) 8%, transparent);
		color: var(--color-on-surface);
	}

	&:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 2px;
	}
`

const PrefillChip = styled.div.withConfig({
	displayName: 'QuickCapturePrefillChip',
})`
	display: inline-flex;
	align-items: baseline;
	gap: var(--space-2xs);
	padding: var(--space-2xs) var(--space-sm);
	border-radius: var(--shape-full);
	background: var(--color-surface-container);
	color: var(--color-on-surface-variant);
	font-family: var(--font-body);
	font-size: var(--typescale-label-medium-size);
	align-self: flex-start;

	strong {
		color: var(--color-on-surface);
		font-weight: var(--typescale-title-small-weight);
	}
`

const Form = styled.form.withConfig({ displayName: 'QuickCaptureForm' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-md);
`

const Field = styled.div.withConfig({ displayName: 'QuickCaptureField' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
	flex: 1 1 0;
	min-width: 0;
`

const Row = styled.div.withConfig({ displayName: 'QuickCaptureRow' })`
	display: flex;
	gap: var(--space-md);
	flex-wrap: wrap;
`

const Label = styled.label.withConfig({ displayName: 'QuickCaptureLabel' })`
	font-family: var(--font-body);
	font-size: var(--typescale-label-small-size);
	font-weight: var(--typescale-label-small-weight);
	letter-spacing: var(--typescale-label-small-tracking);
	color: var(--color-on-surface-variant);
	text-transform: uppercase;
`

const Select = styled.select.withConfig({ displayName: 'QuickCaptureSelect' })`
	display: block;
	width: 100%;
	padding: var(--space-2xs) var(--space-sm);
	min-height: 2.25rem;
	border: 1px solid var(--color-outline);
	border-radius: var(--shape-sm);
	background: var(--color-surface);
	color: var(--color-on-surface);
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	line-height: var(--typescale-body-medium-line);

	&:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 1px;
	}
`

const Textarea = styled.textarea.withConfig({
	displayName: 'QuickCaptureTextarea',
})`
	display: block;
	width: 100%;
	padding: var(--space-xs) var(--space-sm);
	border: 1px solid var(--color-outline);
	border-radius: var(--shape-sm);
	background: var(--color-surface);
	color: var(--color-on-surface);
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	line-height: var(--typescale-body-medium-line);
	resize: vertical;
	min-height: 4rem;

	&:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 1px;
	}
`

const ChannelPills = styled.div.withConfig({
	displayName: 'QuickCaptureChannelPills',
})`
	display: flex;
	flex-wrap: wrap;
	gap: var(--space-2xs);
`

const ChannelPill = styled.button.withConfig({
	displayName: 'QuickCaptureChannelPill',
	shouldForwardProp: prop => prop !== '$active',
})<{ $active: boolean }>`
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 2.25rem;
	height: 2.25rem;
	padding: 0;
	border: 1px solid
		${props => (props.$active ? 'var(--color-primary)' : 'var(--color-outline)')};
	background: ${props =>
		props.$active ? 'var(--color-primary)' : 'var(--color-surface)'};
	color: ${props =>
		props.$active
			? 'var(--color-on-primary)'
			: 'var(--color-on-surface-variant)'};
	border-radius: var(--shape-full);
	cursor: pointer;
	transition:
		background 120ms ease,
		color 120ms ease,
		border-color 120ms ease;

	&:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 2px;
	}
`

const Toggle = styled.div.withConfig({ displayName: 'QuickCaptureToggle' })`
	display: inline-flex;
	border: 1px solid var(--color-outline);
	border-radius: var(--shape-full);
	padding: 2px;
	gap: 2px;
	flex-wrap: wrap;
`

const ToggleButton = styled.button.withConfig({
	displayName: 'QuickCaptureToggleButton',
	shouldForwardProp: prop => prop !== '$active',
})<{ $active: boolean }>`
	padding: var(--space-3xs) var(--space-sm);
	border: none;
	border-radius: var(--shape-full);
	background: ${props =>
		props.$active ? 'var(--color-primary)' : 'transparent'};
	color: ${props =>
		props.$active
			? 'var(--color-on-primary)'
			: 'var(--color-on-surface-variant)'};
	font-family: var(--font-body);
	font-size: var(--typescale-label-small-size);
	font-weight: var(--typescale-label-small-weight);
	cursor: pointer;
	transition:
		background 120ms ease,
		color 120ms ease;

	&:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 2px;
	}
`

const ErrorText = styled.p.withConfig({ displayName: 'QuickCaptureError' })`
	margin: 0;
	color: var(--color-error);
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
`

const Footer = styled.div.withConfig({ displayName: 'QuickCaptureFooter' })`
	display: flex;
	justify-content: flex-end;
	gap: var(--space-sm);
	padding-top: var(--space-sm);
	border-top: 1px solid var(--color-outline-variant);
`

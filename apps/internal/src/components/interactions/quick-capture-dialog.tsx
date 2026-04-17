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

import {
	PriButton,
	PriDialog,
	PriInput,
	PriNumberField,
	PriToggleGroup,
	usePriToast,
} from '@engranatge/ui/pri'

import {
	ChannelIcon,
	type InteractionChannel,
} from '#/components/shared/channel-icon'
import { useQuickCapture } from '#/context/quick-capture-context'
import { ForjaApiAtom } from '#/lib/forja-api-atom'
import {
	brushedMetalPlate,
	rulerUnderRule,
	stenciledTitle,
} from '#/lib/workshop-mixins'

type CompanyOption = {
	readonly id: string
	readonly name: string
}

const CHANNELS: ReadonlyArray<InteractionChannel> = [
	'phone',
	'email',
	'visit',
	'linkedin',
	'instagram',
	'whatsapp',
	'event',
	'other',
]

/**
 * Quick Capture — the global interaction-logging dialog.
 *
 * Rendered once by `<QuickCaptureProvider>` (so there is a single
 * instance in the tree). Reads open-state from context and submits via
 * `ForjaApiAtom.mutation('interactions', 'create')` — the server handler
 * writes the interaction AND updates `company.lastContactedAt` +
 * `nextAction`/`nextActionAt` in the same transaction.
 */
export function QuickCaptureDialog() {
	const { t } = useLingui()
	const { i18n } = useLinguiCore()
	const { isOpen, prefill, close } = useQuickCapture()
	const toastManager = usePriToast()

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
	const [durationMin, setDurationMin] = useState<number | null>(null)
	const [submitting, setSubmitting] = useState(false)
	const [errorMessage, setErrorMessage] = useState<string | null>(null)

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
		setDurationMin(null)
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
		if (durationMin !== null && Number.isFinite(durationMin)) {
			payload['durationMin'] = durationMin
		}

		const exit = await createInteraction({ payload } as never)
		if (exit._tag === 'Success') {
			prefill?.onSubmitted?.()
			toastManager.add({
				title: t`Interaction logged`,
				description: t`Stamped into the workshop ledger.`,
				type: 'success',
			})
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
				<PriDialog.Popup data-testid='quick-capture'>
					<Header>
						<PriDialog.Title>
							<Trans>Log interaction</Trans>
						</PriDialog.Title>
						<PriDialog.Close
							render={props => (
								<CloseButton
									type='button'
									aria-label={t`Close`}
									data-testid='quick-capture-close'
									{...props}
								>
									<X size={18} />
								</CloseButton>
							)}
						/>
					</Header>
					{prefill && (
						<PrefillChip>
							<PrefillLabel>
								<Trans>Company</Trans>
							</PrefillLabel>
							<strong>{prefill.companyName}</strong>
						</PrefillChip>
					)}
					<Form onSubmit={handleSubmit} data-testid='quick-capture-form'>
						{showCompanyPicker && (
							<Field>
								<Label htmlFor='qc-company'>
									<Trans>Company</Trans>
								</Label>
								<Select
									id='qc-company'
									data-testid='quick-capture-company'
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

						<Field>
							<Label>
								<Trans>Channel</Trans>
							</Label>
							<PriToggleGroup.Root
								value={[channel]}
								onValueChange={(values: string[]) => {
									const next = values[0]
									if (next) setChannel(next as InteractionChannel)
								}}
							>
								{CHANNELS.map(value => (
									<PriToggleGroup.Item
										key={value}
										value={value}
										aria-label={value}
									>
										<ChannelIcon channel={value} size={14} />
									</PriToggleGroup.Item>
								))}
							</PriToggleGroup.Root>
						</Field>

						<Row>
							<Field>
								<Label>
									<Trans>Direction</Trans>
								</Label>
								<PriToggleGroup.Root
									value={[direction]}
									onValueChange={(values: string[]) => {
										const next = values[0]
										if (next === 'outbound' || next === 'inbound') {
											setDirection(next)
										}
									}}
								>
									<PriToggleGroup.Item value='outbound'>
										<Trans>Outbound</Trans>
									</PriToggleGroup.Item>
									<PriToggleGroup.Item value='inbound'>
										<Trans>Inbound</Trans>
									</PriToggleGroup.Item>
								</PriToggleGroup.Root>
							</Field>
							<Field>
								<Label>
									<Trans>Type</Trans>
								</Label>
								<PriToggleGroup.Root
									value={[type]}
									onValueChange={(values: string[]) => {
										const next = values[0]
										if (
											next === 'call' ||
											next === 'meeting' ||
											next === 'email' ||
											next === 'note'
										) {
											setType(next)
										}
									}}
								>
									{(['call', 'meeting', 'email', 'note'] as const).map(
										value => (
											<PriToggleGroup.Item key={value} value={value}>
												{i18n._(typeLabels[value])}
											</PriToggleGroup.Item>
										),
									)}
								</PriToggleGroup.Root>
							</Field>
						</Row>

						<Field>
							<Label htmlFor='qc-subject'>
								<Trans>Subject</Trans>
							</Label>
							<PriInput
								id='qc-subject'
								data-testid='quick-capture-subject'
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
								data-testid='quick-capture-summary'
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
								<PriNumberField.Root
									min={0}
									value={durationMin}
									onValueChange={next => setDurationMin(next)}
								>
									<PriNumberField.Group>
										<PriNumberField.Decrement>−</PriNumberField.Decrement>
										<PriNumberField.Input id='qc-duration' />
										<PriNumberField.Increment>+</PriNumberField.Increment>
									</PriNumberField.Group>
								</PriNumberField.Root>
							</Field>
						)}

						{errorMessage && <ErrorText role='alert'>{errorMessage}</ErrorText>}

						<Footer>
							<PriButton
								type='button'
								$variant='text'
								data-testid='quick-capture-cancel'
								onClick={close}
								disabled={submitting}
							>
								<Trans>Cancel</Trans>
							</PriButton>
							<PriButton
								type='submit'
								$variant='filled'
								data-testid='quick-capture-submit'
								disabled={!canSubmit}
							>
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
	${brushedMetalPlate}
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 2rem;
	height: 2rem;
	padding: 0;
	color: var(--color-on-surface);
	cursor: pointer;

	&:hover {
		box-shadow: var(--elevation-workshop-md);
	}

	&:active {
		transform: translateY(1px);
	}

	&:focus-visible {
		outline: none;
		box-shadow: var(--glow-active);
	}
`

const PrefillChip = styled.div.withConfig({
	displayName: 'QuickCapturePrefillChip',
})`
	${brushedMetalPlate}
	display: inline-flex;
	align-items: center;
	gap: var(--space-2xs);
	padding: var(--space-2xs) var(--space-sm);
	border-left: 3px solid var(--color-primary);
	color: var(--color-on-surface);
	font-family: var(--font-display);
	align-self: flex-start;
	transform: rotate(-0.5deg);

	strong {
		${stenciledTitle}
		letter-spacing: 0.04em;
	}
`

const PrefillLabel = styled.span.withConfig({
	displayName: 'QuickCapturePrefillLabel',
})`
	font-size: var(--typescale-label-small-size);
	font-weight: var(--font-weight-bold);
	letter-spacing: 0.08em;
	text-transform: uppercase;
	opacity: 0.75;
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
	${stenciledTitle}
	font-size: var(--typescale-label-small-size);
`

const Select = styled.select.withConfig({ displayName: 'QuickCaptureSelect' })`
	display: block;
	width: 100%;
	padding: var(--space-2xs) var(--space-sm);
	min-height: 2.25rem;
	border: none;
	border-bottom: 2px solid var(--color-outline);
	background: var(--color-paper-aged);
	color: var(--color-on-surface);
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	line-height: var(--typescale-body-medium-line);
	border-radius: 0;

	&:focus-visible {
		outline: none;
		border-bottom-color: var(--color-primary);
	}
`

const Textarea = styled.textarea.withConfig({
	displayName: 'QuickCaptureTextarea',
})`
	display: block;
	width: 100%;
	padding: var(--space-xs) var(--space-sm);
	border: none;
	border-bottom: 2px solid var(--color-outline);
	background: var(--color-paper-aged);
	color: var(--color-on-surface);
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	line-height: var(--typescale-body-medium-line);
	resize: vertical;
	min-height: 4rem;
	border-radius: 0;

	&:focus-visible {
		outline: none;
		border-bottom-color: var(--color-primary);
	}

	&::placeholder {
		color: var(--color-on-surface-variant);
		opacity: 0.7;
		font-style: italic;
	}
`

const ErrorText = styled.p.withConfig({ displayName: 'QuickCaptureError' })`
	margin: 0;
	padding: var(--space-2xs) var(--space-sm);
	border-left: 3px solid var(--color-error);
	background: color-mix(in srgb, var(--color-error) 6%, transparent);
	color: var(--color-error);
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	font-style: italic;
`

const Footer = styled.div.withConfig({ displayName: 'QuickCaptureFooter' })`
	${rulerUnderRule}
	display: flex;
	justify-content: flex-end;
	gap: var(--space-sm);
	padding-top: var(--space-sm);
	background-position: left top;
`

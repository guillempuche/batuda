import { Radio } from '@base-ui/react/radio'
import { RadioGroup } from '@base-ui/react/radio-group'
import { useAtomSet } from '@effect/atom-react'
import { Trans, useLingui } from '@lingui/react/macro'
import { X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import styled from 'styled-components'

import type { SchemaName } from '@batuda/research'
import { PriButton, PriDialog, PriTextarea } from '@batuda/ui/pri'

import { createResearchAtom } from '#/atoms/research-atoms'
import { brushedMetalPlate, stenciledTitle } from '#/lib/workshop-mixins'

// Type-only import; adding a schema server-side forces an option here.
type SchemaOption = SchemaName

type SchemaCard = {
	readonly value: SchemaOption
	readonly label: string
	readonly description: string
}

const SCHEMA_CARDS: ReadonlyArray<SchemaCard> = [
	{
		value: 'freeform',
		label: 'Freeform',
		description:
			'Open-ended brief. Pick when the question does not fit a fixed shape — history, market trend, an opinion piece. No structured output.',
	},
	{
		value: 'company_enrichment_v1',
		label: 'Company enrichment',
		description:
			'Fill industry, size, location, contacts, competitors and proposed CRM updates for this company. Pick when you want every field on the company card answered.',
	},
	{
		value: 'competitor_scan_v1',
		label: 'Competitor scan',
		description:
			'Map direct competitors with strengths, weaknesses, and a market-maturity summary. Pick when you need to know who you are up against.',
	},
	{
		value: 'contact_discovery_v1',
		label: 'Contact discovery',
		description:
			'Find decision-makers and operational contacts at this company. Pick when you need names, emails, phones and roles to reach out.',
	},
	{
		value: 'prospect_scan_v1',
		label: 'Prospect scan',
		description:
			'Find similar companies elsewhere with the same pain. Pick when you have closed a deal and want lookalikes.',
	},
]

export function ResearchDialog({
	open,
	onOpenChange,
	companyId,
	onCreated,
}: {
	readonly open: boolean
	readonly onOpenChange: (next: boolean) => void
	readonly companyId: string
	readonly onCreated?: (researchId: string) => void
}) {
	const { t } = useLingui()
	const createResearch = useAtomSet(createResearchAtom, { mode: 'promiseExit' })
	const [query, setQuery] = useState('')
	const [schema, setSchema] = useState<SchemaOption>('freeform')
	const [submitting, setSubmitting] = useState(false)
	const [errorMessage, setErrorMessage] = useState<string | null>(null)

	useEffect(() => {
		if (!open) return
		setQuery('')
		setSchema('freeform')
		setSubmitting(false)
		setErrorMessage(null)
	}, [open])

	const canSubmit = query.trim().length > 0 && !submitting

	// React 19 form action — queues through hydration so a pre-hydration click can't navigate.
	const handleAction = useCallback(async () => {
		if (!canSubmit) return
		setSubmitting(true)
		setErrorMessage(null)

		const exit = await createResearch({
			payload: {
				query: query.trim(),
				schema_name: schema,
				context: {
					subjects: [{ table: 'companies', id: companyId }],
				},
			},
		} as never)

		if (exit._tag === 'Success') {
			const value = exit.value as Record<string, unknown> | null
			const newId = typeof value?.['id'] === 'string' ? value['id'] : null
			if (newId !== null && onCreated) onCreated(newId)
			onOpenChange(false)
			return
		}
		setErrorMessage(t`Could not start the research run. Please try again.`)
		setSubmitting(false)
	}, [
		canSubmit,
		createResearch,
		query,
		schema,
		companyId,
		onCreated,
		onOpenChange,
		t,
	])

	return (
		<PriDialog.Root
			open={open}
			onOpenChange={(next: boolean) => {
				onOpenChange(next)
			}}
		>
			<PriDialog.Portal>
				<PriDialog.Backdrop />
				<PriDialog.Popup data-testid='research-dialog'>
					<Header>
						<PriDialog.Title>
							<Heading>
								<Trans>Run new research</Trans>
							</Heading>
						</PriDialog.Title>
						<PriDialog.Close
							render={props => (
								<CloseButton
									type='button'
									aria-label={t`Close`}
									data-testid='research-dialog-close'
									{...props}
								>
									<X size={18} />
								</CloseButton>
							)}
						/>
					</Header>

					<Form action={handleAction} data-testid='research-dialog-form'>
						<Field>
							<Label htmlFor='research-query'>
								<Trans>Question</Trans>
							</Label>
							<PriTextarea
								id='research-query'
								data-testid='research-dialog-query'
								value={query}
								rows={3}
								placeholder={t`What do you want to find out about this company?`}
								onChange={event => {
									setQuery(event.target.value)
								}}
								required
							/>
						</Field>

						<Field>
							<Label as='div'>
								<Trans>What kind of research?</Trans>
							</Label>
							<SchemaGrid
								value={schema}
								onValueChange={value => {
									if (typeof value === 'string') {
										setSchema(value as SchemaOption)
									}
								}}
								data-testid='research-dialog-schema'
							>
								{SCHEMA_CARDS.map(card => (
									<SchemaCardLabel
										key={card.value}
										data-testid={`research-dialog-schema-${card.value}`}
									>
										<SchemaCardHead>
											<SchemaRadioRoot value={card.value}>
												<SchemaRadioIndicator />
											</SchemaRadioRoot>
											<SchemaCardTitle>{card.label}</SchemaCardTitle>
										</SchemaCardHead>
										<SchemaCardDescription>
											{card.description}
										</SchemaCardDescription>
									</SchemaCardLabel>
								))}
							</SchemaGrid>
						</Field>

						{errorMessage !== null ? (
							<ErrorBanner role='alert'>{errorMessage}</ErrorBanner>
						) : null}

						<Footer>
							<PriButton
								type='submit'
								$variant='filled'
								data-testid='research-dialog-submit'
								disabled={!canSubmit}
							>
								{submitting ? <Trans>Starting…</Trans> : <Trans>Start</Trans>}
							</PriButton>
							<PriDialog.Close
								render={props => (
									<PriButton
										type='button'
										$variant='text'
										data-testid='research-dialog-cancel'
										{...props}
									>
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
	line-height: var(--typescale-title-large-line);
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
		color: var(--color-on-surface);
	}
`

const Form = styled.form`
	display: flex;
	flex-direction: column;
	gap: var(--space-md);
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

const ErrorBanner = styled.div`
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	color: var(--color-error, #c6664b);
	padding: var(--space-2xs) var(--space-sm);
	border: 1px solid var(--color-error, #c6664b);
	border-radius: var(--shape-2xs);
`

const Footer = styled.div`
	display: flex;
	gap: var(--space-sm);
	justify-content: flex-end;
`

const SchemaGrid = styled(RadioGroup)`
	display: grid;
	grid-template-columns: 1fr;
	gap: var(--space-2xs);

	@media (min-width: 32rem) {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}
`

// `<label>` so a click anywhere on the card toggles the embedded
// Radio.Root. Column layout — the radio shares a row with the title
// (head), the description sits below across the full card width.
// Cards stretch to row height via grid `align-items: stretch`.
const SchemaCardLabel = styled.label`
	${brushedMetalPlate}
	position: relative;
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
	padding: var(--space-sm);
	border-radius: var(--shape-2xs);
	border: 1px solid color-mix(in oklab, var(--color-on-surface) 14%, transparent);
	cursor: pointer;
	transition: border-color 140ms ease, box-shadow 140ms ease;

	&:hover {
		border-color: color-mix(in oklab, var(--color-primary) 60%, transparent);
	}

	&:has([data-checked]) {
		border-color: var(--color-primary);
		box-shadow: var(--glow-active);
	}

	&:focus-within {
		box-shadow: var(--glow-active);
	}
`

const SchemaCardHead = styled.div`
	display: flex;
	align-items: center;
	gap: var(--space-xs);
`

const SchemaRadioRoot = styled(Radio.Root)`
	flex: 0 0 auto;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 1.1rem;
	height: 1.1rem;
	border-radius: 50%;
	border: 1px solid color-mix(in oklab, var(--color-on-surface) 32%, transparent);
	background: var(--color-surface);
	cursor: pointer;
	padding: 0;

	&[data-checked] {
		border-color: var(--color-primary);
	}

	&:focus-visible {
		outline: none;
	}
`

const SchemaRadioIndicator = styled(Radio.Indicator)`
	display: block;
	width: 0.55rem;
	height: 0.55rem;
	border-radius: 50%;
	background: var(--color-primary);
	transform: scale(0);
	transition: transform 140ms ease;

	&[data-checked] {
		transform: scale(1);
	}
`

const SchemaCardTitle = styled.span`
	${stenciledTitle}
	font-size: var(--typescale-label-large-size);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	line-height: 1;
`

const SchemaCardDescription = styled.span`
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	line-height: var(--typescale-body-small-line);
	color: var(--color-on-surface);
`

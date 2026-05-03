import { useAtomSet } from '@effect/atom-react'
import { Trans, useLingui } from '@lingui/react/macro'
import { X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import styled from 'styled-components'

import { PriButton, PriDialog, PriInput, PriSelect } from '@batuda/ui/pri'

import { createResearchAtom } from '#/atoms/research-atoms'
import { stenciledTitle } from '#/lib/workshop-mixins'

const SCHEMA_OPTIONS = [
	'freeform',
	'company-enrichment-v1',
	'competitor-scan-v1',
	'contact-discovery-v1',
	'prospect-scan-v1',
] as const

type SchemaOption = (typeof SCHEMA_OPTIONS)[number]

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

	// React 19 form action: queued through hydration so the button click
	// can't race the listener registration. Using onSubmit on its own
	// would let the browser's default submit fire on a pre-hydration
	// click, which navigates the page and closes the dialog mid-test.
	const handleAction = useCallback(async () => {
		if (!canSubmit) return
		setSubmitting(true)
		setErrorMessage(null)

		// `context.subjects` is the schema-correct path; the dialog used
		// to send a top-level `subject` which fails validation server-side
		// and leaves the dialog stuck open.
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
							<PriInput
								id='research-query'
								data-testid='research-dialog-query'
								type='text'
								value={query}
								placeholder={t`What do you want to find out about this company?`}
								onChange={event => {
									setQuery(event.target.value)
								}}
								required
							/>
						</Field>

						<Field>
							<Label htmlFor='research-schema'>
								<Trans>Output schema</Trans>
							</Label>
							<PriSelect.Root
								value={schema}
								onValueChange={(value: string | null) => {
									if (value === null) return
									setSchema(value as SchemaOption)
								}}
							>
								<PriSelect.Trigger
									id='research-schema'
									data-testid='research-dialog-schema'
								>
									<PriSelect.Value />
									<PriSelect.Icon />
								</PriSelect.Trigger>
								<PriSelect.Portal>
									<PriSelect.Positioner>
										<PriSelect.Popup>
											{SCHEMA_OPTIONS.map(option => (
												<PriSelect.Item key={option} value={option}>
													<PriSelect.ItemText>{option}</PriSelect.ItemText>
												</PriSelect.Item>
											))}
										</PriSelect.Popup>
									</PriSelect.Positioner>
								</PriSelect.Portal>
							</PriSelect.Root>
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

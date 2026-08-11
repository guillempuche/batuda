import { Radio } from '@base-ui/react/radio'
import { RadioGroup } from '@base-ui/react/radio-group'
import { useAtomSet, useAtomValue } from '@effect/atom-react'
import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import { Plural, Trans, useLingui } from '@lingui/react/macro'
import { Link } from '@tanstack/react-router'
import { AsyncResult } from 'effect/unstable/reactivity'
import { Check, ChevronsUpDown, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import styled from 'styled-components'

import type { SchemaName } from '@batuda/research'
import {
	PriButton,
	PriDialog,
	PriInput,
	PriSelect,
	PriTextarea,
} from '@batuda/ui/pri'

import {
	instructionStacksAtom,
	instructionTemplatesAtom,
} from '#/atoms/instruction-atoms'
import { createResearchAtom } from '#/atoms/research-atoms'
import { narrowStacks } from '#/components/instructions/instruction-shapes'
import {
	type StackOption,
	StackPicker,
} from '#/components/instructions/stack-picker'
import { STATUS_ORDER, statusLabels } from '#/components/shared/status-badge'
import { formatMoneyCents } from '#/lib/format-money'
import { taggedFailure } from '#/lib/tagged-failure'
import { brushedMetalPlate, stenciledTitle } from '#/lib/workshop-mixins'

// The registry's own names, so a schema retired or renamed server-side fails the
// build here until its card goes too. Adding one does not force a card: an
// option only exists once someone has written what to call it and when to pick
// it, and until then the schema is simply not offered.
type SchemaOption = SchemaName

// `msg` so the labels + descriptions extract into the catalog;
// `i18n._(card.label)` resolves them at render.
type SchemaCard = {
	readonly value: SchemaOption
	readonly label: MessageDescriptor
	readonly description: MessageDescriptor
}

const SCHEMA_CARDS: ReadonlyArray<SchemaCard> = [
	{
		value: 'freeform',
		label: msg`Freeform`,
		description: msg`Open-ended brief. Pick when the question does not fit a fixed shape — history, market trend, an opinion piece. No structured output.`,
	},
	{
		value: 'company_enrichment_v1',
		label: msg`Company enrichment`,
		description: msg`Fill industry, size, location, contacts, competitors and proposed CRM updates for this company. Pick when you want every field on the company card answered.`,
	},
	{
		value: 'competitor_scan_v1',
		label: msg`Competitor scan`,
		description: msg`Map direct competitors with strengths, weaknesses, and a market-maturity summary. Pick when you need to know who you are up against.`,
	},
	{
		value: 'contact_discovery_v1',
		label: msg`Contact discovery`,
		description: msg`Find decision-makers and operational contacts at this company. Pick when you need names, emails, phones and roles to reach out.`,
	},
	{
		value: 'prospect_scan_v1',
		label: msg`Prospect scan`,
		description: msg`Find companies matching a profile — industry, size, location. Pick when you want net-new companies to add as leads.`,
	},
]

// Which card is already chosen when the dialog opens, read the same way the
// server reads a request that names no kind: pinned to a company means the
// question is about that company, pinned to nothing means it is asking for
// companies we do not have yet. The two are kept in step so the same question
// asked here and over the API does not start two different kinds of run — and
// it is one function so opening the dialog and reopening it cannot disagree.
const defaultSchema = (isDiscovery: boolean): SchemaOption =>
	isDiscovery ? 'prospect_scan_v1' : 'company_enrichment_v1'

// Keep free-text inputs to sane lengths so a runaway paste can't be submitted.
const QUERY_MAX_LENGTH = 2000
const FILTER_MAX_LENGTH = 120

// Stages come from the one list the rest of the app shares. Keeping a private
// copy here left out "closed" and "dead", so companies in those stages could
// never be covered by a run at all — and it showed the reader the raw stored
// words rather than their proper names.

export function ResearchDialog({
	open,
	onOpenChange,
	companyId,
	onCreated,
}: {
	readonly open: boolean
	readonly onOpenChange: (next: boolean) => void
	// Omitted for discovery — a subject-less run that finds net-new companies,
	// optionally fanned out across existing ones via the selector filters.
	readonly companyId?: string
	readonly onCreated?: (researchId: string) => void
}) {
	const { i18n, t } = useLingui()
	const isDiscovery = companyId === undefined
	const createResearch = useAtomSet(createResearchAtom, { mode: 'promiseExit' })
	const [query, setQuery] = useState('')
	const [schema, setSchema] = useState<SchemaOption>(defaultSchema(isDiscovery))
	const [submitting, setSubmitting] = useState(false)
	const [errorMessage, setErrorMessage] = useState<string | null>(null)
	const [templateIds, setTemplateIds] = useState<ReadonlyArray<string>>([])
	// '' = the actor's own default stack; otherwise a chosen stack's id.
	const [stackId, setStackId] = useState('')
	// Discovery-only scope fields: hints steer a net-new search, the selector
	// filters fan the run out over existing companies.
	const [location, setLocation] = useState('')
	const [language, setLanguage] = useState<'' | 'ca' | 'es' | 'en'>('')
	const [filterStatus, setFilterStatus] = useState('')
	const [filterIndustry, setFilterIndustry] = useState('')
	const [filterCountry, setFilterCountry] = useState('')
	const [filterTags, setFilterTags] = useState('')
	// Set once a selector fan-out returns needing confirmation, so the footer
	// swaps to a cost prompt instead of starting straight away.
	const [pendingConfirm, setPendingConfirm] = useState<{
		readonly subjectCount: number
		readonly estimatedCostCents: number
	} | null>(null)
	const templatesResult = useAtomValue(instructionTemplatesAtom)
	const templateOptions = useMemo<ReadonlyArray<StackOption>>(
		() =>
			AsyncResult.isSuccess(templatesResult)
				? narrowOptions(templatesResult.value)
				: [],
		[templatesResult],
	)
	// Research runs pick from research stacks; the run's own agent is fixed.
	const stacksResult = useAtomValue(instructionStacksAtom('research'))
	const stackItems = useMemo(() => {
		const stacks = AsyncResult.isSuccess(stacksResult)
			? narrowStacks(stacksResult.value).filter(s => s.agent === 'research')
			: []
		const label = (name: string, isDefault: boolean, mine: boolean) => {
			const scoped = mine ? t`Mine — ${name}` : t`Org — ${name}`
			return isDefault ? t`${scoped} (default)` : scoped
		}
		return [
			{ value: '', label: t`My default` },
			...stacks
				.filter(s => s.scope === 'personal')
				.map(s => ({
					value: s.id,
					label: label(s.name, s.isDefault, true),
				})),
			...stacks
				.filter(s => s.scope === 'org')
				.map(s => ({
					value: s.id,
					label: label(s.name, s.isDefault, false),
				})),
		]
	}, [stacksResult, t])

	useEffect(() => {
		if (!open) return
		setQuery('')
		setSchema(defaultSchema(isDiscovery))
		setSubmitting(false)
		setErrorMessage(null)
		setTemplateIds([])
		setStackId('')
		setLocation('')
		setLanguage('')
		setFilterStatus('')
		setFilterIndustry('')
		setFilterCountry('')
		setFilterTags('')
		setPendingConfirm(null)
	}, [open, isDiscovery])

	const canSubmit = query.trim().length > 0 && !submitting

	const buildContext = useCallback((): Record<string, unknown> | undefined => {
		const context: Record<string, unknown> = {}
		if (companyId !== undefined) {
			context['subjects'] = [{ table: 'companies', id: companyId }]
		}
		if (isDiscovery) {
			const filter: Record<string, unknown> = {}
			if (filterStatus) filter['status'] = filterStatus
			if (filterIndustry.trim()) filter['industry'] = filterIndustry.trim()
			if (filterCountry.trim()) filter['country'] = filterCountry.trim()
			const tags = filterTags
				.split(',')
				.map(s => s.trim())
				.filter(Boolean)
			if (tags.length > 0) filter['tags'] = tags
			if (Object.keys(filter).length > 0) {
				context['selector'] = { table: 'companies', filter }
			}
			const hints: Record<string, unknown> = {}
			if (language) hints['language'] = language
			if (location.trim()) hints['location'] = location.trim()
			if (Object.keys(hints).length > 0) context['hints'] = hints
		}
		return Object.keys(context).length > 0 ? context : undefined
	}, [
		companyId,
		isDiscovery,
		filterStatus,
		filterIndustry,
		filterCountry,
		filterTags,
		language,
		location,
	])

	const submit = useCallback(
		async (confirm: boolean) => {
			setSubmitting(true)
			setErrorMessage(null)
			const context = buildContext()
			const exit = await createResearch({
				payload: {
					query: query.trim(),
					schema_name: schema,
					...(context ? { context } : {}),
					...(stackId ? { stack_id: stackId } : {}),
					...(templateIds.length > 0 ? { template_ids: templateIds } : {}),
					...(confirm ? { confirm: true } : {}),
				},
			})

			if (exit._tag === 'Success') {
				const value = exit.value as Record<string, unknown> | null
				const newId = typeof value?.['id'] === 'string' ? value['id'] : null
				// A reply with no run to open means nothing was queued. Closing here
				// would leave the reader believing their research had started.
				if (newId === null) {
					setErrorMessage(
						t`Could not start the research run. Please try again.`,
					)
					setSubmitting(false)
					return
				}
				if (onCreated) onCreated(newId)
				onOpenChange(false)
				return
			}

			// A selector fan-out the user hasn't confirmed comes back as a 409
			// carrying the scale + estimate; show the cost step instead of a
			// generic error, then resubmit with `confirm` once they approve.
			const confirmErr = taggedFailure(exit.cause, 'ConfirmRequired')
			if (confirmErr && !confirm) {
				setPendingConfirm({
					subjectCount:
						typeof confirmErr['subjectCount'] === 'number'
							? confirmErr['subjectCount']
							: 0,
					estimatedCostCents:
						typeof confirmErr['estimatedCostCents'] === 'number'
							? confirmErr['estimatedCostCents']
							: 0,
				})
				setSubmitting(false)
				return
			}
			const budgetErr = taggedFailure(exit.cause, 'InsufficientBudget')
			// A saved set of instructions that has since been deleted, or belongs to
			// someone else, is refused outright rather than quietly swapped.
			const stackErr = taggedFailure(exit.cause, 'UnknownStack')
			setErrorMessage(
				budgetErr
					? t`Not enough research budget for this run. Raise the budget or narrow the search.`
					: stackErr
						? t`That set of instructions is no longer available. Pick another and try again.`
						: t`Could not start the research run. Please try again.`,
			)
			setSubmitting(false)
		},
		[
			buildContext,
			createResearch,
			query,
			schema,
			stackId,
			templateIds,
			onCreated,
			onOpenChange,
			t,
		],
	)

	// React 19 form action — queues through hydration so a pre-hydration click
	// can't fire early.
	const handleAction = useCallback(async () => {
		if (!canSubmit) return
		await submit(false)
	}, [canSubmit, submit])

	return (
		<PriDialog.Root
			open={open}
			onOpenChange={(next: boolean) => {
				onOpenChange(next)
			}}
		>
			<PriDialog.Portal>
				<PriDialog.Backdrop />
				<PriDialog.Popup mobile='sheet' data-testid='research-dialog'>
					<Header>
						<PriDialog.Title>
							<Heading>
								{isDiscovery ? (
									<Trans>Find companies</Trans>
								) : (
									<Trans>Run new research</Trans>
								)}
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
								{isDiscovery ? (
									<Trans>What are you looking for?</Trans>
								) : (
									<Trans>Question</Trans>
								)}
							</Label>
							<PriTextarea
								id='research-query'
								data-testid='research-dialog-query'
								value={query}
								rows={3}
								maxLength={QUERY_MAX_LENGTH}
								placeholder={
									isDiscovery
										? t`e.g. independent bakeries in Barcelona with 5–20 staff`
										: t`What do you want to find out about this company?`
								}
								onChange={event => {
									setQuery(event.target.value)
								}}
								required
							/>
						</Field>

						<Field>
							<Label as='div' id='research-kind-label'>
								<Trans>What kind of research?</Trans>
							</Label>
							<SchemaGrid
								aria-labelledby='research-kind-label'
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
											<SchemaCardTitle>{i18n._(card.label)}</SchemaCardTitle>
										</SchemaCardHead>
										<SchemaCardDescription>
											{i18n._(card.description)}
										</SchemaCardDescription>
									</SchemaCardLabel>
								))}
							</SchemaGrid>
						</Field>

						{isDiscovery ? (
							<Field>
								<Label as='div'>
									<Trans>Where to look (optional)</Trans>
								</Label>
								<HelpText>
									<Trans>
										Steer a net-new search, or set a status/industry/country/tag
										filter to run across companies you already track.
									</Trans>
								</HelpText>
								<ScopeGrid>
									<ScopeField>
										<ScopeLabel htmlFor='discovery-location'>
											<Trans>Location</Trans>
										</ScopeLabel>
										<PriInput
											id='discovery-location'
											data-testid='discovery-location'
											maxLength={FILTER_MAX_LENGTH}
											value={location}
											placeholder={t`e.g. Catalonia`}
											onChange={e => setLocation(e.target.value)}
										/>
									</ScopeField>
									<ScopeField>
										<ScopeLabel htmlFor='discovery-language'>
											<Trans>Sources language</Trans>
										</ScopeLabel>
										<SelectInput
											id='discovery-language'
											data-testid='discovery-language'
											value={language}
											onChange={e =>
												setLanguage(e.target.value as '' | 'ca' | 'es' | 'en')
											}
										>
											<option value=''>{t`Any`}</option>
											<option value='ca'>{t`Catalan`}</option>
											<option value='es'>{t`Spanish`}</option>
											<option value='en'>{t`English`}</option>
										</SelectInput>
									</ScopeField>
									<ScopeField>
										<ScopeLabel htmlFor='discovery-status'>
											<Trans>Across companies in stage</Trans>
										</ScopeLabel>
										<SelectInput
											id='discovery-status'
											data-testid='discovery-status'
											value={filterStatus}
											onChange={e => setFilterStatus(e.target.value)}
										>
											<option value=''>{t`Find net-new`}</option>
											{STATUS_ORDER.map(stage => (
												<option key={stage} value={stage}>
													{i18n._(statusLabels[stage])}
												</option>
											))}
										</SelectInput>
									</ScopeField>
									<ScopeField>
										<ScopeLabel htmlFor='discovery-industry'>
											<Trans>Industry filter</Trans>
										</ScopeLabel>
										<PriInput
											id='discovery-industry'
											data-testid='discovery-industry'
											maxLength={FILTER_MAX_LENGTH}
											value={filterIndustry}
											placeholder={t`e.g. hospitality`}
											onChange={e => setFilterIndustry(e.target.value)}
										/>
									</ScopeField>
									<ScopeField>
										<ScopeLabel htmlFor='discovery-country'>
											<Trans>Country filter</Trans>
										</ScopeLabel>
										<PriInput
											id='discovery-country'
											data-testid='discovery-country'
											maxLength={FILTER_MAX_LENGTH}
											value={filterCountry}
											placeholder={t`e.g. ES`}
											onChange={e => setFilterCountry(e.target.value)}
										/>
									</ScopeField>
									<ScopeField>
										<ScopeLabel htmlFor='discovery-tags'>
											<Trans>Tags filter (comma-separated)</Trans>
										</ScopeLabel>
										<PriInput
											id='discovery-tags'
											data-testid='discovery-tags'
											maxLength={FILTER_MAX_LENGTH}
											value={filterTags}
											placeholder={t`e.g. vip, warm`}
											onChange={e => setFilterTags(e.target.value)}
										/>
									</ScopeField>
								</ScopeGrid>
							</Field>
						) : null}

						<Field>
							<Label as='div'>
								<Trans>Instructions stack</Trans>
							</Label>
							<HelpText>
								<Trans>Pick a saved stack, or use your default.</Trans>
							</HelpText>
							<PriSelect.Root
								items={stackItems}
								value={stackId}
								onValueChange={value => {
									if (typeof value === 'string') setStackId(value)
								}}
							>
								<PriSelect.Trigger data-testid='research-dialog-stack'>
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
												{stackItems.map(item => (
													<PriSelect.Item key={item.value} value={item.value}>
														<PriSelect.ItemIndicator>
															<Check size={12} aria-hidden />
														</PriSelect.ItemIndicator>
														<PriSelect.ItemText>
															{item.label}
														</PriSelect.ItemText>
													</PriSelect.Item>
												))}
											</PriSelect.List>
										</PriSelect.Popup>
									</PriSelect.Positioner>
								</PriSelect.Portal>
							</PriSelect.Root>
						</Field>

						<Field>
							<Label as='div'>
								<Trans>Extra templates for this run</Trans>
							</Label>
							{templateOptions.length > 0 ? (
								<>
									<HelpText>
										<Trans>Layered after the stack, in order.</Trans>
									</HelpText>
									<StackPicker
										options={templateOptions}
										selectedIds={templateIds}
										onChange={setTemplateIds}
									/>
								</>
							) : (
								<HelpText>
									<Trans>
										Set up reusable{' '}
										<SetupLink to='/settings/profile/templates'>
											instruction templates
										</SetupLink>{' '}
										to guide every run.
									</Trans>
								</HelpText>
							)}
						</Field>

						{errorMessage !== null ? (
							<ErrorBanner role='alert'>{errorMessage}</ErrorBanner>
						) : null}

						{pendingConfirm !== null ? (
							<ConfirmPanel role='alert' data-testid='research-confirm'>
								<ConfirmText>
									<Trans>
										This runs research on {pendingConfirm.subjectCount}{' '}
										companies, up to about{' '}
										{formatMoneyCents(pendingConfirm.estimatedCostCents, {
											locale: i18n.locale,
										})}{' '}
										in paid data. Start the batch?
									</Trans>
								</ConfirmText>
								<Footer>
									<PriButton
										type='button'
										$variant='filled'
										data-testid='research-confirm-start'
										disabled={submitting}
										onClick={() => {
											void submit(true)
										}}
									>
										{submitting ? (
											<Trans>Starting…</Trans>
										) : (
											<Plural
												value={pendingConfirm.subjectCount}
												one='Start # run'
												other='Start # runs'
											/>
										)}
									</PriButton>
									<PriButton
										type='button'
										$variant='text'
										data-testid='research-confirm-back'
										disabled={submitting}
										onClick={() => setPendingConfirm(null)}
									>
										<Trans>Back</Trans>
									</PriButton>
								</Footer>
							</ConfirmPanel>
						) : (
							<Footer>
								<PriButton
									type='submit'
									$variant='filled'
									data-testid='research-dialog-submit'
									disabled={!canSubmit}
								>
									{submitting ? (
										<Trans>Starting…</Trans>
									) : isDiscovery ? (
										<Trans>Find companies</Trans>
									) : (
										<Trans>Start</Trans>
									)}
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
						)}
					</Form>
				</PriDialog.Popup>
			</PriDialog.Portal>
		</PriDialog.Root>
	)
}

function narrowOptions(value: unknown): ReadonlyArray<StackOption> {
	if (!Array.isArray(value)) return []
	const out: Array<StackOption> = []
	for (const row of value) {
		if (!row || typeof row !== 'object') continue
		const r = row as Record<string, unknown>
		const id = typeof r['id'] === 'string' ? r['id'] : null
		const name = typeof r['name'] === 'string' ? r['name'] : null
		if (id === null || name === null) continue
		out.push({
			id,
			name,
			ownerUserId:
				typeof r['ownerUserId'] === 'string' ? r['ownerUserId'] : null,
		})
	}
	return out
}

const HelpText = styled.p`
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface-variant);
	margin: 0;
`

const SetupLink = styled(Link)`
	color: var(--color-primary);
	text-decoration: underline;

	&:focus-visible {
		outline: none;
		box-shadow: var(--glow-active);
		border-radius: var(--shape-2xs);
	}
`

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

const ScopeGrid = styled.div`
	display: grid;
	grid-template-columns: 1fr;
	gap: var(--space-sm);

	@media (min-width: 32rem) {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}
`

const ScopeField = styled.div`
	display: flex;
	flex-direction: column;
	gap: var(--space-3xs);
`

const ScopeLabel = styled.label`
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface-variant);
`

const SelectInput = styled.select`
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	padding: var(--space-2xs) var(--space-xs);
	border-radius: var(--shape-2xs);
	border: 1px solid color-mix(in oklab, var(--color-on-surface) 24%, transparent);
	background: var(--color-surface);
	color: var(--color-on-surface);

	&:focus-visible {
		outline: none;
		box-shadow: var(--glow-active);
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

const ConfirmPanel = styled.div`
	display: flex;
	flex-direction: column;
	gap: var(--space-sm);
	padding: var(--space-sm);
	border: 1px solid var(--color-primary);
	border-radius: var(--shape-2xs);
	background: color-mix(in oklab, var(--color-primary) 8%, transparent);
`

const ConfirmText = styled.p`
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	color: var(--color-on-surface);
	margin: 0;
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

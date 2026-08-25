import { Radio } from '@base-ui/react/radio'
import { RadioGroup } from '@base-ui/react/radio-group'
import { useAtomSet, useAtomValue } from '@effect/atom-react'
import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import { Plural, Trans, useLingui } from '@lingui/react/macro'
import { Link } from '@tanstack/react-router'
import { AsyncResult } from 'effect/unstable/reactivity'
import { Check, ChevronsUpDown, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import styled, { css } from 'styled-components'

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
import {
	narrowStacks,
	narrowTemplates,
} from '#/components/instructions/instruction-shapes'
import {
	type StackOption,
	StackPicker,
} from '#/components/instructions/stack-picker'
import { STATUS_ORDER, statusLabels } from '#/components/shared/status-badge'
import { formatMoneyCents } from '#/lib/format-money'
import { taggedFailure } from '#/lib/tagged-failure'
import { brushedMetalPlate, stenciledTitle } from '#/lib/workshop-mixins'
import { buildResearchContext, researchRequestKey } from './research-request'

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

// '' leaves the sources unrestricted; the rest name one language to read in.
type SourcesLanguage = '' | 'ca' | 'es' | 'en'

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
	const [language, setLanguage] = useState<SourcesLanguage>('')
	const [filterStatus, setFilterStatus] = useState('')
	const [filterIndustry, setFilterIndustry] = useState('')
	const [filterCountry, setFilterCountry] = useState('')
	const [filterTags, setFilterTags] = useState('')
	// Set once a selector fan-out returns needing confirmation, so the footer
	// swaps to a cost prompt instead of starting straight away. `requestKey` is
	// the form as it stood when the price was quoted: a quote only answers for
	// the question it was asked, so editing anything below puts the prompt away
	// rather than letting one run be approved and a bigger one started.
	const [pendingConfirm, setPendingConfirm] = useState<{
		readonly subjectCount: number
		readonly estimatedCostCents: number
		readonly requestKey: string
	} | null>(null)
	const templatesResult = useAtomValue(instructionTemplatesAtom)
	const templateOptions = useMemo<ReadonlyArray<StackOption>>(
		() =>
			AsyncResult.isSuccess(templatesResult)
				? narrowTemplates(templatesResult.value)
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

	// Emptied on the way out rather than on the way in. This component outlives
	// the popup, so whatever was typed last time is still in hand when it opens
	// again — and clearing it then happens a frame too late to stop the old
	// question being painted first.
	useEffect(() => {
		if (open) return
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

	const languageItems = useMemo<ReadonlyArray<SelectItem<SourcesLanguage>>>(
		() => [
			{ value: '', label: t`Any` },
			{ value: 'ca', label: t`Catalan` },
			{ value: 'es', label: t`Spanish` },
			{ value: 'en', label: t`English` },
		],
		[t],
	)

	const stageItems = useMemo<ReadonlyArray<SelectItem<string>>>(
		() => [
			{ value: '', label: t`Find net-new` },
			...STATUS_ORDER.map(stage => ({
				value: stage,
				label: i18n._(statusLabels[stage]),
			})),
		],
		[i18n, t],
	)

	const context = useMemo(
		() =>
			buildResearchContext({
				companyId,
				location,
				language,
				filterStatus,
				filterIndustry,
				filterCountry,
				filterTags,
			}),
		[
			companyId,
			filterStatus,
			filterIndustry,
			filterCountry,
			filterTags,
			language,
			location,
		],
	)

	const requestKey = useMemo(
		() => researchRequestKey({ query, schema, stackId, templateIds, context }),
		[query, schema, stackId, templateIds, context],
	)

	// The prompt stands only while the form still asks what was priced. Anything
	// edited after the quote arrives leaves this null, so the ordinary Start
	// button comes back and the next run is quoted afresh.
	const confirming =
		pendingConfirm !== null && pendingConfirm.requestKey === requestKey
			? pendingConfirm
			: null

	// The button that asked for a price is gone once the prompt takes its place,
	// and the prompt's own buttons go when it is put away, so a keyboard reader
	// would be left standing nowhere at both ends. Focus follows the prompt in
	// and comes back to the button that raised it on the way out.
	//
	// This watches the answer itself, not whether the prompt happens to be
	// showing: editing a field and typing it back would put the prompt up again,
	// and pulling the caret out of the field at that moment is the last thing
	// anybody wants.
	const confirmPanelRef = useRef<HTMLDivElement>(null)
	const startButtonRef = useRef<HTMLButtonElement>(null)
	const promptWasUpRef = useRef(false)
	useEffect(() => {
		// A dialog on its way out returns focus wherever it was opened from, so
		// there is nothing to put right here.
		if (!open) {
			promptWasUpRef.current = false
			return
		}
		if (pendingConfirm !== null) {
			promptWasUpRef.current = true
			confirmPanelRef.current?.focus()
			return
		}
		if (!promptWasUpRef.current) return
		promptWasUpRef.current = false
		startButtonRef.current?.focus()
	}, [open, pendingConfirm])

	const submit = useCallback(
		async (confirm: boolean) => {
			setSubmitting(true)
			setErrorMessage(null)
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
				const reply =
					typeof exit.value === 'object' && exit.value !== null
						? (exit.value as Record<string, unknown>)
						: null
				const newId = typeof reply?.['id'] === 'string' ? reply['id'] : null
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
					requestKey,
				})
				setSubmitting(false)
				return
			}
			// Whatever went wrong, the quote on screen is spent: leaving it up would
			// offer a price the server has just declined to honour.
			setPendingConfirm(null)
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
			context,
			createResearch,
			query,
			schema,
			stackId,
			templateIds,
			requestKey,
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
										<ScopeSelect
											id='discovery-language'
											testId='discovery-language'
											value={language}
											onValueChange={setLanguage}
											items={languageItems}
										/>
									</ScopeField>
									<ScopeField>
										<ScopeLabel htmlFor='discovery-status'>
											<Trans>Across companies in stage</Trans>
										</ScopeLabel>
										<ScopeSelect
											id='discovery-status'
											testId='discovery-status'
											value={filterStatus}
											onValueChange={setFilterStatus}
											items={stageItems}
										/>
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
								<SelectOptions items={stackItems} />
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

						{confirming !== null ? (
							<ConfirmPanel
								ref={confirmPanelRef}
								tabIndex={-1}
								// Deliberately not a dialog role: nothing here traps focus or
								// makes the rest inert, so claiming one would announce a modal
								// the reader can tab straight out of while the real dialog is
								// still open. Focus lands here and the price is named twice —
								// once as this group's name, once on the button that spends
								// the money — so it is heard either way round.
								role='group'
								aria-labelledby='research-confirm-text'
								data-testid='research-confirm'
							>
								<ConfirmText id='research-confirm-text'>
									<Trans>
										This runs research on{' '}
										<Plural
											value={confirming.subjectCount}
											one='# company'
											other='# companies'
										/>
										, up to about{' '}
										{formatMoneyCents(confirming.estimatedCostCents, {
											locale: i18n.locale,
										})}{' '}
										in paid data. Start the batch?
									</Trans>
								</ConfirmText>
								<ConfirmActions>
									<PriButton
										type='button'
										$variant='filled'
										data-testid='research-confirm-start'
										aria-describedby='research-confirm-text'
										disabled={submitting}
										onClick={() => {
											void submit(true)
										}}
									>
										{submitting ? (
											<Trans>Starting…</Trans>
										) : (
											<Plural
												value={confirming.subjectCount}
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
								</ConfirmActions>
							</ConfirmPanel>
						) : (
							<Footer>
								<PriButton
									ref={startButtonRef}
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

// One option in a dropdown: the value that gets stored, and what to call it.
type SelectItem<T extends string> = {
	readonly value: T
	readonly label: string
}

// The list half of a dropdown, shared by every selector in this dialog so the
// options look and behave the same wherever they are opened from.
function SelectOptions<T extends string>({
	items,
}: {
	readonly items: ReadonlyArray<SelectItem<T>>
}) {
	return (
		<PriSelect.Portal>
			<PriSelect.Positioner alignItemWithTrigger={false} sideOffset={6}>
				<PriSelect.Popup>
					<PriSelect.List>
						{items.map(item => (
							<PriSelect.Item key={item.value} value={item.value}>
								<PriSelect.ItemIndicator>
									<Check size={12} aria-hidden />
								</PriSelect.ItemIndicator>
								<PriSelect.ItemText>{item.label}</PriSelect.ItemText>
							</PriSelect.Item>
						))}
					</PriSelect.List>
				</PriSelect.Popup>
			</PriSelect.Positioner>
		</PriSelect.Portal>
	)
}

// A dropdown in the scope grid. The trigger is a button, which a `<label for>`
// may point at, so each field keeps the same label markup as the text fields
// around it. What comes back is matched against the options rather than trusted,
// so the caller is handed one of its own values and needs no cast.
function ScopeSelect<T extends string>({
	id,
	testId,
	value,
	onValueChange,
	items,
}: {
	readonly id: string
	readonly testId: string
	readonly value: T
	readonly onValueChange: (next: T) => void
	readonly items: ReadonlyArray<SelectItem<T>>
}) {
	return (
		<PriSelect.Root
			items={items}
			value={value}
			onValueChange={next => {
				const picked = items.find(item => item.value === next)
				if (picked) onValueChange(picked.value)
			}}
		>
			<ScopeTrigger id={id} data-testid={testId}>
				<ScopeValue />
				<PriSelect.Icon>
					<ChevronsUpDown size={12} aria-hidden />
				</PriSelect.Icon>
			</ScopeTrigger>
			<SelectOptions items={items} />
		</PriSelect.Root>
	)
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

	/* Bigger tap target on touch, matching the other sheet dialogs. */
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
`

const Form = styled.form`
	display: flex;
	flex-direction: column;
	gap: var(--space-md);

	/* The phone sheet is a fixed height and this form is far taller than it, so
	 * the fields scroll here and the actions below them stay put. */
	@media (max-width: 40rem) {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
	}
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

// Columns follow the room there is: fields sit side by side wherever two fit at
// a readable width and drop to one where they don't, with no screen width named
// anywhere. `min()` keeps the single column from overflowing a very narrow
// phone, where 13rem is already wider than the dialog.
const FIELD_MIN_WIDTH = '13rem'

const ScopeGrid = styled.div`
	display: grid;
	grid-template-columns: repeat(
		auto-fit,
		minmax(min(${FIELD_MIN_WIDTH}, 100%), 1fr)
	);
	gap: var(--space-sm);
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

// Sized like the text fields it sits beside in the grid, rather than like the
// compact metal selectors elsewhere, so a row of scope fields lines up.
const ScopeTrigger = styled(PriSelect.Trigger)`
	justify-content: space-between;
	width: 100%;
	min-width: 0;
	padding: var(--space-xs) var(--space-sm);
	font-family: var(--font-body);
	font-size: var(--typescale-body-large-size);
	font-weight: var(--font-weight-regular);
	letter-spacing: var(--typescale-body-large-tracking);
	text-transform: none;
`

// A label longer than the field trails off rather than shouldering the chevron
// out of the trigger.
const ScopeValue = styled(PriSelect.Value)`
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
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

	/* Takes focus when it appears, so it says where the reader has been sent. */
	&:focus-visible {
		outline: none;
		box-shadow: var(--glow-active);
	}

	/* Held at the bottom of the phone sheet the way the ordinary actions are, so
	 * the decision that spends money does not scroll away while the fields above
	 * it are being checked over. The tint goes opaque here — left translucent it
	 * would have the scrolling text sliding through it. */
	@media (max-width: 40rem) {
		position: sticky;
		bottom: 0;
		background: color-mix(
			in oklab,
			var(--color-primary) 8%,
			var(--color-paper-aged)
		);
		box-shadow: 0 -0.75rem 0.75rem -0.5rem var(--shadow-color-deep);
	}
`

const ConfirmText = styled.p`
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	color: var(--color-on-surface);
	margin: 0;
`

// Side by side on a desk, full width and stacked within thumb reach on a phone,
// the button that acts on top.
const actionRow = css`
	display: flex;
	gap: var(--space-sm);
	justify-content: flex-end;

	@media (max-width: 40rem) {
		flex-direction: column;
		align-items: stretch;
		gap: var(--space-2xs);

		& > * {
			width: 100%;
		}
	}
`

// The form's own actions, held at the bottom of the phone sheet while the
// fields scroll behind them. The paper fill and the shadow above it keep that
// scrolling text readable as it passes underneath.
const Footer = styled.div`
	${actionRow}

	@media (max-width: 40rem) {
		position: sticky;
		bottom: 0;
		padding-top: var(--space-2xs);
		background: var(--color-paper-aged);
		box-shadow: 0 -0.75rem 0.75rem -0.5rem var(--shadow-color-deep);
	}
`

// The cost prompt's own actions. Stacked like the form's, but never held to the
// bottom: the prompt is short and already in view, and a paper fill here would
// cut a pale slab across the prompt's tint.
const ConfirmActions = styled.div`
	${actionRow}
`

const SchemaGrid = styled(RadioGroup)`
	display: grid;
	grid-template-columns: repeat(
		auto-fit,
		minmax(min(${FIELD_MIN_WIDTH}, 100%), 1fr)
	);
	gap: var(--space-2xs);
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

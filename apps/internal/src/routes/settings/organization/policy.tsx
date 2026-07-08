import { useAtomRefresh, useAtomSet, useAtomValue } from '@effect/atom-react'
import { Trans, useLingui } from '@lingui/react/macro'
import { createFileRoute, Link } from '@tanstack/react-router'
import { AsyncResult } from 'effect/unstable/reactivity'
import { ArrowLeft, Check, SlidersHorizontal } from 'lucide-react'
import { useEffect, useState } from 'react'
import styled from 'styled-components'

import { PriButton, PriCheckbox, PriInput, usePriToast } from '@batuda/ui/pri'

import {
	researchPolicyAtom,
	updateResearchPolicyAtom,
} from '#/atoms/research-atoms'
import { authClient } from '#/lib/auth-client'
import { centsToEuros, eurosToCents, narrowPolicy } from '#/lib/research-policy'
import {
	brushedMetalPlate,
	rulerUnderRule,
	stenciledTitle,
} from '#/lib/workshop-mixins'

export const Route = createFileRoute('/settings/organization/policy')({
	head: () => ({ meta: [{ title: 'Research budget — Batuda' }] }),
	component: ResearchPolicyPage,
})

const DEFAULT_THRESHOLD = 70

function ResearchPolicyPage() {
	const { t } = useLingui()
	const toast = usePriToast()
	const activeMember = authClient.useActiveMember()
	const myRole = activeMember.data?.role ?? null
	const canManage = myRole === 'owner' || myRole === 'admin'

	const policyResult = useAtomValue(researchPolicyAtom)
	const refreshPolicy = useAtomRefresh(researchPolicyAtom)
	const updatePolicy = useAtomSet(updateResearchPolicyAtom, {
		mode: 'promiseExit',
	})

	const [budget, setBudget] = useState('')
	const [paidBudget, setPaidBudget] = useState('')
	const [autoApprovePaid, setAutoApprovePaid] = useState('')
	const [monthlyCap, setMonthlyCap] = useState('')
	const [autoApplyOn, setAutoApplyOn] = useState(false)
	const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD)
	const [saving, setSaving] = useState(false)

	const loaded = AsyncResult.isSuccess(policyResult)
	const policy = loaded ? narrowPolicy(policyResult.value) : null

	// Seed the form from the saved policy once it loads (and again after a
	// save re-fetches), so the fields show the person's current values.
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-seed only when the fetched policy changes, not on every keystroke.
	useEffect(() => {
		if (policy === null) return
		setBudget(centsToEuros(policy.budgetCents))
		setPaidBudget(centsToEuros(policy.paidBudgetCents))
		setAutoApprovePaid(centsToEuros(policy.autoApprovePaidCents))
		setMonthlyCap(centsToEuros(policy.paidMonthlyCapCents))
		setAutoApplyOn(policy.autoApplyMinConfidence !== null)
		setThreshold(policy.autoApplyMinConfidence ?? DEFAULT_THRESHOLD)
	}, [policyResult])

	if (!canManage) {
		return (
			<Page>
				<Intro>
					<Heading>
						<SlidersHorizontal size={20} aria-hidden />
						<Trans>Research budget</Trans>
					</Heading>
					<Subtitle>
						<Trans>You don't have permission to see this page.</Trans>
					</Subtitle>
				</Intro>
			</Page>
		)
	}

	const handleSubmit = async (event: React.FormEvent) => {
		event.preventDefault()
		const cents = {
			budget: eurosToCents(budget),
			paid: eurosToCents(paidBudget),
			approve: eurosToCents(autoApprovePaid),
			cap: eurosToCents(monthlyCap),
		}
		if (Object.values(cents).some(value => value === null)) {
			toast.add({ title: t`Enter valid amounts before saving.`, type: 'error' })
			return
		}
		setSaving(true)
		const exit = await updatePolicy({
			payload: {
				budget_cents: cents.budget ?? 0,
				paid_budget_cents: cents.paid ?? 0,
				auto_approve_paid_cents: cents.approve ?? 0,
				paid_monthly_cap_cents: cents.cap ?? 0,
				auto_apply_min_confidence: autoApplyOn ? threshold : null,
			},
		})
		setSaving(false)
		if (exit._tag === 'Success') {
			toast.add({ title: t`Research budget saved.`, type: 'success' })
			refreshPolicy()
		} else {
			toast.add({ title: t`Could not save the budget.`, type: 'error' })
		}
	}

	return (
		<Page>
			<BackLink to='/settings/organization'>
				<ArrowLeft size={14} aria-hidden />
				<span>
					<Trans>Back to organization</Trans>
				</span>
			</BackLink>

			<Intro>
				<Heading>
					<SlidersHorizontal size={20} aria-hidden />
					<Trans>Research budget</Trans>
				</Heading>
				<Subtitle>
					<Trans>
						Spend ceilings for research and how confident a finding must be to
						apply on its own.
					</Trans>
				</Subtitle>
			</Intro>

			{loaded ? (
				<Form onSubmit={handleSubmit} data-testid='research-policy-form'>
					<Section>
						<SectionTitle>
							<Trans>Spend ceilings</Trans>
						</SectionTitle>
						<Fields>
							<MoneyField
								label={t`Per-run budget`}
								hint={t`Free research work allowed for one run.`}
								value={budget}
								onChange={setBudget}
								testId='research-policy-budget'
							/>
							<MoneyField
								label={t`Per-run paid budget`}
								hint={t`Paid provider calls allowed within one run.`}
								value={paidBudget}
								onChange={setPaidBudget}
								testId='research-policy-paid-budget'
							/>
							<MoneyField
								label={t`Auto-approve paid calls under`}
								hint={t`Paid calls at or below this run without asking.`}
								value={autoApprovePaid}
								onChange={setAutoApprovePaid}
								testId='research-policy-auto-approve'
							/>
							<MoneyField
								label={t`Monthly paid cap`}
								hint={t`Hard limit on paid research spend each month.`}
								value={monthlyCap}
								onChange={setMonthlyCap}
								testId='research-policy-monthly-cap'
							/>
						</Fields>
					</Section>

					<Section>
						<SectionTitle>
							<Trans>Auto-apply</Trans>
						</SectionTitle>
						<ToggleRow>
							<PriCheckbox.Root
								checked={autoApplyOn}
								onCheckedChange={setAutoApplyOn}
								aria-labelledby='auto-apply-label'
								data-testid='research-policy-auto-apply-toggle'
							>
								<PriCheckbox.Indicator>
									<Check size={14} aria-hidden />
								</PriCheckbox.Indicator>
							</PriCheckbox.Root>
							<ToggleText>
								<ToggleLabel id='auto-apply-label'>
									<Trans>Auto-apply verified findings</Trans>
								</ToggleLabel>
								<Hint>
									<Trans>
										Only machine-verified values apply on their own; free-text
										always waits for review.
									</Trans>
								</Hint>
							</ToggleText>
						</ToggleRow>
						{autoApplyOn ? (
							<ThresholdRow>
								<ThresholdLabel>
									<Trans>Minimum confidence</Trans>
								</ThresholdLabel>
								<input
									type='range'
									min={0}
									max={100}
									value={threshold}
									onChange={event => setThreshold(Number(event.target.value))}
									aria-label={t`Minimum confidence to auto-apply`}
									aria-valuetext={t`${threshold}%`}
									data-testid='research-policy-threshold'
								/>
								<ThresholdValue>{threshold}%</ThresholdValue>
							</ThresholdRow>
						) : null}
					</Section>

					<PriButton
						type='submit'
						$variant='filled'
						disabled={saving}
						data-testid='research-policy-save'
					>
						{saving ? t`Saving…` : t`Save budget`}
					</PriButton>
				</Form>
			) : (
				<Empty>
					<Trans>Loading your research budget…</Trans>
				</Empty>
			)}
		</Page>
	)
}

function MoneyField({
	label,
	hint,
	value,
	onChange,
	testId,
}: {
	readonly label: string
	readonly hint: string
	readonly value: string
	readonly onChange: (next: string) => void
	readonly testId: string
}) {
	return (
		<Field>
			<FieldLabel id={`${testId}-label`}>{label}</FieldLabel>
			<MoneyInputWrap>
				<Currency aria-hidden>€</Currency>
				<PriInput
					type='number'
					min={0}
					step='0.01'
					inputMode='decimal'
					value={value}
					onChange={event => onChange(event.target.value)}
					aria-labelledby={`${testId}-label`}
					aria-describedby={`${testId}-hint`}
					data-testid={testId}
					style={{ paddingLeft: 'calc(var(--space-sm) + 0.6rem)' }}
				/>
			</MoneyInputWrap>
			<FieldHint id={`${testId}-hint`}>{hint}</FieldHint>
		</Field>
	)
}

const Page = styled.div`
	display: flex;
	flex-direction: column;
	gap: var(--space-lg);
`

const BackLink = styled(Link)`
	display: inline-flex;
	gap: var(--space-2xs);
	font-family: var(--font-display);
	font-size: var(--typescale-label-medium-size);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--color-on-surface-variant);
	text-decoration: none;

	&:hover {
		color: var(--color-on-surface);
	}
`

const Intro = styled.div`
	${rulerUnderRule}
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
	padding-bottom: var(--space-xs);
`

const Heading = styled.h2`
	${stenciledTitle}
	display: inline-flex;
	align-items: center;
	gap: var(--space-2xs);
	font-size: var(--typescale-headline-large-size);
	line-height: var(--typescale-headline-large-line);
	margin: 0;
`

const Subtitle = styled.p`
	font-family: var(--font-body);
	font-size: var(--typescale-body-large-size);
	font-style: italic;
	color: var(--color-on-surface-variant);
	margin: 0;
`

const Form = styled.form`
	display: flex;
	flex-direction: column;
	gap: var(--space-lg);
	align-items: flex-start;
`

const Section = styled.section`
	${brushedMetalPlate}
	display: flex;
	flex-direction: column;
	gap: var(--space-md);
	padding: var(--space-md);
	border-radius: var(--shape-2xs);
	width: 100%;
`

const SectionTitle = styled.h3`
	${stenciledTitle}
	font-size: var(--typescale-title-medium-size);
	line-height: var(--typescale-title-medium-line);
	margin: 0;
`

const Fields = styled.div`
	display: grid;
	grid-template-columns: 1fr;
	gap: var(--space-md);

	@media (min-width: 768px) {
		grid-template-columns: 1fr 1fr;
	}
`

const Field = styled.div`
	display: flex;
	flex-direction: column;
	gap: var(--space-3xs);
`

const FieldLabel = styled.span`
	font-family: var(--font-display);
	font-size: var(--typescale-label-medium-size);
	letter-spacing: 0.04em;
	text-transform: uppercase;
	color: var(--color-on-surface);
`

const FieldHint = styled.span`
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface-variant);
`

const MoneyInputWrap = styled.div`
	position: relative;
	display: flex;
	align-items: center;
`

const Currency = styled.span`
	position: absolute;
	left: var(--space-sm);
	color: var(--color-on-surface-variant);
	pointer-events: none;
	z-index: 2;
`

const ToggleRow = styled.div`
	display: flex;
	align-items: flex-start;
	gap: var(--space-sm);
`

const ToggleText = styled.div`
	display: flex;
	flex-direction: column;
	gap: var(--space-3xs);
`

const ToggleLabel = styled.span`
	font-family: var(--font-display);
	font-size: var(--typescale-label-large-size);
	letter-spacing: 0.04em;
	text-transform: uppercase;
	color: var(--color-on-surface);
`

const Hint = styled.span`
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface-variant);
`

const ThresholdRow = styled.div`
	display: flex;
	align-items: center;
	gap: var(--space-sm);

	input[type='range'] {
		flex: 1;
		accent-color: var(--color-primary);
	}
`

const ThresholdLabel = styled.span`
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--color-on-surface-variant);
`

const ThresholdValue = styled.span`
	font-family: var(--font-mono, ui-monospace, SFMono-Regular, monospace);
	font-variant-numeric: tabular-nums;
	min-width: 3ch;
	color: var(--color-on-surface);
`

const Empty = styled.p`
	font-family: var(--font-body);
	font-style: italic;
	color: var(--color-on-surface-variant);
	margin: 0;
`

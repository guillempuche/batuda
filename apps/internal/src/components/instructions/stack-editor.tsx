import { useAtomSet } from '@effect/atom-react'
import { Trans, useLingui } from '@lingui/react/macro'
import { Check } from 'lucide-react'
import { styled } from 'next-yak'
import { useEffect, useState } from 'react'

import { PriButton, PriCheckbox, PriInput, usePriToast } from '@batuda/ui/pri'

import {
	createStackAtom,
	setDefaultStackAtom,
	updateStackAtom,
} from '#/atoms/instruction-atoms'
import { brushedMetalPlate, stenciledTitle } from '#/lib/workshop-mixins'
import {
	outcomeOf,
	type StackComposition,
	type StackShape,
} from './instruction-shapes'
import { type StackOption, StackPicker } from './stack-picker'

// Create or edit one named stack. A master-detail card (not a dialog): the list
// stays visible beside it. A personal stack chooses how it combines with the org
// default (replace / extend); an org stack has no composition. Saving writes the
// stack, sets it as the default when that box is newly ticked, then hands back.
export function StackEditor({
	agent,
	scope,
	stack,
	options,
	orgDefaultTemplateIds,
	hasExistingDefault,
	onDone,
	onRead,
}: {
	readonly agent: string
	readonly scope: 'org' | 'personal'
	// null = create a new stack; set = edit an existing one.
	readonly stack: StackShape | null
	readonly options: ReadonlyArray<StackOption>
	readonly orgDefaultTemplateIds: ReadonlyArray<string>
	// Whether a default already exists for this scope+agent; a first stack
	// pre-ticks the default box so the common case needs no extra click.
	readonly hasExistingDefault: boolean
	readonly onDone: () => void
	// Opening a template for reading from the picker; it layers over this editor
	// rather than replacing it, so a half-written stack survives the detour.
	readonly onRead?: ((id: string) => void) | undefined
}) {
	const { t } = useLingui()
	const toast = usePriToast()
	const createStack = useAtomSet(createStackAtom, { mode: 'promiseExit' })
	const updateStack = useAtomSet(updateStackAtom, { mode: 'promiseExit' })
	const setDefaultStack = useAtomSet(setDefaultStackAtom, {
		mode: 'promiseExit',
	})

	const isCurrentDefault = stack?.isDefault === true
	const [name, setName] = useState(stack?.name ?? '')
	const [mode, setMode] = useState<StackComposition>(
		stack?.composition ?? 'replace',
	)
	const [ids, setIds] = useState<ReadonlyArray<string>>(
		stack?.templateIds ?? [],
	)
	const [makeDefault, setMakeDefault] = useState(
		isCurrentDefault || (stack === null && !hasExistingDefault),
	)
	const [saving, setSaving] = useState(false)

	// Re-seed when the editor retargets another stack (or switches to create).
	useEffect(() => {
		setName(stack?.name ?? '')
		setMode(stack?.composition ?? 'replace')
		setIds(stack?.templateIds ?? [])
		setMakeDefault(
			stack?.isDefault === true || (stack === null && !hasExistingDefault),
		)
	}, [stack, hasExistingDefault])

	// The org default's templates, shown read-only while a personal stack extends
	// it (they resolve first, the stack's own picks after).
	const orgOptions = orgDefaultTemplateIds
		.map(id => options.find(o => o.id === id))
		.filter((o): o is StackOption => o !== undefined)

	const canSave = name.trim().length > 0 && ids.length > 0 && !saving

	const errorForOutcome = (outcome: string | null): string => {
		if (outcome === 'duplicate_name')
			return t`A stack with that name already exists.`
		if (outcome === 'personal_in_org_stack')
			return t`Org stacks can only use org templates.`
		if (outcome === 'forbidden')
			return t`Only an organization admin can change this stack.`
		if (outcome === 'not_found') return t`This stack no longer exists.`
		return t`Couldn't save the stack. Please try again.`
	}

	const save = async () => {
		if (!canSave) return
		setSaving(true)
		const trimmed = name.trim()

		if (stack === null) {
			const exit = await createStack({
				payload: {
					agent,
					scope,
					name: trimmed,
					template_ids: ids,
					...(scope === 'personal' ? { composition: mode } : {}),
					...(makeDefault ? { is_default: true } : {}),
				},
			} as never)
			const outcome = outcomeOf(exit)
			setSaving(false)
			if (outcome !== 'created') {
				toast.add({
					title: t`Couldn't save`,
					description: errorForOutcome(outcome),
					type: 'error',
				})
				return
			}
			toast.add({ title: t`Stack saved`, type: 'success' })
			onDone()
			return
		}

		const exit = await updateStack({
			params: { id: stack.id },
			payload: {
				name: trimmed,
				template_ids: ids,
				...(scope === 'personal' ? { composition: mode } : {}),
			},
		} as never)
		const outcome = outcomeOf(exit)
		if (outcome !== 'updated') {
			setSaving(false)
			toast.add({
				title: t`Couldn't save`,
				description: errorForOutcome(outcome),
				type: 'error',
			})
			return
		}
		// Promote to default only when it isn't already — the box is disabled once
		// it is, so this fires just for a newly-ticked default. The edit itself is
		// already saved, so a rejected promotion is reported on its own rather than
		// swallowed behind a success message.
		if (makeDefault && !isCurrentDefault) {
			const promoted = await setDefaultStack({
				params: { id: stack.id },
			} as never)
			if (outcomeOf(promoted) !== 'set') {
				setSaving(false)
				toast.add({
					title: t`Saved, but not made the default`,
					description: errorForOutcome(outcomeOf(promoted)),
					type: 'error',
				})
				onDone()
				return
			}
		}
		setSaving(false)
		toast.add({ title: t`Stack saved`, type: 'success' })
		onDone()
	}

	return (
		<Card data-testid='stack-editor'>
			<Head>
				<Title>
					{stack === null ? (
						<Trans>New stack</Trans>
					) : (
						<Trans>Edit stack</Trans>
					)}
				</Title>
			</Head>

			<FieldLabel htmlFor='stack-name'>
				<Trans>Name</Trans>
			</FieldLabel>
			<PriInput
				id='stack-name'
				data-testid='stack-name'
				value={name}
				maxLength={120}
				placeholder={t`e.g. Cold outreach`}
				onChange={e => setName(e.target.value)}
			/>

			{scope === 'personal' ? (
				<ModeRow
					role='radiogroup'
					aria-label={t`How this stack uses the org default`}
				>
					<ModeButton
						type='button'
						role='radio'
						aria-checked={mode === 'replace'}
						$selected={mode === 'replace'}
						data-testid='stack-mode-replace'
						onClick={() => setMode('replace')}
					>
						<Trans>Replace the org default</Trans>
					</ModeButton>
					<ModeButton
						type='button'
						role='radio'
						aria-checked={mode === 'extend'}
						$selected={mode === 'extend'}
						data-testid='stack-mode-extend'
						onClick={() => setMode('extend')}
					>
						<Trans>Add to the org default</Trans>
					</ModeButton>
				</ModeRow>
			) : null}

			{scope === 'personal' && mode === 'extend' ? (
				<OrgBlock data-testid='extend-org-block'>
					<OrgBlockLabel>
						<Trans>From your organization, applied first</Trans>
					</OrgBlockLabel>
					{orgOptions.length > 0 ? (
						<OrgList>
							{orgOptions.map(o => (
								<OrgItem key={o.id}>{o.name}</OrgItem>
							))}
						</OrgList>
					) : (
						<Hint>
							<Trans>Your organization has no default yet.</Trans>
						</Hint>
					)}
				</OrgBlock>
			) : null}

			<StackPicker
				options={options}
				selectedIds={ids}
				onChange={setIds}
				onRead={onRead}
			/>
			{ids.length === 0 ? (
				<Hint>
					<Trans>Add at least one template before saving.</Trans>
				</Hint>
			) : null}

			<DefaultRow>
				<PriCheckbox.Root
					checked={makeDefault}
					disabled={isCurrentDefault}
					data-testid='stack-make-default'
					onCheckedChange={(next: boolean) => setMakeDefault(next)}
				>
					<PriCheckbox.Indicator>
						<Check size={12} aria-hidden />
					</PriCheckbox.Indicator>
				</PriCheckbox.Root>
				<DefaultLabel>
					{scope === 'personal' ? (
						<Trans>Make this my default</Trans>
					) : (
						<Trans>Make this the org default</Trans>
					)}
				</DefaultLabel>
			</DefaultRow>

			<Actions>
				<PriButton
					type='button'
					$variant='filled'
					data-testid='stack-save'
					disabled={!canSave}
					onClick={() => {
						void save()
					}}
				>
					{saving ? <Trans>Saving…</Trans> : <Trans>Save stack</Trans>}
				</PriButton>
				<PriButton
					type='button'
					$variant='text'
					data-testid='stack-cancel'
					disabled={saving}
					onClick={onDone}
				>
					<Trans>Cancel</Trans>
				</PriButton>
			</Actions>
		</Card>
	)
}

const Card = styled.section`
	${brushedMetalPlate}
	display: flex;
	flex-direction: column;
	gap: var(--space-sm);
	padding: var(--space-md);
	border-radius: var(--shape-2xs);
`

const Head = styled.div`
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--space-sm);
`

const Title = styled.h3`
	${stenciledTitle}
	font-size: var(--typescale-title-medium-size);
	line-height: var(--typescale-title-medium-line);
	margin: 0;
`

const FieldLabel = styled.label`
	${stenciledTitle}
	font-size: var(--typescale-label-small-size);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--color-on-surface-variant);
`

const Hint = styled.p`
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface-variant);
	margin: 0;
`

const ModeRow = styled.div`
	display: inline-flex;
	align-self: flex-start;
	gap: var(--space-3xs);
	padding: var(--space-3xs);
	border: 1px solid var(--color-metal-edge-muted);
	border-radius: var(--shape-2xs);
`

const ModeButton = styled.button<{ $selected: boolean }>`
	font-family: var(--font-display);
	font-size: var(--typescale-label-medium-size);
	letter-spacing: 0.04em;
	text-transform: uppercase;
	padding: var(--space-2xs) var(--space-sm);
	border: none;
	border-radius: var(--shape-2xs);
	cursor: pointer;
	color: ${p =>
		p.$selected
			? 'var(--color-on-primary)'
			: 'var(--color-on-surface-variant)'};
	background: ${p => (p.$selected ? 'var(--color-primary)' : 'transparent')};

	&:hover:not([aria-checked='true']) {
		background: color-mix(in srgb, var(--color-primary) 10%, transparent);
		color: var(--color-on-surface);
	}

	&:focus-visible {
		outline: none;
		box-shadow: var(--glow-active);
	}
`

const OrgBlock = styled.div`
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
	padding-left: var(--space-sm);
	border-left: 2px solid var(--color-ledger-line-strong);
`

const OrgBlockLabel = styled.span`
	${stenciledTitle}
	font-size: var(--typescale-label-small-size);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--color-on-surface-variant);
`

const OrgList = styled.ul`
	list-style: none;
	margin: 0;
	padding: 0;
	display: flex;
	flex-direction: column;
	gap: var(--space-3xs);
`

const OrgItem = styled.li`
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	color: var(--color-on-surface-variant);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
`

const DefaultRow = styled.div`
	display: flex;
	align-items: center;
	gap: var(--space-2xs);
`

const DefaultLabel = styled.span`
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	color: var(--color-on-surface);
`

const Actions = styled.div`
	display: flex;
	gap: var(--space-sm);
`

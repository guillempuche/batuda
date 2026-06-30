import { useAtomSet } from '@effect/atom-react'
import { Trans, useLingui } from '@lingui/react/macro'
import { useEffect, useState } from 'react'
import styled from 'styled-components'

import { PriButton } from '@batuda/ui/pri'

import { clearUserStackAtom, setUserStackAtom } from '#/atoms/instruction-atoms'
import { brushedMetalPlate, stenciledTitle } from '#/lib/workshop-mixins'
import type { StackComposition } from './instruction-shapes'
import { type StackOption, StackPicker } from './stack-picker'

// Edit the actor's own default instruction stack for an agent. Three states:
// inheriting the org default (no own stack), REPLACING it with their own list,
// or EXTENDING it — their picks layered on the live org default. Saving creates
// or updates their own stack; "use the org default" clears it back to inherit.
export function DefaultStackEditor({
	agent,
	options,
	userStackIds,
	orgStackIds,
	userComposition,
	onSaved,
}: {
	readonly agent: string
	readonly options: ReadonlyArray<StackOption>
	// null = no own stack (inheriting the org default).
	readonly userStackIds: ReadonlyArray<string> | null
	readonly orgStackIds: ReadonlyArray<string> | null
	// The stored composition of the user's own stack, or null when inheriting.
	readonly userComposition: StackComposition | null
	readonly onSaved: () => void
}) {
	const { t } = useLingui()
	const setUserStack = useAtomSet(setUserStackAtom, { mode: 'promiseExit' })
	const clearUserStack = useAtomSet(clearUserStackAtom, { mode: 'promiseExit' })
	const inheriting = userStackIds === null
	const [mode, setMode] = useState<StackComposition>(
		userComposition ?? 'replace',
	)
	const [ids, setIds] = useState<ReadonlyArray<string>>(
		userStackIds ?? orgStackIds ?? [],
	)
	const [saving, setSaving] = useState(false)

	// Re-seed when the fetched stacks change (initial load / after a save).
	useEffect(() => {
		setMode(userComposition ?? 'replace')
		setIds(userStackIds ?? orgStackIds ?? [])
	}, [userStackIds, orgStackIds, userComposition])

	// Switching mode re-seeds the picker: a replace list starts from the org
	// default (so you fork it), an extend list starts empty (you add on top). If
	// the saved stack already matches the chosen mode, keep its picks.
	const switchMode = (next: StackComposition) => {
		setMode(next)
		if (next === 'extend') {
			setIds(userComposition === 'extend' ? (userStackIds ?? []) : [])
		} else {
			setIds(
				userComposition === 'replace'
					? (userStackIds ?? orgStackIds ?? [])
					: (orgStackIds ?? []),
			)
		}
	}

	const save = async () => {
		setSaving(true)
		await setUserStack({
			params: { agent },
			payload: { template_ids: ids, composition: mode },
		} as never)
		setSaving(false)
		onSaved()
	}

	const revert = async () => {
		setSaving(true)
		await clearUserStack({ params: { agent } } as never)
		setSaving(false)
		onSaved()
	}

	// The org default's templates, for the read-only block shown while extending.
	const orgOptions = (orgStackIds ?? [])
		.map(id => options.find(o => o.id === id))
		.filter((o): o is StackOption => o !== undefined)

	return (
		<Card data-testid='default-stack-editor'>
			<Head>
				<Title>
					<Trans>Your default</Trans>
				</Title>
				<Badge>
					{inheriting ? (
						<Trans>Using the org default</Trans>
					) : mode === 'extend' ? (
						<Trans>Extending the org default</Trans>
					) : (
						<Trans>Your own</Trans>
					)}
				</Badge>
			</Head>
			<Hint>
				<Trans>
					These templates shape every run, in order — unless you pick different
					ones for a single run.
				</Trans>
			</Hint>

			<ModeRow
				role='radiogroup'
				aria-label={t`How your default uses the org default`}
			>
				<ModeButton
					type='button'
					role='radio'
					aria-checked={mode === 'replace'}
					$selected={mode === 'replace'}
					data-testid='stack-mode-replace'
					onClick={() => switchMode('replace')}
				>
					<Trans>Replace the org default</Trans>
				</ModeButton>
				<ModeButton
					type='button'
					role='radio'
					aria-checked={mode === 'extend'}
					$selected={mode === 'extend'}
					data-testid='stack-mode-extend'
					onClick={() => switchMode('extend')}
				>
					<Trans>Add to the org default</Trans>
				</ModeButton>
			</ModeRow>

			{mode === 'extend' ? (
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

			<StackPicker options={options} selectedIds={ids} onChange={setIds} />

			{inheriting && mode === 'replace' ? (
				<ForkHint>
					<Trans>
						These come from your organization. Saving keeps your own copy, so
						your runs stop following later changes to the org default.
					</Trans>
				</ForkHint>
			) : null}
			{ids.length === 0 ? (
				<ForkHint>
					{mode === 'extend' ? (
						<Trans>
							Add at least one template to layer on the org default.
						</Trans>
					) : (
						<Trans>Add at least one template before saving a default.</Trans>
					)}
				</ForkHint>
			) : null}

			<Actions>
				<PriButton
					type='button'
					$variant='filled'
					data-testid='default-stack-save'
					disabled={saving || ids.length === 0}
					onClick={() => {
						void save()
					}}
				>
					{mode === 'extend' ? (
						<Trans>Save my additions</Trans>
					) : (
						<Trans>Save as my default</Trans>
					)}
				</PriButton>
				{inheriting ? null : (
					<PriButton
						type='button'
						$variant='text'
						disabled={saving}
						onClick={() => {
							void revert()
						}}
					>
						<Trans>Use the org default</Trans>
					</PriButton>
				)}
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

const Badge = styled.span`
	font-family: var(--font-display);
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
	border: 1px solid rgba(0, 0, 0, 0.18);
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

const ForkHint = styled.p`
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	font-style: italic;
	color: var(--color-on-surface-variant);
	margin: 0;
	padding-left: var(--space-sm);
	border-left: 2px solid var(--color-ledger-line-strong);
`

const Actions = styled.div`
	display: flex;
	gap: var(--space-sm);
`

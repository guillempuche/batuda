import { useAtomSet } from '@effect/atom-react'
import { Trans } from '@lingui/react/macro'
import { useEffect, useState } from 'react'
import styled from 'styled-components'

import { PriButton } from '@batuda/ui/pri'

import { clearUserStackAtom, setUserStackAtom } from '#/atoms/instruction-atoms'
import { brushedMetalPlate, stenciledTitle } from '#/lib/workshop-mixins'
import { type StackOption, StackPicker } from './stack-picker'

// Edit the actor's own default instruction stack for an agent. With no own
// stack the actor inherits the org default; saving creates their own, and
// "use the org default" clears it again.
export function DefaultStackEditor({
	agent,
	options,
	userStackIds,
	orgStackIds,
	onSaved,
}: {
	readonly agent: string
	readonly options: ReadonlyArray<StackOption>
	// null = no own stack (inheriting the org default).
	readonly userStackIds: ReadonlyArray<string> | null
	readonly orgStackIds: ReadonlyArray<string> | null
	readonly onSaved: () => void
}) {
	const setUserStack = useAtomSet(setUserStackAtom, { mode: 'promiseExit' })
	const clearUserStack = useAtomSet(clearUserStackAtom, { mode: 'promiseExit' })
	const inheriting = userStackIds === null
	const [ids, setIds] = useState<ReadonlyArray<string>>(
		userStackIds ?? orgStackIds ?? [],
	)
	const [saving, setSaving] = useState(false)

	// Re-seed when the fetched stacks change (initial load / after a save).
	useEffect(() => {
		setIds(userStackIds ?? orgStackIds ?? [])
	}, [userStackIds, orgStackIds])

	const save = async () => {
		setSaving(true)
		await setUserStack({
			params: { agent },
			payload: { template_ids: ids },
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

	return (
		<Card data-testid='default-stack-editor'>
			<Head>
				<Title>
					<Trans>Your research default</Trans>
				</Title>
				<Badge>
					{inheriting ? (
						<Trans>Using the org default</Trans>
					) : (
						<Trans>Your own</Trans>
					)}
				</Badge>
			</Head>
			<Hint>
				<Trans>
					These templates shape every research run, in order — unless you pick
					different ones for a single run.
				</Trans>
			</Hint>
			<StackPicker options={options} selectedIds={ids} onChange={setIds} />
			{inheriting ? (
				<ForkHint>
					<Trans>
						These come from your organization. Saving keeps your own copy, so
						your runs stop following later changes to the org default.
					</Trans>
				</ForkHint>
			) : null}
			{ids.length === 0 ? (
				<ForkHint>
					<Trans>Add at least one template before saving a default.</Trans>
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
					<Trans>Save as my default</Trans>
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

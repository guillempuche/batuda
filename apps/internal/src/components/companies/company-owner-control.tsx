import { useAtomSet } from '@effect/atom-react'
import { useLingui } from '@lingui/react/macro'
import { Check, ChevronsUpDown, UserCircle2 } from 'lucide-react'
import { styled } from 'next-yak'
import { useCallback } from 'react'

import { PriAvatar, PriSelect, usePriToast } from '@batuda/ui/pri'

import { BatudaApiAtom } from '#/lib/batuda-api-atom'
import { initialFor, useOrgMembers } from '#/lib/org-members'

const UNASSIGNED = '__unassigned__'

/**
 * Compact owner picker for a company — assign to me, to any teammate, or release
 * (unassign). Backed by the org member directory and the `companies.update`
 * mutation. Renders the current owner's initial + name (or "Unassigned"); an
 * orphaned owner id that no longer resolves to a member shows a neutral
 * "former member" placeholder rather than a blank.
 */
export function CompanyOwnerControl({
	companyId,
	ownerId,
	onChanged,
}: {
	readonly companyId: string
	readonly ownerId: string | null
	readonly onChanged?: () => void
}) {
	const { t } = useLingui()
	const toast = usePriToast()
	const { members, byUserId, meUserId } = useOrgMembers()
	const updateCompany = useAtomSet(
		BatudaApiAtom.mutation('companies', 'update'),
		{
			mode: 'promiseExit',
		},
	)

	const owner = byUserId(ownerId)
	const currentValue = ownerId ?? UNASSIGNED

	const assign = useCallback(
		async (nextOwnerId: string | null) => {
			const exit = await updateCompany({
				params: { id: companyId },
				payload: { ownerId: nextOwnerId },
			} as never)
			if (exit._tag === 'Success') {
				onChanged?.()
				return
			}
			toast.add({ title: t`Could not change owner`, type: 'error' })
		},
		[updateCompany, companyId, onChanged, toast, t],
	)

	// Order: me first (as "Assign to me"), then the other members, then Unassign.
	const options: ReadonlyArray<{ value: string; label: string }> = [
		...(meUserId ? [{ value: meUserId, label: t`Assign to me` }] : []),
		...members
			.filter(m => m.userId !== meUserId)
			.map(m => ({ value: m.userId, label: m.name })),
		{ value: UNASSIGNED, label: t`Unassign` },
	]

	const triggerLabel = owner
		? owner.name
		: ownerId
			? t`Former member`
			: t`Unassigned`
	const triggerInitial = owner ? initialFor(owner.name) : null

	return (
		<PriSelect.Root
			items={options}
			value={currentValue}
			onValueChange={v => {
				if (typeof v !== 'string') return
				void assign(v === UNASSIGNED ? null : v)
			}}
		>
			<OwnerTrigger
				data-testid={`company-owner-${companyId}`}
				aria-label={t`Owner`}
			>
				{triggerInitial ? (
					<PriAvatar.Root $size='1.25rem' aria-hidden>
						<PriAvatar.Fallback>{triggerInitial}</PriAvatar.Fallback>
					</PriAvatar.Root>
				) : (
					<UserCircle2 size={16} aria-hidden />
				)}
				<OwnerName>{triggerLabel}</OwnerName>
				<ChevronsUpDown size={13} aria-hidden />
			</OwnerTrigger>
			<PriSelect.Portal>
				<PriSelect.Positioner sideOffset={6}>
					<PriSelect.Popup>
						{options.map(opt => (
							<PriSelect.Item
								key={opt.value}
								value={opt.value}
								data-testid={`company-owner-${companyId}-option-${opt.value}`}
							>
								<PriSelect.ItemIndicator>
									<Check size={12} aria-hidden />
								</PriSelect.ItemIndicator>
								<PriSelect.ItemText>{opt.label}</PriSelect.ItemText>
							</PriSelect.Item>
						))}
					</PriSelect.Popup>
				</PriSelect.Positioner>
			</PriSelect.Portal>
		</PriSelect.Root>
	)
}

const OwnerTrigger = styled(PriSelect.Trigger)`
	gap: var(--space-3xs);
	padding: var(--space-3xs) var(--space-2xs);
	font-size: var(--typescale-label-small-size);
	text-transform: none;
	letter-spacing: 0;
`

const OwnerName = styled.span`
	max-width: 8rem;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
`

import { useLingui } from '@lingui/react/macro'
import { useNavigate, useRouter } from '@tanstack/react-router'
import { Building2, Check, ChevronsUpDown } from 'lucide-react'
import { useState } from 'react'
import styled from 'styled-components'

import { PriPopover } from '@batuda/ui/pri'

import { authClient } from '#/lib/auth-client'
import { brushedMetalPlate, stenciledTitle } from '#/lib/workshop-mixins'

/**
 * TopBar dropdown that lists every org the signed-in user belongs to.
 * Clicking an option calls Better Auth's `setActive` mutation; the active
 * org cookie + the session row's activeOrganizationId both update, then
 * we invalidate the router cache so org-scoped loaders refetch under the
 * new GUC.
 *
 * Single-org users see a read-only chip showing the org name (no chooser).
 *
 * Aesthetic match — sheet-metal trigger styled like the TopBar's stenciled
 * title, dropdown popup uses the brushed-metal plate. Same Pri primitives
 * and workshop mixins as Profile + Inboxes pages.
 */
export function OrgSwitcher() {
	const { t } = useLingui()
	const router = useRouter()
	const navigate = useNavigate()
	const [open, setOpen] = useState(false)
	const [pending, setPending] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const list = authClient.useListOrganizations()
	const active = authClient.useActiveOrganization()

	const memberships = list.data ?? []
	const activeOrg = active.data
	const isMultiOrg = memberships.length > 1

	const handleSelect = async (organizationId: string) => {
		if (organizationId === activeOrg?.id) {
			setOpen(false)
			return
		}
		setPending(true)
		setError(null)
		try {
			const result = await authClient.organization.setActive({
				organizationId,
			})
			if (result.error) {
				setError(t`Could not switch organization. Please try again.`)
				return
			}
			setOpen(false)
			// Drop every loader's cache so the next render re-fetches under
			// the new active-org cookie. Navigate to / so deep org-scoped
			// pages don't 404 if the new org doesn't have the equivalent
			// row (e.g. /companies/<slug> only valid in the previous org).
			await router.invalidate()
			await navigate({ to: '/' })
		} catch {
			setError(t`No connection to the server. Try again in a few seconds.`)
		} finally {
			setPending(false)
		}
	}

	const activeName = activeOrg?.name ?? t`No active organization`

	if (!isMultiOrg) {
		// Single-org user: render a read-only chip rather than a dropdown.
		// The label still carries data-testid='active-org-name' so e2e
		// tests don't have to branch on multi-vs-single.
		return (
			<ReadOnlyChip
				data-testid='org-switcher'
				aria-label={t`Active organization`}
			>
				<Building2 size={14} aria-hidden />
				<ActiveLabel data-testid='active-org-name'>{activeName}</ActiveLabel>
			</ReadOnlyChip>
		)
	}

	return (
		<PriPopover.Root open={open} onOpenChange={setOpen}>
			<PriPopover.Trigger
				render={props => (
					<TriggerButton
						type='button'
						data-testid='org-switcher'
						aria-label={t`Switch organization`}
						disabled={pending}
						{...props}
					>
						<Building2 size={14} aria-hidden />
						<ActiveLabel data-testid='active-org-name'>
							{activeName}
						</ActiveLabel>
						<ChevronsUpDown size={12} aria-hidden />
					</TriggerButton>
				)}
			/>
			<PriPopover.Portal>
				<PriPopover.Positioner>
					<PriPopover.Popup>
						<MenuList role='listbox' aria-label={t`Organizations`}>
							{memberships.map(org => {
								const isActive = org.id === activeOrg?.id
								return (
									<MenuItem
										key={org.id}
										type='button'
										role='option'
										aria-selected={isActive}
										data-testid={`org-switcher-option-${org.slug}`}
										onClick={() => {
											void handleSelect(org.id)
										}}
										disabled={pending}
									>
										<MenuItemLabel>{org.name}</MenuItemLabel>
										{isActive ? <Check size={14} aria-hidden /> : null}
									</MenuItem>
								)
							})}
						</MenuList>
						{error ? <ErrorText role='alert'>{error}</ErrorText> : null}
					</PriPopover.Popup>
				</PriPopover.Positioner>
			</PriPopover.Portal>
		</PriPopover.Root>
	)
}

const TriggerButton = styled.button.withConfig({
	displayName: 'OrgSwitcherTrigger',
})`
	${brushedMetalPlate}
	display: inline-flex;
	align-items: center;
	gap: var(--space-2xs);
	padding: var(--space-2xs) var(--space-sm);
	border: 1px solid rgba(0, 0, 0, 0.18);
	border-radius: var(--shape-2xs);
	color: var(--color-on-surface);
	cursor: pointer;
	transition: border-color 160ms ease, box-shadow 160ms ease;

	&:hover:not(:disabled) {
		border-color: var(--color-primary);
	}

	&:focus-visible {
		outline: none;
		box-shadow: var(--glow-active);
	}

	&:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
`

const ReadOnlyChip = styled.div.withConfig({
	displayName: 'OrgSwitcherChip',
})`
	${brushedMetalPlate}
	display: inline-flex;
	align-items: center;
	gap: var(--space-2xs);
	padding: var(--space-2xs) var(--space-sm);
	border: 1px solid rgba(0, 0, 0, 0.18);
	border-radius: var(--shape-2xs);
	color: var(--color-on-surface);
`

const ActiveLabel = styled.span.withConfig({
	displayName: 'OrgSwitcherActiveLabel',
})`
	${stenciledTitle}
	font-size: var(--typescale-label-medium-size);
	line-height: var(--typescale-label-medium-line);
	letter-spacing: 0.04em;
	text-transform: uppercase;
	max-width: 12rem;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
`

const MenuList = styled.ul.withConfig({
	displayName: 'OrgSwitcherMenuList',
})`
	display: flex;
	flex-direction: column;
	min-width: 14rem;
	margin: 0;
	padding: var(--space-2xs);
	list-style: none;
`

const MenuItem = styled.button.withConfig({
	displayName: 'OrgSwitcherMenuItem',
})`
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--space-sm);
	padding: var(--space-2xs) var(--space-sm);
	border: none;
	border-radius: var(--shape-3xs);
	background: transparent;
	color: var(--color-on-surface);
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	line-height: var(--typescale-body-medium-line);
	cursor: pointer;
	text-align: left;

	&:hover:not(:disabled) {
		background: color-mix(in srgb, var(--color-primary) 8%, transparent);
	}

	&[aria-selected='true'] {
		background: color-mix(in srgb, var(--color-primary) 14%, transparent);
		font-weight: var(--font-weight-bold);
	}

	&:focus-visible {
		outline: none;
		box-shadow: var(--glow-active);
	}

	&:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
`

const MenuItemLabel = styled.span.withConfig({
	displayName: 'OrgSwitcherMenuItemLabel',
})`
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
`

const ErrorText = styled.p.withConfig({
	displayName: 'OrgSwitcherError',
})`
	margin: var(--space-2xs) var(--space-sm) 0;
	padding: var(--space-2xs) 0 0;
	border-top: 1px solid color-mix(in srgb, var(--color-error) 30%, transparent);
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	line-height: var(--typescale-body-small-line);
	font-style: italic;
	color: var(--color-error);
`

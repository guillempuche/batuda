import { Trans, useLingui } from '@lingui/react/macro'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Building2, UserPlus, Users, Wallet } from 'lucide-react'
import styled from 'styled-components'

import { authClient } from '#/lib/auth-client'
import {
	brushedMetalPlate,
	rulerUnderRule,
	stenciledTitle,
} from '#/lib/workshop-mixins'

/**
 * Active-organization landing page. Shows the org's display name + slug,
 * plus a link to the members list. Future Slice 5 wires the Invite CTA
 * here when the invitation flow lands.
 *
 * Aesthetic matches the Profile page: brushed-metal card, stenciled
 * heading, ruler-underline intro. Uses the Better Auth `organizationClient`
 * `useActiveOrganization` atom rather than a custom loader so the data
 * stays in sync with the org-switcher in the TopBar without a manual
 * router invalidation.
 */

export const Route = createFileRoute('/settings/organization/')({
	head: () => ({ meta: [{ title: 'Organization — Batuda' }] }),
	component: OrganizationSettingsPage,
})

function OrganizationSettingsPage() {
	const { t } = useLingui()
	const active = authClient.useActiveOrganization()
	const activeMember = authClient.useActiveMember()
	const org = active.data
	const myRole = activeMember.data?.role ?? null
	const canInvite = myRole === 'owner' || myRole === 'admin'

	return (
		<Page>
			<Intro>
				<Heading>
					<Trans>Organization</Trans>
				</Heading>
				<Subtitle>
					<Trans>The workspace your CRM data lives in.</Trans>
				</Subtitle>
			</Intro>

			{active.isPending && !org ? (
				<Card>
					<Subtitle>
						<Trans>Loading…</Trans>
					</Subtitle>
				</Card>
			) : !org ? (
				<Card>
					<Subtitle>
						<Trans>
							No active organization. Pick one from the switcher in the top bar.
						</Trans>
					</Subtitle>
				</Card>
			) : (
				<>
					<Card data-testid='settings-org-card'>
						<IconPlate>
							<Building2 size={28} aria-hidden />
						</IconPlate>
						<Info>
							<Name data-testid='settings-org-name'>{org.name}</Name>
							<MetaRow>
								<MetaLabel>
									<Trans>Slug</Trans>
								</MetaLabel>
								<SlugText>{org.slug}</SlugText>
							</MetaRow>
						</Info>
					</Card>

					<NavRow
						to='/settings/organization/members'
						data-testid='settings-org-members-link'
						aria-label={t`Manage members`}
					>
						<NavRowLabel>
							<Users size={18} aria-hidden />
							<NavRowTitle>
								<Trans>Members</Trans>
							</NavRowTitle>
						</NavRowLabel>
						<NavRowDescription>
							<Trans>See who can access this workspace.</Trans>
						</NavRowDescription>
					</NavRow>

					{canInvite ? (
						<NavRow
							to='/settings/organization/invite'
							data-testid='settings-org-invite-link'
							aria-label={t`Invite a new member`}
						>
							<NavRowLabel>
								<UserPlus size={18} aria-hidden />
								<NavRowTitle>
									<Trans>Invite</Trans>
								</NavRowTitle>
							</NavRowLabel>
							<NavRowDescription>
								<Trans>Send a one-click sign-in link to a teammate.</Trans>
							</NavRowDescription>
						</NavRow>
					) : null}

					{canInvite ? (
						<NavRow
							to='/settings/organization/spend'
							data-testid='settings-org-spend-link'
							aria-label={t`Open the org spend dashboard`}
						>
							<NavRowLabel>
								<Wallet size={18} aria-hidden />
								<NavRowTitle>
									<Trans>Spend</Trans>
								</NavRowTitle>
							</NavRowLabel>
							<NavRowDescription>
								<Trans>Paid research API calls billed to this org.</Trans>
							</NavRowDescription>
						</NavRow>
					) : null}
				</>
			)}
		</Page>
	)
}

const Page = styled.div.withConfig({
	displayName: 'OrganizationSettingsPage',
})`
	display: flex;
	flex-direction: column;
	gap: var(--space-lg);
`

const Intro = styled.div.withConfig({
	displayName: 'OrganizationSettingsIntro',
})`
	${rulerUnderRule}
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
	padding-bottom: var(--space-xs);
`

const Heading = styled.h2.withConfig({
	displayName: 'OrganizationSettingsHeading',
})`
	${stenciledTitle}
	font-size: var(--typescale-headline-large-size);
	line-height: var(--typescale-headline-large-line);
	margin: 0;
`

const Subtitle = styled.p.withConfig({
	displayName: 'OrganizationSettingsSubtitle',
})`
	font-family: var(--font-body);
	font-size: var(--typescale-body-large-size);
	line-height: var(--typescale-body-large-line);
	font-style: italic;
	color: var(--color-on-surface-variant);
	margin: 0;
`

const Card = styled.div.withConfig({
	displayName: 'OrganizationSettingsCard',
})`
	${brushedMetalPlate}
	display: flex;
	align-items: center;
	gap: var(--space-md);
	padding: var(--space-md);
	border-radius: var(--shape-2xs);
`

const IconPlate = styled.div.withConfig({
	displayName: 'OrganizationSettingsIconPlate',
})`
	width: 56px;
	height: 56px;
	border-radius: var(--shape-2xs);
	background: radial-gradient(
		circle at 35% 30%,
		color-mix(in oklab, var(--color-primary) 88%, white) 0%,
		var(--color-primary) 55%,
		color-mix(in oklab, var(--color-primary) 68%, black) 100%
	);
	border: 2px solid color-mix(in oklab, var(--color-primary) 60%, black);
	box-shadow:
		inset 0 2px 4px rgba(255, 255, 255, 0.35),
		inset 0 -2px 4px rgba(0, 0, 0, 0.2),
		0 2px 6px rgba(0, 0, 0, 0.25);
	display: flex;
	align-items: center;
	justify-content: center;
	color: var(--color-on-primary);
	flex-shrink: 0;
`

const Info = styled.div.withConfig({
	displayName: 'OrganizationSettingsInfo',
})`
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
	min-width: 0;
`

const Name = styled.p.withConfig({
	displayName: 'OrganizationSettingsName',
})`
	${stenciledTitle}
	font-size: var(--typescale-title-large-size);
	line-height: var(--typescale-title-large-line);
	margin: 0;
	overflow: hidden;
	text-overflow: ellipsis;
`

const MetaRow = styled.p.withConfig({
	displayName: 'OrganizationSettingsMetaRow',
})`
	display: inline-flex;
	align-items: baseline;
	gap: var(--space-2xs);
	margin: 0;
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	line-height: var(--typescale-body-small-line);
	color: var(--color-on-surface-variant);
`

const MetaLabel = styled.span.withConfig({
	displayName: 'OrganizationSettingsMetaLabel',
})`
	${stenciledTitle}
	font-size: var(--typescale-label-small-size);
	letter-spacing: 0.06em;
	text-transform: uppercase;
`

const SlugText = styled.span.withConfig({
	displayName: 'OrganizationSettingsSlugText',
})`
	font-family: var(--font-mono, ui-monospace, SFMono-Regular, monospace);
`

const NavRow = styled(Link).withConfig({
	displayName: 'OrganizationSettingsNavRow',
})`
	${brushedMetalPlate}
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
	padding: var(--space-md);
	border-radius: var(--shape-2xs);
	color: var(--color-on-surface);
	text-decoration: none;
	transition: border-color 160ms ease, box-shadow 160ms ease;
	border: 1px solid rgba(0, 0, 0, 0.18);

	&:hover {
		border-color: var(--color-primary);
		box-shadow: var(--shadow-paper-inset);
	}

	&:focus-visible {
		outline: none;
		box-shadow: var(--glow-active);
	}
`

const NavRowLabel = styled.span.withConfig({
	displayName: 'OrganizationSettingsNavRowLabel',
})`
	display: inline-flex;
	align-items: center;
	gap: var(--space-2xs);
`

const NavRowTitle = styled.span.withConfig({
	displayName: 'OrganizationSettingsNavRowTitle',
})`
	${stenciledTitle}
	font-size: var(--typescale-title-medium-size);
	line-height: var(--typescale-title-medium-line);
`

const NavRowDescription = styled.span.withConfig({
	displayName: 'OrganizationSettingsNavRowDescription',
})`
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	line-height: var(--typescale-body-small-line);
	color: var(--color-on-surface-variant);
	font-style: italic;
`

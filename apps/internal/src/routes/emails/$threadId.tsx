import { useLingui } from '@lingui/react/macro'
import { createFileRoute, Link } from '@tanstack/react-router'
import { ChevronLeft, Mail } from 'lucide-react'
import styled from 'styled-components'

import { EmptyState } from '#/components/shared/empty-state'
import { rulerUnderRule, stenciledTitle } from '#/lib/workshop-mixins'

export const Route = createFileRoute('/emails/$threadId')({
	component: ThreadDetailPlaceholder,
})

/**
 * Phase 2 ships the list page with click-through links; Phase 3 replaces
 * this placeholder with the full virtualized thread detail view. The
 * stub exists so the router type system knows the `/emails/$threadId`
 * route is reachable, which keeps the list-page `<Link>` well-typed.
 */
function ThreadDetailPlaceholder() {
	const { t } = useLingui()
	const { threadId } = Route.useParams()
	return (
		<Page>
			<Intro>
				<Heading>{t`Thread detail`}</Heading>
				<Subtitle>{threadId}</Subtitle>
			</Intro>
			<EmptyState
				icon={Mail}
				title={t`Conversation view coming soon`}
				description={t`Phase 3 will render the full message timeline with deliverability badges, attachments, and reply.`}
				action={
					<BackLink to='/emails'>
						<ChevronLeft size={14} aria-hidden />
						<span>{t`Back to inbox`}</span>
					</BackLink>
				}
			/>
		</Page>
	)
}

const Page = styled.div.withConfig({ displayName: 'EmailsThreadDetailPage' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-lg);
`

const Intro = styled.div.withConfig({ displayName: 'EmailsThreadDetailIntro' })`
	${rulerUnderRule}
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
	padding-bottom: var(--space-xs);
`

const Heading = styled.h2.withConfig({
	displayName: 'EmailsThreadDetailHeading',
})`
	${stenciledTitle}
	font-size: var(--typescale-headline-large-size);
	line-height: var(--typescale-headline-large-line);
	margin: 0;
`

const Subtitle = styled.code.withConfig({
	displayName: 'EmailsThreadDetailSubtitle',
})`
	font-family: var(--font-mono, ui-monospace, monospace);
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface-variant);
`

const BackLink = styled(Link).withConfig({
	displayName: 'EmailsThreadDetailBackLink',
})`
	display: inline-flex;
	align-items: center;
	gap: var(--space-2xs);
	padding: var(--space-2xs) var(--space-sm);
	border: 1px dashed var(--color-outline);
	border-radius: var(--shape-2xs);
	font-family: var(--font-display);
	font-size: var(--typescale-label-medium-size);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--color-on-surface);
	text-decoration: none;

	&:hover {
		border-color: var(--color-primary);
		color: var(--color-primary);
	}
`

import { Trans, useLingui } from '@lingui/react/macro'
import { createFileRoute } from '@tanstack/react-router'
import { Mail } from 'lucide-react'
import styled from 'styled-components'

import { EmptyState } from '#/components/shared/empty-state'
import { rulerUnderRule, stenciledTitle } from '#/lib/workshop-mixins'

export const Route = createFileRoute('/emails/')({
	component: EmailsIndexPage,
})

function EmailsIndexPage() {
	const { t } = useLingui()
	return (
		<Page>
			<Intro>
				<Heading>
					<Trans>Emails</Trans>
				</Heading>
				<Subtitle>
					<Trans>The inbox will be connected in a future session.</Trans>
				</Subtitle>
			</Intro>
			<EmptyState
				icon={Mail}
				title={t`Inbox pending wiring`}
				description={t`Once AgentMail is linked, incoming threads will pin to this board.`}
			/>
		</Page>
	)
}

const Page = styled.div.withConfig({ displayName: 'EmailsIndexPage' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-lg);
`

const Intro = styled.div.withConfig({ displayName: 'EmailsIndexIntro' })`
	${rulerUnderRule}
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
	padding-bottom: var(--space-xs);
`

const Heading = styled.h2.withConfig({ displayName: 'EmailsIndexHeading' })`
	${stenciledTitle}
	font-size: var(--typescale-headline-large-size);
	line-height: var(--typescale-headline-large-line);
	margin: 0;
`

const Subtitle = styled.p.withConfig({ displayName: 'EmailsIndexSubtitle' })`
	font-family: var(--font-body);
	font-size: var(--typescale-body-large-size);
	line-height: var(--typescale-body-large-line);
	font-style: italic;
	color: var(--color-on-surface-variant);
	margin: 0;
`

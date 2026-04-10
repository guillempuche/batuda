import { Trans } from '@lingui/react/macro'
import { createFileRoute } from '@tanstack/react-router'
import styled from 'styled-components'

export const Route = createFileRoute('/emails/')({
	component: EmailsIndexPage,
})

function EmailsIndexPage() {
	return (
		<Page>
			<Heading>
				<Trans>Emails</Trans>
			</Heading>
			<Subtitle>
				<Trans>The inbox will be connected in a future session.</Trans>
			</Subtitle>
		</Page>
	)
}

const Page = styled.div.withConfig({ displayName: 'EmailsIndexPage' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-xs);
`

const Heading = styled.h2.withConfig({ displayName: 'EmailsIndexHeading' })`
	font-family: var(--font-display);
	font-size: var(--typescale-headline-large-size);
	line-height: var(--typescale-headline-large-line);
	font-weight: var(--font-weight-bold);
	color: var(--color-on-surface);
`

const Subtitle = styled.p.withConfig({ displayName: 'EmailsIndexSubtitle' })`
	font-family: var(--font-body);
	font-size: var(--typescale-body-large-size);
	line-height: var(--typescale-body-large-line);
	letter-spacing: var(--typescale-body-large-tracking);
	color: var(--color-on-surface-variant);
`

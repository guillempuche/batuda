import { Trans, useLingui } from '@lingui/react/macro'
import { Link } from '@tanstack/react-router'
import { Compass } from 'lucide-react'
import { styled } from 'next-yak'

import { EmptyState } from './empty-state'

/** Shown for an address nothing answers to, and for a record that is gone. */
export function NotFound() {
	const { t } = useLingui()
	return (
		<EmptyState
			icon={Compass}
			headingLevel={1}
			title={t`Page not found`}
			description={
				<Trans>The link may be out of date, or the record was deleted.</Trans>
			}
			action={
				<HomeLink>
					<Link to='/' data-testid='not-found-home'>
						<Trans>Go to the pipeline</Trans>
					</Link>
				</HomeLink>
			}
		/>
	)
}

const HomeLink = styled.span`
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);

	a {
		color: var(--color-primary);
		text-decoration: underline;
	}
`

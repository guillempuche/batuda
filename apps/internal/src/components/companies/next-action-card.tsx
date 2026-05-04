import { Trans, useLingui } from '@lingui/react/macro'
import { Compass } from 'lucide-react'
import styled from 'styled-components'

import { EditableField } from '#/components/shared/editable-field'
import {
	agedPaperSurface,
	rulerUnderRule,
	stenciledTitle,
} from '#/lib/workshop-mixins'

/**
 * "What's the next move?" card. Wraps the inline `EditableField` for the
 * company's `nextAction` text in dashboard-card chrome so the deal-driving
 * field reads like a primary signal instead of one row in a flat field
 * grid.
 */
export function NextActionCard({
	value,
	onSave,
}: {
	readonly value: string | null
	readonly onSave: (next: string | null) => Promise<void>
}) {
	const { t } = useLingui()
	return (
		<Card data-testid='company-next-action-card'>
			<Header>
				<Heading>
					<Compass size={14} aria-hidden />
					<Trans>Next action</Trans>
				</Heading>
			</Header>
			<Body>
				<EditableField
					label={t`Next action`}
					value={value}
					onSave={onSave}
					multiline
				/>
			</Body>
		</Card>
	)
}

const Card = styled.section`
	${agedPaperSurface}
	display: flex;
	flex-direction: column;
	gap: var(--space-sm);
	padding: var(--space-md);
`

const Header = styled.header`
	${rulerUnderRule}
	padding-bottom: var(--space-2xs);
`

const Heading = styled.h3`
	${stenciledTitle}
	display: inline-flex;
	align-items: center;
	gap: var(--space-2xs);
	margin: 0;
	font-size: var(--typescale-title-medium-size);
	line-height: var(--typescale-title-medium-line);
`

const Body = styled.div`
	display: flex;
	flex-direction: column;
	gap: var(--space-xs);
`

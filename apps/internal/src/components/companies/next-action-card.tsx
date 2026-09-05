import { Trans, useLingui } from '@lingui/react/macro'
import { Compass } from 'lucide-react'
import { styled } from 'next-yak'

import { EditableField } from '#/components/shared/editable-field'
import { RelativeDate } from '#/components/shared/relative-date'
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
	dueAt,
	onSave,
}: {
	readonly value: string | null
	readonly dueAt: string | null
	readonly onSave: (next: string | null) => Promise<void>
}) {
	const { t } = useLingui()
	// Late is called out rather than sitting quietly among dates still ahead. The
	// reader's own clock decides that, so the wording the server printed is
	// allowed to differ from what they end up seeing.
	const overdue = dueAt !== null && Date.parse(dueAt) < Date.now()
	return (
		<Card data-testid='company-next-action-card'>
			<Header>
				<Heading>
					<Compass size={14} aria-hidden />
					<Trans>Next action</Trans>
				</Heading>
				{dueAt !== null ? (
					<Due
						$overdue={overdue}
						data-testid='company-next-action-due'
						suppressHydrationWarning
					>
						{overdue ? <Trans>Overdue</Trans> : <Trans>Due</Trans>}{' '}
						<RelativeDate value={dueAt} />
					</Due>
				) : null}
			</Header>
			<Body>
				<EditableField
					label={t`Next action`}
					value={value}
					onSave={onSave}
					multiline
					hideLabel
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
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: var(--space-sm);
	padding-bottom: var(--space-2xs);
`

const Due = styled.span<{ $overdue: boolean }>`
	flex-shrink: 0;
	font-family: var(--font-body);
	font-size: var(--typescale-label-medium-size);
	line-height: var(--typescale-label-medium-line);
	color: ${p =>
		p.$overdue ? 'var(--color-error)' : 'var(--color-on-surface-variant)'};
	font-weight: ${p =>
		p.$overdue ? 'var(--font-weight-bold)' : 'var(--font-weight-regular)'};

	/* The nested relative date carries its own muted colour, so the overdue
	   emphasis has to reach it too or only the label turns red. */
	& time {
		color: inherit;
		font-weight: inherit;
	}
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

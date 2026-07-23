import { Plural, Trans, useLingui } from '@lingui/react/macro'
import { Pencil, Star, Trash2 } from 'lucide-react'
import styled from 'styled-components'

import { DefaultBadge, InstructionIconButton } from './instruction-chrome'
import {
	RowActions,
	TemplateList,
	TemplateName,
	TemplateRowItem,
} from './instruction-page-chrome'
import type { StackShape } from './instruction-shapes'

// A list of one agent+scope's stacks. Each row names the stack, flags the
// default, counts its templates, and (for a personal stack layered on the org
// default) marks that it extends. When read-only — a member viewing org stacks
// they can't manage — the row shows names and badges but no action buttons.
export function StackList({
	stacks,
	onEdit,
	onSetDefault,
	onDelete,
	readOnly = false,
}: {
	readonly stacks: ReadonlyArray<StackShape>
	readonly onEdit: (stack: StackShape) => void
	readonly onSetDefault: (stack: StackShape) => void
	readonly onDelete: (stack: StackShape) => void
	readonly readOnly?: boolean
}) {
	const { t } = useLingui()

	return (
		<TemplateList>
			{stacks.map(stack => (
				<TemplateRowItem key={stack.id} data-testid='stack-row'>
					<TemplateName>{stack.name}</TemplateName>
					{stack.isDefault ? (
						<DefaultBadge>
							<Trans>Default</Trans>
						</DefaultBadge>
					) : null}
					{stack.scope === 'personal' && stack.composition === 'extend' ? (
						<Tag>
							<Trans>Extends org default</Trans>
						</Tag>
					) : null}
					<Count>
						<Plural
							value={stack.templateIds.length}
							one='# template'
							other='# templates'
						/>
					</Count>
					{readOnly ? null : (
						<RowActions>
							<InstructionIconButton
								type='button'
								aria-label={t`Edit ${stack.name}`}
								onClick={() => onEdit(stack)}
							>
								<Pencil size={14} aria-hidden />
							</InstructionIconButton>
							{stack.isDefault ? null : (
								<InstructionIconButton
									type='button'
									aria-label={t`Make ${stack.name} the default`}
									onClick={() => onSetDefault(stack)}
								>
									<Star size={14} aria-hidden />
								</InstructionIconButton>
							)}
							<InstructionIconButton
								type='button'
								aria-label={t`Delete ${stack.name}`}
								onClick={() => onDelete(stack)}
							>
								<Trash2 size={14} aria-hidden />
							</InstructionIconButton>
						</RowActions>
					)}
				</TemplateRowItem>
			))}
		</TemplateList>
	)
}

const Tag = styled.span`
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--color-on-surface-variant);
`

const Count = styled.span`
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface-variant);
	white-space: nowrap;
`

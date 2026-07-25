import { Trans, useLingui } from '@lingui/react/macro'
import { X } from 'lucide-react'
import styled from 'styled-components'

import { PriButton, PriDialog } from '@batuda/ui/pri'

import { MarkdownView } from '#/components/markdown/markdown-view'
import { stenciledTitle } from '#/lib/workshop-mixins'

// Reading a template, shared by the personal and org template pages. The
// standing guidance an agent follows on every run is worth reading even when
// you are not the one who may change it, so anyone can open any template they
// can see; changing one stays with its owner.
export function TemplateViewDialog({
	open,
	name,
	body,
	canEdit,
	onEdit,
	onClose,
	testId,
}: {
	readonly open: boolean
	readonly name: string
	readonly body: string
	// The page decides: a template you own, or an org template you administer.
	readonly canEdit: boolean
	readonly onEdit: () => void
	readonly onClose: () => void
	readonly testId: string
}) {
	const { t } = useLingui()
	const hasBody = body.trim().length > 0

	return (
		<PriDialog.Root open={open} onOpenChange={next => !next && onClose()}>
			<PriDialog.Portal>
				<PriDialog.Backdrop />
				<PriDialog.Popup mobile='sheet' data-testid={testId}>
					<Header>
						<PriDialog.Title>
							<Title>{name}</Title>
						</PriDialog.Title>
						<PriDialog.Close
							render={props => (
								<CloseButton type='button' aria-label={t`Close`} {...props}>
									<X size={18} aria-hidden />
								</CloseButton>
							)}
						/>
					</Header>

					{/* Long guidance scrolls on its own, so it has to be reachable by
					    keyboard — otherwise anything past the first screenful can only
					    be read with a mouse wheel. */}
					<Body
						data-testid={`${testId}-body`}
						role='region'
						aria-label={t`Instructions`}
						tabIndex={hasBody ? 0 : -1}
					>
						{hasBody ? (
							<MarkdownView source={body} />
						) : (
							<EmptyBody>
								<Trans>
									This template is empty, so it adds nothing to a run. Ask
									whoever looks after it to fill it in.
								</Trans>
							</EmptyBody>
						)}
					</Body>

					{canEdit ? (
						<Footer>
							<PriButton
								type='button'
								$variant='filled'
								data-testid={`${testId}-edit`}
								onClick={onEdit}
							>
								<Trans>Edit</Trans>
							</PriButton>
						</Footer>
					) : null}
				</PriDialog.Popup>
			</PriDialog.Portal>
		</PriDialog.Root>
	)
}

const Header = styled.div`
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	gap: var(--space-sm);
`

const Title = styled.span`
	${stenciledTitle}
	font-size: var(--typescale-title-large-size);
	line-height: var(--typescale-title-large-line);
`

// Long guidance scrolls here rather than pushing the dialog off screen. The
// dialog already caps its own height, so this takes whatever room is left over
// instead of setting a height of its own — two nested scrollbars otherwise.
const Body = styled.div`
	margin-top: var(--space-sm);
	flex: 1;
	min-height: 0;
	overflow-y: auto;

	&:focus-visible {
		outline: none;
		box-shadow: var(--glow-active);
	}
`

const EmptyBody = styled.p`
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	font-style: italic;
	color: var(--color-on-surface-variant);
	margin: 0;
`

const CloseButton = styled.button`
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 1.75rem;
	height: 1.75rem;
	padding: 0;

	/* Bigger tap target on touch, matching the editor dialog. */
	@media (pointer: coarse) {
		width: 2.75rem;
		height: 2.75rem;
	}
	border: none;
	border-radius: var(--shape-2xs);
	background: transparent;
	color: var(--color-on-surface-variant);
	cursor: pointer;

	&:hover {
		background: color-mix(in oklab, var(--color-on-surface) 12%, transparent);
		color: var(--color-on-surface);
	}

	&:focus-visible {
		outline: none;
		box-shadow: var(--glow-active);
	}
`

const Footer = styled.div`
	display: flex;
	gap: var(--space-sm);
	justify-content: flex-end;
	margin-top: var(--space-md);

	@media (max-width: 40rem) {
		& > * {
			width: 100%;
		}
	}
`

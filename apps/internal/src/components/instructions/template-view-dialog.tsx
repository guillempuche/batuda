import { Trans, useLingui } from '@lingui/react/macro'
import { Copy, X } from 'lucide-react'
import { useRef } from 'react'
import styled from 'styled-components'

import { PriButton, PriDialog, usePriToast } from '@batuda/ui/pri'

import { MarkdownView } from '#/components/markdown/markdown-view'
import { RelativeDate } from '#/components/shared/relative-date'
import { stenciledTitle } from '#/lib/workshop-mixins'

// Reading a template, shared by the personal and org template pages. The
// standing guidance an agent follows on every run is worth reading even when
// you are not the one who may change it, so anyone can open any template they
// can see; changing one stays with its owner.
export function TemplateViewDialog({
	open,
	name,
	body,
	updatedAt = null,
	canEdit,
	orgOwned = false,
	onEdit,
	onClose,
	testId,
}: {
	readonly open: boolean
	readonly name: string
	readonly body: string
	readonly updatedAt?: string | null
	// The page decides: a template you own, or an org template you administer.
	readonly canEdit: boolean
	// Looked after by the organization rather than the reader, so the footer can
	// say why there is no Edit button instead of leaving a bare Close.
	readonly orgOwned?: boolean
	readonly onEdit: () => void
	readonly onClose: () => void
	readonly testId: string
}) {
	const { t } = useLingui()
	const toast = usePriToast()

	// The dialog fades out over a moment, and by then the page has already let go
	// of the row. Keep showing the last template so the title doesn't blank out
	// while it is still on screen.
	const lastShown = useRef({ name, body, updatedAt, canEdit, orgOwned })
	if (open) lastShown.current = { name, body, updatedAt, canEdit, orgOwned }
	const shown = open
		? { name, body, updatedAt, canEdit, orgOwned }
		: lastShown.current

	const hasBody = shown.body.trim().length > 0

	const copyBody = async () => {
		try {
			await navigator.clipboard.writeText(shown.body)
			toast.add({ title: t`Instructions copied`, type: 'success' })
		} catch {
			toast.add({ title: t`Couldn't copy the instructions`, type: 'error' })
		}
	}

	return (
		<PriDialog.Root open={open} onOpenChange={next => !next && onClose()}>
			<PriDialog.Portal>
				<PriDialog.Backdrop />
				<PriDialog.Popup mobile='sheet' data-testid={testId}>
					<Header>
						<TitleBlock>
							<PriDialog.Title>
								<Title>{shown.name}</Title>
							</PriDialog.Title>
							{shown.updatedAt !== null ? (
								<Meta>
									<Trans>Last changed</Trans>{' '}
									<RelativeDate value={shown.updatedAt} />
								</Meta>
							) : null}
						</TitleBlock>
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
							<MarkdownView source={shown.body} />
						) : (
							<EmptyBody>
								<Trans>
									This template is empty, so it adds nothing to a run. Ask
									whoever looks after it to fill it in.
								</Trans>
							</EmptyBody>
						)}
					</Body>

					<Footer>
						{!shown.canEdit && shown.orgOwned ? (
							<FooterNote data-testid={`${testId}-managed`}>
								<Trans>Your organization looks after this one.</Trans>
							</FooterNote>
						) : null}
						{hasBody ? (
							<PriButton
								type='button'
								$variant='text'
								data-testid={`${testId}-copy`}
								onClick={() => {
									void copyBody()
								}}
							>
								<Copy size={14} aria-hidden />
								<Trans>Copy</Trans>
							</PriButton>
						) : null}
						{shown.canEdit ? (
							<PriButton
								type='button'
								$variant='filled'
								data-testid={`${testId}-edit`}
								onClick={onEdit}
							>
								<Trans>Edit</Trans>
							</PriButton>
						) : null}
					</Footer>
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

const TitleBlock = styled.div`
	display: flex;
	flex-direction: column;
	gap: var(--space-3xs);
	min-width: 0;
`

const Title = styled.span`
	${stenciledTitle}
	font-size: var(--typescale-title-large-size);
	line-height: var(--typescale-title-large-line);
`

const Meta = styled.span`
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface-variant);
`

const FooterNote = styled.span`
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	font-style: italic;
	color: var(--color-on-surface-variant);
	margin-right: auto;
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
	align-items: center;
	gap: var(--space-sm);
	justify-content: flex-end;
	margin-top: var(--space-md);

	@media (max-width: 40rem) {
		flex-direction: column;
		align-items: stretch;
		gap: var(--space-2xs);

		& > * {
			width: 100%;
		}
	}
`

import { Trans, useLingui } from '@lingui/react/macro'
import {
	AlertTriangle,
	ChevronRight,
	ExternalLink,
	Link2,
	Send,
} from 'lucide-react'
import styled from 'styled-components'

import { PriCollapsible } from '@batuda/ui/pri'

import { CHANNEL_ICON } from '#/components/contacts/channel-icons'
import { useChannelKindLabel } from '#/components/contacts/channel-kind-label'
import {
	channelHref,
	type DisplayChannel,
} from '#/components/contacts/display-channels'
import { agedPaperSurface, stenciledTitle } from '#/lib/workshop-mixins'

type Props = {
	readonly channels: ReadonlyArray<DisplayChannel>
	/** Opens a new message to this address. Only offered for mailboxes. */
	readonly onEmail: (address: string) => void
	/** Lets mail go to the company's mailboxes again. */
	readonly onClearSuppression: () => void
}

/**
 * Whether the send gate is holding mail back from this address. Read in both
 * places that say so, so a mark can never appear without the note explaining it.
 */
const isHeldBack = (ch: DisplayChannel): boolean =>
	ch.kind === 'email' && (ch.status === 'bounced' || ch.status === 'complained')

/**
 * Every way of reaching the company, not just the first of each kind.
 *
 * The header row above shows one mailbox, one number and one handle — right for
 * a quick action, but it makes a firm with an orders mailbox, an accounts
 * mailbox and a switchboard look like a firm with one of each. Everything is
 * listed here under the name somebody gave it, so "orders" and "accounts" can be
 * told apart before one of them is written to.
 */
export function CompanyChannelsSection({
	channels,
	onEmail,
	onClearSuppression,
}: Props) {
	const { t } = useLingui()
	const kindLabel = useChannelKindLabel()
	if (channels.length === 0) return null

	// A mailbox nobody is listed under is held back the same as anybody's, and
	// this is the only place it is shown — so a block left unsaid here is a block
	// with no way off it.
	const heldBack = channels.filter(isHeldBack)

	return (
		<PriCollapsible.Root defaultOpen>
			<TriggerWrap>
				<PriCollapsible.Trigger data-testid='company-channels-trigger'>
					<ChevronRight size={14} aria-hidden />
					<Link2 size={14} aria-hidden />
					<Trans>Ways to reach</Trans>
					<Count>{channels.length}</Count>
				</PriCollapsible.Trigger>
			</TriggerWrap>
			<PriCollapsible.Panel>
				<Body data-testid='company-channels-panel'>
					{channels.map(ch => {
						const Icon = CHANNEL_ICON[ch.kind] ?? Link2
						const { href, external } = channelHref(ch.kind, ch.value)
						// Everything sitting beside the address is said in the link's own
						// name too. On screen they are read together; to somebody moving
						// link by link they would otherwise be lost — and which kind an
						// address belongs to is carried only by a drawing that three
						// platforms share.
						const spoken = [
							`${kindLabel(ch.kind)}: ${ch.value}`,
							ch.label,
							ch.isPrimary ? t`default` : null,
							external ? t`opens in a new tab` : null,
						]
							.filter(Boolean)
							.join(', ')
						return (
							<Row key={ch.id}>
								<Icon size={14} aria-hidden />
								<Address
									href={href}
									aria-label={spoken}
									{...(external
										? { target: '_blank', rel: 'noopener noreferrer' }
										: {})}
								>
									{ch.value}
									{external && <ExternalLink size={11} aria-hidden />}
								</Address>
								{/* Hidden from a reader who hears the page, because the link
								 * above already says both. */}
								{ch.label ? <Label aria-hidden>{ch.label}</Label> : null}
								{ch.isPrimary ? (
									<Primary aria-hidden>
										<Trans>primary</Trans>
									</Primary>
								) : null}
								{isHeldBack(ch) ? (
									<Held
										data-testid={`company-channel-held-${ch.id}`}
										title={ch.statusReason ?? undefined}
									>
										<AlertTriangle size={10} aria-hidden />
										<span>
											{ch.status === 'bounced' ? t`Bounced` : t`Complained`}
										</span>
									</Held>
								) : null}
								{ch.kind === 'email' ? (
									<Compose
										type='button'
										aria-label={t`Write to ${ch.value}`}
										onClick={() => onEmail(ch.value)}
									>
										<Send size={13} aria-hidden />
									</Compose>
								) : null}
							</Row>
						)
					})}
					{heldBack.length > 0 ? (
						<HeldNote>
							<span>
								{t`Mail to these addresses is being held back. Letting mail through lifts all of them at once, and any that bounces again is held straight back.`}
							</span>
							<ClearButton
								type='button'
								data-testid='company-clear-suppression'
								onClick={onClearSuppression}
							>
								<Trans>Let mail through again</Trans>
							</ClearButton>
						</HeldNote>
					) : null}
				</Body>
			</PriCollapsible.Panel>
		</PriCollapsible.Root>
	)
}

const TriggerWrap = styled.div.withConfig({
	displayName: 'CompanyChannelsTriggerWrap',
})`
	display: flex;
	justify-content: flex-start;
`

const Count = styled.span.withConfig({
	displayName: 'CompanyChannelsCount',
})`
	${stenciledTitle}
	padding: 0 var(--space-2xs);
	border: 1px solid currentColor;
	border-radius: var(--shape-2xs);
	font-size: var(--typescale-label-small-size);
	color: var(--color-on-surface-variant);
`

const Body = styled.ul.withConfig({
	displayName: 'CompanyChannelsBody',
})`
	${agedPaperSurface}
	display: flex;
	flex-direction: column;
	gap: var(--space-xs);
	padding: var(--space-md);
	margin-top: var(--space-sm);
	list-style: none;
`

// The chips after the address wrap onto their own line in a narrow column
// rather than squeezing it — an address broken mid-word is harder to read than
// one that takes two lines.
const Row = styled.li.withConfig({
	displayName: 'CompanyChannelsRow',
})`
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--space-2xs);
	color: var(--color-on-surface-variant);
`

const Address = styled.a.withConfig({
	displayName: 'CompanyChannelsAddress',
})`
	display: inline-flex;
	align-items: center;
	gap: var(--space-2xs);
	border-bottom: 1px dashed var(--color-outline-variant);
	color: var(--color-on-surface);
	font-size: var(--typescale-body-small-size);
	overflow-wrap: break-word;

	&:hover {
		border-bottom-color: var(--color-on-surface);
	}

	&:focus-visible {
		outline: none;
		box-shadow: var(--glow-active);
	}
`

const Label = styled.span.withConfig({
	displayName: 'CompanyChannelsLabel',
})`
	padding: 0 var(--space-2xs);
	border-radius: var(--shape-2xs);
	background: var(--color-surface-container-high);
	color: var(--color-on-surface-variant);
	font-size: var(--typescale-label-small-size);
`

const Primary = styled.span.withConfig({
	displayName: 'CompanyChannelsPrimary',
})`
	${stenciledTitle}
	font-size: var(--typescale-label-small-size);
	color: var(--color-on-surface-variant);
`

const Held = styled.span.withConfig({
	displayName: 'CompanyChannelHeld',
})`
	display: inline-flex;
	align-items: center;
	gap: var(--space-3xs);
	padding: 0 var(--space-2xs);
	border-radius: var(--shape-full);
	background: color-mix(in oklab, var(--color-error) 12%, transparent);
	color: var(--color-error);
	font-size: var(--typescale-label-small-size);
	line-height: var(--typescale-label-small-line);
	white-space: nowrap;
`

const HeldNote = styled.div.withConfig({
	displayName: 'CompanyChannelsHeldNote',
})`
	/* Stacked at every width: the panel sits in a narrow column, so even a wide
	   window leaves the sentence wrapping to two words a line beside the
	   button. */
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	gap: var(--space-2xs);
	margin-top: var(--space-2xs);
	padding: var(--space-2xs) var(--space-xs);
	border: 1px solid color-mix(in oklab, var(--color-error) 40%, transparent);
	border-radius: var(--shape-xs);
	color: var(--color-on-surface-variant);
	font-size: var(--typescale-body-small-size);
	line-height: var(--typescale-body-small-line);
`

const ClearButton = styled.button.withConfig({
	displayName: 'CompanyClearSuppression',
})`
	flex: 0 0 auto;
	padding: var(--space-3xs) var(--space-xs);
	border: 1px solid var(--color-outline);
	border-radius: var(--shape-full);
	background: transparent;
	color: var(--color-primary);
	font-size: var(--typescale-label-medium-size);
	cursor: pointer;

	&:hover {
		background: color-mix(in oklab, var(--color-primary) 8%, transparent);
	}
`

const Compose = styled.button.withConfig({
	displayName: 'CompanyChannelsCompose',
})`
	display: inline-flex;
	align-items: center;
	padding: var(--space-2xs);
	border: none;
	background: none;
	color: var(--color-on-surface-variant);
	cursor: pointer;

	&:hover {
		color: var(--color-on-surface);
	}

	&:focus-visible {
		outline: none;
		box-shadow: var(--glow-active);
	}
`

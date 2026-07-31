import { Trans, useLingui } from '@lingui/react/macro'
import { ChevronRight, ExternalLink, Link2, Send } from 'lucide-react'
import styled from 'styled-components'

import { PriCollapsible } from '@batuda/ui/pri'

import { CHANNEL_ICON } from '#/components/contacts/channel-icons'
import {
	channelHref,
	type DisplayChannel,
} from '#/components/contacts/display-channels'
import { agedPaperSurface, stenciledTitle } from '#/lib/workshop-mixins'

type Props = {
	readonly channels: ReadonlyArray<DisplayChannel>
	/** Opens a new message to this address. Only offered for mailboxes. */
	readonly onEmail: (address: string) => void
}

/**
 * Every way of reaching the company, not just the first of each kind.
 *
 * The header row above shows one mailbox, one number and one handle — right for
 * a quick action, but it makes a firm with an orders mailbox, an accounts
 * mailbox and a switchboard look like a firm with one of each. Everything is
 * listed here under the name somebody gave it, so "orders" and "accounts" can be
 * told apart before one of them is written to.
 */
export function CompanyChannelsSection({ channels, onEmail }: Props) {
	const { t } = useLingui()
	if (channels.length === 0) return null

	return (
		<PriCollapsible.Root defaultOpen>
			<TriggerWrap>
				<Trigger data-testid='company-channels-trigger'>
					<ChevronRight size={14} aria-hidden />
					<Link2 size={14} aria-hidden />
					<Trans>Ways to reach</Trans>
					<Count>{channels.length}</Count>
				</Trigger>
			</TriggerWrap>
			<PriCollapsible.Panel>
				<Body data-testid='company-channels-panel'>
					{channels.map(ch => {
						const Icon = CHANNEL_ICON[ch.kind] ?? Link2
						const { href, external } = channelHref(ch.kind, ch.value)
						return (
							<Row key={ch.id}>
								<Icon size={14} aria-hidden />
								<Address
									href={href}
									{...(external
										? { target: '_blank', rel: 'noopener noreferrer' }
										: {})}
								>
									{ch.value}
									{external && <ExternalLink size={11} aria-hidden />}
								</Address>
								{ch.label ? <Label>{ch.label}</Label> : null}
								{ch.isPrimary ? (
									<Primary>
										<Trans>primary</Trans>
									</Primary>
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
				</Body>
			</PriCollapsible.Panel>
		</PriCollapsible.Root>
	)
}

const TriggerWrap = styled.div`
	display: flex;
	justify-content: flex-start;
`

const Trigger = styled(PriCollapsible.Trigger)`
	& > svg:first-child {
		transition: transform 200ms ease;
	}

	&[data-open] > svg:first-child,
	&[aria-expanded='true'] > svg:first-child {
		transform: rotate(90deg);
	}
`

const Count = styled.span`
	${stenciledTitle}
	padding: 0 var(--space-2xs);
	border: 1px solid currentColor;
	border-radius: var(--radius-xs);
	font-size: var(--typescale-label-small-size);
	color: var(--color-on-surface-variant);
`

const Body = styled.div`
	${agedPaperSurface}
	display: flex;
	flex-direction: column;
	gap: var(--space-xs);
	padding: var(--space-md);
	margin-top: var(--space-sm);
`

// The chips after the address wrap onto their own line in a narrow column
// rather than squeezing it — an address broken mid-word is harder to read than
// one that takes two lines.
const Row = styled.div`
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--space-2xs);
	color: var(--color-on-surface-variant);
`

const Address = styled.a`
	display: inline-flex;
	align-items: center;
	gap: var(--space-2xs);
	color: var(--color-on-surface);
	font-size: var(--typescale-body-small-size);
	overflow-wrap: break-word;
`

const Label = styled.span`
	padding: 0 var(--space-2xs);
	border-radius: var(--radius-xs);
	background: var(--color-surface-container-high);
	color: var(--color-on-surface-variant);
	font-size: var(--typescale-label-small-size);
`

const Primary = styled.span`
	${stenciledTitle}
	font-size: var(--typescale-label-small-size);
	color: var(--color-on-surface-variant);
`

const Compose = styled.button`
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
`

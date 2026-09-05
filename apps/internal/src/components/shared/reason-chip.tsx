import { useLingui } from '@lingui/react/macro'
import { styled } from 'next-yak'

/**
 * Why this row is on this list.
 *
 * A triage list mixes companies caught by different rules — one has missed a
 * follow-up, another has just gone quiet — and a card alone shows neither. The
 * chip answers "why is this here" and "how bad is it" in the same breath, which
 * is what decides whether it gets called today or on Friday.
 */
export type AttentionReason = 'overdue' | 'stale'

export function ReasonChip({
	reason,
	since,
}: {
	readonly reason: AttentionReason
	// The date the reason is measured from: the follow-up that was missed, or
	// the last time anybody made contact. Null means never contacted at all.
	readonly since: string | null
}) {
	const { t } = useLingui()
	const days = since === null ? null : daysBetween(since, Date.now())

	// Each variant is a whole sentence rather than a span slotted into one.
	// Building the span separately reads better in code and produces nothing at
	// all: the macro only rewrites `t` templates where it can see the binding,
	// and a `t` handed to a helper as an argument is not that. Whole sentences
	// also give a translator the word order, which a bare "6 weeks" does not.
	const weeks = days === null ? 0 : Math.round(days / 7)
	const months = days === null ? 0 : Math.round(days / 30)

	const label =
		reason === 'overdue'
			? days === null
				? t`Follow-up overdue`
				: days < 1
					? t`Follow-up overdue by less than a day`
					: days < 14
						? t`Follow-up overdue by ${days} days`
						: days < 60
							? t`Follow-up overdue by ${weeks} weeks`
							: t`Follow-up overdue by ${months} months`
			: days === null
				? t`Never contacted`
				: days < 1
					? t`No contact for less than a day`
					: days < 14
						? t`No contact in ${days} days`
						: days < 60
							? t`No contact in ${weeks} weeks`
							: t`No contact in ${months} months`

	return (
		<Chip $reason={reason} data-testid={`reason-chip-${reason}`}>
			{label}
		</Chip>
	)
}

/**
 * Whole days between an instant and now, never negative.
 *
 * Counted in days rather than exactly, because the chip reads "3 days" either
 * way and an hours-precise answer would change on every render.
 */
function daysBetween(iso: string, now: number): number | null {
	const then = Date.parse(iso)
	if (Number.isNaN(then)) return null
	return Math.max(0, Math.floor((now - then) / 86_400_000))
}

const Chip = styled.span<{ $reason: AttentionReason }>`
	display: inline-flex;
	align-items: center;
	align-self: flex-start;
	padding: var(--space-3xs) var(--space-2xs);
	border-radius: var(--shape-2xs);
	border: 1px dashed
		${p =>
			p.$reason === 'overdue' ? 'var(--color-error)' : 'var(--color-outline)'};
	color: ${p =>
		p.$reason === 'overdue'
			? 'var(--color-error)'
			: 'var(--color-on-surface-variant)'};
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	line-height: var(--typescale-label-small-line);
	font-weight: var(--font-weight-bold);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	white-space: nowrap;
`

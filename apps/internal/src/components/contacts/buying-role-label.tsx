import { useLingui } from '@lingui/react/macro'

/**
 * How each part in a purchase reads on screen.
 *
 * A badge that only ever said "Decision maker" showed the two parts that can
 * carry a purchase as the same thing, and the other three as nothing at all —
 * indistinguishable from nobody having looked, which is the conflation the parts
 * exist to remove. Every part now says what it is.
 *
 * Read through a hook rather than a constant map so the words are translated at
 * render time, in the reader's language, rather than frozen at module load.
 */
export const useBuyingRoleLabel = (): ((
	role: string | null,
) => string | null) => {
	const { t } = useLingui()
	return role => {
		switch (role) {
			case 'economic_buyer':
				return t`Holds the budget`
			case 'champion':
				return t`Argues for it inside`
			case 'gatekeeper':
				return t`Controls access`
			case 'technical_evaluator':
				return t`Judges whether it works`
			case 'user':
				return t`Uses it day to day`
			// A part this app does not yet have a word for is shown as it was
			// stored rather than hidden — the record is the truth, and a blank
			// would read as "nobody has said".
			default:
				return role === null || role.trim() === '' ? null : role
		}
	}
}

import { Trans } from '@lingui/react/macro'
import styled from 'styled-components'

const Stamp = styled.span`
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	font-weight: var(--font-weight-bold);
	letter-spacing: 0.1em;
	text-transform: uppercase;
	color: #3a342c;
	text-shadow: var(--text-shadow-emboss);
`

/* Three stamped lines used by both the desktop FooterPlate and the mobile
 * WorkshopFooter — kept identical so the brand reads the same on every
 * surface. */
export function FooterStampContent() {
	return (
		<>
			<Stamp>
				<Trans>Made in Girona</Trans>
			</Stamp>
			<Stamp>&middot;</Stamp>
			<Stamp>&copy; {new Date().getFullYear()} Engranatge</Stamp>
		</>
	)
}

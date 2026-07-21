import styled from 'styled-components'

/**
 * Text only a screen reader reads out. It stays in the page rather than being
 * hidden with `display: none`, because anything hidden that way is dropped
 * from the accessibility tree and never announced.
 *
 * Pair it with `role='status'` to narrate something that finished — a list
 * that loaded, a retry that is under way — where a sighted reader can see the
 * change but a listener would otherwise get silence.
 */
export const SrOnly = styled.span.withConfig({ displayName: 'SrOnly' })`
	position: absolute;
	width: 1px;
	height: 1px;
	padding: 0;
	margin: -1px;
	overflow: hidden;
	clip: rect(0, 0, 0, 0);
	white-space: nowrap;
	border: 0;
`

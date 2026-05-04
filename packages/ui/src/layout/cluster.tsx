import styled from 'styled-components'

import type { SpaceToken } from './tokens'

type ClusterAlign = 'start' | 'center' | 'end' | 'baseline' | 'stretch'
type ClusterJustify =
	| 'start'
	| 'center'
	| 'end'
	| 'space-between'
	| 'space-around'

/**
 * Cluster — horizontal flex-wrap row of items that wrap onto new rows
 * when the container can't fit them. Every-layout's "cluster" pattern.
 *
 *   <Cluster $gap="sm" $align="center">
 *     <Tag />
 *     <Tag />
 *     <Button />
 *   </Cluster>
 *
 * Reference: every-layout.dev/layouts/cluster
 */
export const Cluster = styled.div.withConfig({
	displayName: 'Cluster',
	shouldForwardProp: prop =>
		prop !== '$gap' && prop !== '$align' && prop !== '$justify',
})<{
	$gap?: SpaceToken
	$align?: ClusterAlign
	$justify?: ClusterJustify
}>`
	display: flex;
	flex-wrap: wrap;
	align-items: ${p => p.$align ?? 'center'};
	justify-content: ${p => p.$justify ?? 'flex-start'};
	gap: var(--space-${p => p.$gap ?? 'sm'});
`

import { Link } from '@tanstack/react-router'
import styled from 'styled-components'

import {
	brushedMetalPlate,
	ruledLedgerRow,
	rulerUnderRule,
	stenciledTitle,
} from '#/lib/workshop-mixins'

// Shared page furniture for the instruction-template settings pages (the user
// library and the org admin page). Both pages lay out the same workshop
// surfaces — brushed-metal sections, a stencilled title, a ruled list of
// template rows — so the chrome lives in one place to stay in step.

export const Page = styled.div`
	display: flex;
	flex-direction: column;
	gap: var(--space-lg);
`

export const BackLink = styled(Link)`
	display: inline-flex;
	gap: var(--space-2xs);
	font-family: var(--font-display);
	font-size: var(--typescale-label-medium-size);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--color-on-surface-variant);
	text-decoration: none;

	&:hover {
		color: var(--color-on-surface);
	}

	&:focus-visible {
		outline: none;
		box-shadow: var(--glow-active);
	}
`

export const Intro = styled.div`
	${rulerUnderRule}
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
	padding-bottom: var(--space-xs);
`

export const Heading = styled.h2`
	${stenciledTitle}
	display: inline-flex;
	align-items: center;
	gap: var(--space-2xs);
	font-size: var(--typescale-headline-large-size);
	line-height: var(--typescale-headline-large-line);
	margin: 0;
`

export const Subtitle = styled.p`
	font-family: var(--font-body);
	font-size: var(--typescale-body-large-size);
	font-style: italic;
	color: var(--color-on-surface-variant);
	margin: 0;
	max-width: 46rem;
`

export const Section = styled.section`
	${brushedMetalPlate}
	display: flex;
	flex-direction: column;
	gap: var(--space-sm);
	padding: var(--space-md);
	border-radius: var(--shape-2xs);
`

export const SectionHead = styled.div`
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--space-sm);
	/* On a narrow phone the title and its action (a button or the surface
	   selector) drop to separate rows instead of crowding one line. */
	flex-wrap: wrap;
`

export const SectionTitle = styled.h3`
	${stenciledTitle}
	font-size: var(--typescale-title-medium-size);
	line-height: var(--typescale-title-medium-line);
	margin: 0;
`

export const TemplateList = styled.ul`
	list-style: none;
	margin: 0;
	padding: 0;
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
`

export const TemplateRowItem = styled.li`
	${ruledLedgerRow}
	display: flex;
	align-items: center;
	gap: var(--space-sm);
	padding: var(--space-2xs) 0;
`

export const TemplateName = styled.span`
	flex: 1 1 auto;
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	color: var(--color-on-surface);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
`

export const RowActions = styled.div`
	display: inline-flex;
	gap: var(--space-2xs);
`

export const Empty = styled.p`
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	font-style: italic;
	color: var(--color-on-surface-variant);
	margin: 0;
`

// Inline error notice for a failed load or save (pair with role='alert').
export const Notice = styled.p`
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	color: var(--color-error);
	padding: var(--space-2xs) var(--space-sm);
	border-left: 3px solid var(--color-error);
	background: color-mix(in srgb, var(--color-error) 6%, transparent);
	margin: 0;
`

export const DialogActions = styled.div`
	display: flex;
	gap: var(--space-sm);
	justify-content: flex-end;
	margin-top: var(--space-md);
`

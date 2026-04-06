import styled from 'styled-components'

const SectionWrapper = styled.section.attrs({ 'data-component': 'Section' })<{
	$bg?: string
}>`
	padding: var(--space-4xl) var(--page-gutter);
	background: ${p => p.$bg ?? 'transparent'};
`

const SectionInner = styled.div`
	max-width: var(--page-max-width);
	margin: 0 auto;
`

const SectionHeading = styled.h2`
	font-family: var(--font-display);
	font-size: var(--typescale-headline-large-size);
	line-height: var(--typescale-headline-large-line);
	font-weight: 700;
	letter-spacing: 0.04em;
	text-transform: uppercase;
	color: var(--color-on-surface);
	margin-bottom: var(--space-xs);
`

const SectionSubtitle = styled.p`
	font-size: var(--typescale-body-large-size);
	line-height: var(--typescale-body-large-line);
	color: var(--color-on-surface-variant);
	margin-bottom: var(--space-2xl);
`

export function Section({
	id,
	title,
	subtitle,
	background,
	children,
}: {
	id?: string
	title?: string
	subtitle?: string
	background?: string
	children: React.ReactNode
}) {
	return (
		<SectionWrapper id={id} $bg={background}>
			<SectionInner>
				{title && <SectionHeading>{title}</SectionHeading>}
				{subtitle && <SectionSubtitle>{subtitle}</SectionSubtitle>}
				{children}
			</SectionInner>
		</SectionWrapper>
	)
}

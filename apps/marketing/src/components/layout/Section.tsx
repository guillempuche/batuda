import styled from 'styled-components'

const SectionWrapper = styled.section<{ $bg?: string }>`
	padding: var(--space-4xl) var(--page-gutter);
	background: ${p => p.$bg ?? 'transparent'};
`

const SectionInner = styled.div`
	max-width: var(--page-max-width);
	margin: 0 auto;
`

const SectionHeading = styled.h2`
	font-size: var(--typescale-headline-large-size);
	line-height: var(--typescale-headline-large-line);
	font-weight: var(--typescale-headline-large-weight);
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
	title,
	subtitle,
	background,
	children,
}: {
	title?: string
	subtitle?: string
	background?: string
	children: React.ReactNode
}) {
	return (
		<SectionWrapper $bg={background}>
			<SectionInner>
				{title && <SectionHeading>{title}</SectionHeading>}
				{subtitle && <SectionSubtitle>{subtitle}</SectionSubtitle>}
				{children}
			</SectionInner>
		</SectionWrapper>
	)
}

import styled from 'styled-components'

import type { RichTextInline, RichTextNode } from '@engranatge/ui/blocks'

import { Section } from '#/components/layout/section'

const Prose = styled.div`
	font-size: var(--typescale-body-large-size);
	line-height: var(--typescale-body-large-line);
	color: var(--color-on-surface);

	p {
		margin-bottom: var(--space-md);
	}

	a {
		color: var(--color-primary);
		text-decoration: underline;
	}

	strong {
		font-weight: var(--font-weight-bold);
	}

	em {
		font-style: italic;
	}
`

function renderInline(node: RichTextInline, key: string) {
	let el: React.ReactNode = node.text
	for (const mark of node.marks ?? []) {
		if (mark.type === 'bold') el = <strong>{el}</strong>
		else if (mark.type === 'italic') el = <em>{el}</em>
		else if (mark.type === 'link') {
			el = (
				<a
					href={mark.attrs.href}
					{...(mark.attrs.target !== undefined && {
						target: mark.attrs.target,
						rel: 'noopener noreferrer',
					})}
				>
					{el}
				</a>
			)
		}
	}
	return <span key={key}>{el}</span>
}

export function RichTextBlock({ node }: { node: RichTextNode }) {
	return (
		<Section>
			<Prose>
				{node.content.map(p => (
					<p
						key={`p-${(p.content ?? [])
							.map(c => c.text)
							.join('')
							.slice(0, 32)}`}
					>
						{(p.content ?? []).map(inline => renderInline(inline, inline.text))}
					</p>
				))}
			</Prose>
		</Section>
	)
}

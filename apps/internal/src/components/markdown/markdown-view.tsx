import { Streamdown } from 'streamdown'
import styled from 'styled-components'

export function MarkdownView({ source }: { readonly source: string }) {
	return (
		<Wrapper>
			<Streamdown
				urlTransform={url => {
					const trimmed = url.trim()
					if (/^(javascript|data|vbscript):/i.test(trimmed)) return ''
					return trimmed
				}}
			>
				{source}
			</Streamdown>
		</Wrapper>
	)
}

const Wrapper = styled.div.withConfig({ displayName: 'MarkdownView' })`
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	line-height: var(--typescale-body-medium-line);
	color: var(--color-on-surface);

	h1,
	h2,
	h3 {
		font-family: var(--font-display);
		letter-spacing: 0.04em;
		text-transform: uppercase;
		margin: var(--space-md) 0 var(--space-sm);
	}

	h1 {
		font-size: var(--typescale-headline-medium-size);
		line-height: var(--typescale-headline-medium-line);
	}

	h2 {
		font-size: var(--typescale-title-large-size);
		line-height: var(--typescale-title-large-line);
	}

	h3 {
		font-size: var(--typescale-title-medium-size);
		line-height: var(--typescale-title-medium-line);
	}

	p {
		margin: 0 0 var(--space-sm);
	}

	ul,
	ol {
		margin: 0 0 var(--space-sm);
		padding-left: var(--space-md);
	}

	li {
		margin: var(--space-3xs) 0;
	}

	code {
		font-family: var(--font-mono, ui-monospace, SFMono-Regular, monospace);
		font-size: 0.9em;
		background: color-mix(in oklab, var(--color-surface) 60%, black 4%);
		padding: 0 var(--space-3xs);
		border-radius: var(--shape-3xs);
	}

	pre {
		font-family: var(--font-mono, ui-monospace, SFMono-Regular, monospace);
		background: color-mix(in oklab, var(--color-surface) 60%, black 6%);
		padding: var(--space-sm);
		border-radius: var(--shape-2xs);
		overflow-x: auto;
		font-size: var(--typescale-body-small-size);
	}

	blockquote {
		margin: 0 0 var(--space-sm);
		padding-left: var(--space-sm);
		border-left: 3px solid var(--color-primary);
		font-style: italic;
		color: var(--color-on-surface-variant);
	}

	a {
		color: var(--color-primary);
		text-decoration: underline;
	}
`

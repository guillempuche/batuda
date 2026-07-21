import styled from 'styled-components'

/**
 * Multiline sibling of PriInput. Native `<textarea>` so styled-components
 * can target `:focus-visible` / `[data-invalid]` directly without a Base UI
 * wrapper (Base UI's `Input` is single-line).
 */
export const PriTextarea = styled.textarea.withConfig({
	displayName: 'PriTextarea',
})`
	width: 100%;
	padding: var(--space-xs) var(--space-sm);
	background: var(--color-paper-aged);
	color: var(--color-on-surface);
	border: none;
	border-bottom: 2px solid var(--color-outline);
	border-radius: 0;
	font-family: var(--font-body);
	font-size: var(--typescale-body-large-size);
	line-height: var(--typescale-body-large-line);
	letter-spacing: var(--typescale-body-large-tracking);
	box-shadow: inset 0 1px 2px var(--shadow-color-subtle);
	transition:
		border-color 160ms ease,
		background 160ms ease;
	resize: vertical;
	min-height: 4.5rem;

	&::placeholder {
		color: var(--color-on-surface-variant);
		opacity: 0.7;
		font-style: italic;
	}

	&:hover:not(:disabled) {
		border-bottom-color: var(--color-on-surface-variant);
	}

	&:focus,
	&:focus-visible {
		outline: none;
		border-bottom-color: var(--color-primary);
		background: var(--color-paper-aged-bright);
		box-shadow:
			inset 0 1px 2px var(--shadow-color-subtle),
			0 2px 0 -1px color-mix(in srgb, var(--color-primary) 40%, transparent);
	}

	&:disabled {
		opacity: 0.5;
		cursor: not-allowed;
		background: var(--color-surface-container);
	}

	&[data-invalid] {
		border-bottom-color: var(--color-error);
	}
`

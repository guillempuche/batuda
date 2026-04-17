import { useLingui } from '@lingui/react/macro'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Bold, Italic, List, ListOrdered, Strikethrough } from 'lucide-react'
import { useEffect } from 'react'
import styled from 'styled-components'

/**
 * Minimal Tiptap StarterKit editor for email composition. Emits
 * HTML + plain text on every change so the compose form can send
 * multipart messages. Internal state is uncontrolled — callers
 * pass `initialHtml` once; the editor tracks mutations from there.
 */
export function EmailComposer({
	initialHtml,
	onChange,
	placeholder,
}: {
	readonly initialHtml?: string
	readonly onChange: (html: string, text: string) => void
	readonly placeholder?: string
}) {
	const { t } = useLingui()
	const editor = useEditor({
		extensions: [StarterKit],
		content: initialHtml ?? '',
		immediatelyRender: false,
		editorProps: {
			attributes: {
				'data-placeholder': placeholder ?? t`Write your message…`,
			},
		},
		onUpdate: ({ editor }) => {
			onChange(editor.getHTML(), editor.getText())
		},
	})

	useEffect(
		() => () => {
			editor?.destroy()
		},
		[editor],
	)

	if (editor === null) {
		return (
			<Shell>
				<EditorSurface>
					<LoadingLine />
				</EditorSurface>
			</Shell>
		)
	}

	return (
		<Shell>
			<Toolbar role='toolbar' aria-label={t`Formatting`}>
				<ToolbarButton
					type='button'
					onClick={() => {
						editor.chain().focus().toggleBold().run()
					}}
					$active={editor.isActive('bold')}
					aria-pressed={editor.isActive('bold')}
					aria-label={t`Bold`}
				>
					<Bold size={14} aria-hidden />
				</ToolbarButton>
				<ToolbarButton
					type='button'
					onClick={() => {
						editor.chain().focus().toggleItalic().run()
					}}
					$active={editor.isActive('italic')}
					aria-pressed={editor.isActive('italic')}
					aria-label={t`Italic`}
				>
					<Italic size={14} aria-hidden />
				</ToolbarButton>
				<ToolbarButton
					type='button'
					onClick={() => {
						editor.chain().focus().toggleStrike().run()
					}}
					$active={editor.isActive('strike')}
					aria-pressed={editor.isActive('strike')}
					aria-label={t`Strikethrough`}
				>
					<Strikethrough size={14} aria-hidden />
				</ToolbarButton>
				<Separator aria-hidden />
				<ToolbarButton
					type='button'
					onClick={() => {
						editor.chain().focus().toggleBulletList().run()
					}}
					$active={editor.isActive('bulletList')}
					aria-pressed={editor.isActive('bulletList')}
					aria-label={t`Bullet list`}
				>
					<List size={14} aria-hidden />
				</ToolbarButton>
				<ToolbarButton
					type='button'
					onClick={() => {
						editor.chain().focus().toggleOrderedList().run()
					}}
					$active={editor.isActive('orderedList')}
					aria-pressed={editor.isActive('orderedList')}
					aria-label={t`Numbered list`}
				>
					<ListOrdered size={14} aria-hidden />
				</ToolbarButton>
			</Toolbar>
			<EditorSurface>
				<EditorContent editor={editor} />
			</EditorSurface>
		</Shell>
	)
}

const Shell = styled.div.withConfig({ displayName: 'EmailComposer' })`
	display: flex;
	flex-direction: column;
	flex: 1 1 auto;
	min-height: 0;
	border: 1px solid var(--color-outline);
	border-radius: var(--shape-xs);
	background: var(--color-surface);
	overflow: hidden;

	&:focus-within {
		border-color: var(--color-primary);
		box-shadow: 0 0 0 2px
			color-mix(in oklab, var(--color-primary) 30%, transparent);
	}
`

const Toolbar = styled.div.withConfig({ displayName: 'EmailComposerToolbar' })`
	display: flex;
	align-items: center;
	gap: var(--space-3xs);
	padding: var(--space-3xs) var(--space-2xs);
	border-bottom: 1px dashed var(--color-outline);
	background: color-mix(in oklab, var(--color-surface) 92%, transparent);
	flex-wrap: wrap;
`

const ToolbarButton = styled.button.withConfig({
	displayName: 'EmailComposerToolbarButton',
	shouldForwardProp: prop => prop !== '$active',
})<{ $active: boolean }>`
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 1.75rem;
	height: 1.75rem;
	padding: 0;
	border: 1px solid transparent;
	border-radius: var(--shape-2xs);
	background: ${p =>
		p.$active
			? 'color-mix(in oklab, var(--color-on-surface) 16%, transparent)'
			: 'transparent'};
	color: var(--color-on-surface);
	cursor: pointer;

	&:hover {
		background: color-mix(in oklab, var(--color-on-surface) 10%, transparent);
	}

	&:focus-visible {
		outline: none;
		border-color: var(--color-primary);
	}
`

const Separator = styled.span.withConfig({
	displayName: 'EmailComposerSeparator',
})`
	width: 1px;
	height: 18px;
	background: var(--color-outline);
	margin: 0 var(--space-3xs);
`

const EditorSurface = styled.div.withConfig({
	displayName: 'EmailComposerSurface',
})`
	flex: 1 1 auto;
	min-height: 140px;
	overflow-y: auto;
	padding: var(--space-sm);
	color: var(--color-on-surface);
	font-family: inherit;
	font-size: var(--typescale-body-medium-size);
	line-height: 1.55;

	.tiptap {
		min-height: 100%;
		outline: none;
	}

	.tiptap p {
		margin: 0 0 var(--space-2xs);
	}

	.tiptap p.is-editor-empty:first-child::before {
		content: attr(data-placeholder);
		color: var(--color-on-surface-variant);
		pointer-events: none;
		float: left;
		height: 0;
	}

	.tiptap ul,
	.tiptap ol {
		padding-left: var(--space-md);
		margin: 0 0 var(--space-2xs);
	}
`

const LoadingLine = styled.div.withConfig({
	displayName: 'EmailComposerLoadingLine',
})`
	height: 1rem;
	width: 40%;
	border-radius: var(--shape-2xs);
	background: color-mix(in oklab, var(--color-on-surface) 8%, transparent);
`

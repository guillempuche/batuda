import { useLingui } from '@lingui/react/macro'
import Link from '@tiptap/extension-link'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import {
	Bold,
	Code,
	Code2,
	Heading1,
	Heading2,
	Heading3,
	Italic,
	Link as LinkIcon,
	List,
	ListOrdered,
	Minus,
	Quote,
	Redo,
	Strikethrough,
	Undo,
	Unlink,
} from 'lucide-react'
import { useCallback, useEffect } from 'react'
import styled from 'styled-components'

/**
 * Tiptap editor for email composition. Emits HTML + plain text on every
 * change so the compose form can send multipart messages. Ships every
 * StarterKit node (headings 1–3, blockquote, inline/block code, lists,
 * horizontal rule, hard break, history) plus the Link mark so outbound
 * HTML survives through the server → AgentMail path unchanged.
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
		extensions: [
			StarterKit.configure({
				heading: { levels: [1, 2, 3] },
			}),
			Link.configure({
				openOnClick: false,
				autolink: true,
				protocols: ['http', 'https', 'mailto'],
				HTMLAttributes: {
					rel: 'noopener noreferrer',
					target: '_blank',
				},
			}),
		],
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

	const handleSetLink = useCallback(() => {
		if (editor === null) return
		const previousHref =
			typeof editor.getAttributes('link')['href'] === 'string'
				? (editor.getAttributes('link')['href'] as string)
				: ''
		const url = window.prompt(t`Link URL`, previousHref || 'https://')
		if (url === null) return
		if (url.trim() === '') {
			editor.chain().focus().extendMarkRange('link').unsetLink().run()
			return
		}
		editor
			.chain()
			.focus()
			.extendMarkRange('link')
			.setLink({ href: url.trim() })
			.run()
	}, [editor, t])

	const handleUnlink = useCallback(() => {
		if (editor === null) return
		editor.chain().focus().extendMarkRange('link').unsetLink().run()
	}, [editor])

	if (editor === null) {
		return (
			<Shell>
				<EditorSurface>
					<LoadingLine />
				</EditorSurface>
			</Shell>
		)
	}

	const linkActive = editor.isActive('link')

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
				<ToolbarButton
					type='button'
					onClick={() => {
						editor.chain().focus().toggleCode().run()
					}}
					$active={editor.isActive('code')}
					aria-pressed={editor.isActive('code')}
					aria-label={t`Inline code`}
				>
					<Code size={14} aria-hidden />
				</ToolbarButton>

				<Separator aria-hidden />

				<ToolbarButton
					type='button'
					onClick={handleSetLink}
					$active={linkActive}
					aria-pressed={linkActive}
					aria-label={linkActive ? t`Edit link` : t`Add link`}
				>
					<LinkIcon size={14} aria-hidden />
				</ToolbarButton>
				<ToolbarButton
					type='button'
					onClick={handleUnlink}
					$active={false}
					disabled={!linkActive}
					aria-label={t`Remove link`}
				>
					<Unlink size={14} aria-hidden />
				</ToolbarButton>

				<Separator aria-hidden />

				<ToolbarButton
					type='button'
					onClick={() => {
						editor.chain().focus().toggleHeading({ level: 1 }).run()
					}}
					$active={editor.isActive('heading', { level: 1 })}
					aria-pressed={editor.isActive('heading', { level: 1 })}
					aria-label={t`Heading 1`}
				>
					<Heading1 size={14} aria-hidden />
				</ToolbarButton>
				<ToolbarButton
					type='button'
					onClick={() => {
						editor.chain().focus().toggleHeading({ level: 2 }).run()
					}}
					$active={editor.isActive('heading', { level: 2 })}
					aria-pressed={editor.isActive('heading', { level: 2 })}
					aria-label={t`Heading 2`}
				>
					<Heading2 size={14} aria-hidden />
				</ToolbarButton>
				<ToolbarButton
					type='button'
					onClick={() => {
						editor.chain().focus().toggleHeading({ level: 3 }).run()
					}}
					$active={editor.isActive('heading', { level: 3 })}
					aria-pressed={editor.isActive('heading', { level: 3 })}
					aria-label={t`Heading 3`}
				>
					<Heading3 size={14} aria-hidden />
				</ToolbarButton>

				<Separator aria-hidden />

				<ToolbarButton
					type='button'
					onClick={() => {
						editor.chain().focus().toggleBlockquote().run()
					}}
					$active={editor.isActive('blockquote')}
					aria-pressed={editor.isActive('blockquote')}
					aria-label={t`Quote`}
				>
					<Quote size={14} aria-hidden />
				</ToolbarButton>
				<ToolbarButton
					type='button'
					onClick={() => {
						editor.chain().focus().toggleCodeBlock().run()
					}}
					$active={editor.isActive('codeBlock')}
					aria-pressed={editor.isActive('codeBlock')}
					aria-label={t`Code block`}
				>
					<Code2 size={14} aria-hidden />
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

				<Separator aria-hidden />

				<ToolbarButton
					type='button'
					onClick={() => {
						editor.chain().focus().setHorizontalRule().run()
					}}
					$active={false}
					aria-label={t`Horizontal rule`}
				>
					<Minus size={14} aria-hidden />
				</ToolbarButton>

				<Separator aria-hidden />

				<ToolbarButton
					type='button'
					onClick={() => {
						editor.chain().focus().undo().run()
					}}
					$active={false}
					disabled={!editor.can().undo()}
					aria-label={t`Undo`}
				>
					<Undo size={14} aria-hidden />
				</ToolbarButton>
				<ToolbarButton
					type='button'
					onClick={() => {
						editor.chain().focus().redo().run()
					}}
					$active={false}
					disabled={!editor.can().redo()}
					aria-label={t`Redo`}
				>
					<Redo size={14} aria-hidden />
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

	&:hover:not(:disabled) {
		background: color-mix(in oklab, var(--color-on-surface) 10%, transparent);
	}

	&:focus-visible {
		outline: none;
		border-color: var(--color-primary);
	}

	&:disabled {
		opacity: 0.4;
		cursor: not-allowed;
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

	.tiptap h1,
	.tiptap h2,
	.tiptap h3 {
		font-family: var(--font-display);
		line-height: 1.25;
		margin: var(--space-xs) 0 var(--space-2xs);
		color: var(--color-on-surface);
	}

	.tiptap h1 {
		font-size: var(--typescale-title-large-size, 1.5rem);
	}

	.tiptap h2 {
		font-size: var(--typescale-title-medium-size, 1.25rem);
	}

	.tiptap h3 {
		font-size: var(--typescale-title-small-size, 1.1rem);
	}

	.tiptap ul,
	.tiptap ol {
		padding-left: var(--space-md);
		margin: 0 0 var(--space-2xs);
	}

	.tiptap blockquote {
		margin: 0 0 var(--space-2xs);
		padding: var(--space-2xs) var(--space-sm);
		border-left: 3px solid var(--color-outline);
		color: var(--color-on-surface-variant);
		font-style: italic;
	}

	.tiptap code {
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 0.9em;
		padding: 0.1em 0.3em;
		border-radius: var(--shape-2xs);
		background: color-mix(in oklab, var(--color-on-surface) 8%, transparent);
	}

	.tiptap pre {
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 0.9em;
		margin: 0 0 var(--space-2xs);
		padding: var(--space-xs) var(--space-sm);
		border-radius: var(--shape-xs);
		background: color-mix(in oklab, var(--color-on-surface) 6%, transparent);
		overflow-x: auto;
	}

	.tiptap pre code {
		background: transparent;
		padding: 0;
		border-radius: 0;
		font-size: inherit;
	}

	.tiptap hr {
		border: 0;
		border-top: 1px dashed var(--color-outline);
		margin: var(--space-sm) 0;
	}

	.tiptap a {
		color: var(--color-primary);
		text-decoration: underline;
		text-underline-offset: 2px;
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

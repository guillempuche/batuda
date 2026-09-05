import { useLingui } from '@lingui/react/macro'
import { Markdown } from '@tiptap/markdown'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import {
	Bold,
	Code,
	Heading1,
	Heading2,
	Italic,
	List,
	ListOrdered,
	Quote,
	Strikethrough,
} from 'lucide-react'
import { styled } from 'next-yak'
import { useState } from 'react'

import { PriToolbar } from '@batuda/ui/pri'

/**
 * Markdown rich-text editor. TipTap (StarterKit + the Markdown extension) round-
 * trips a plain markdown **string** — `defaultValue` in, `getMarkdown()` out —
 * so callers store and submit markdown text, not a JSON document.
 *
 * Uncontrolled by design: the value lives in the editor, and a hidden `<input>`
 * (when `name` is set) mirrors the current markdown so a plain `FormData` submit
 * reads it, matching the app's other dialog fields. `onChange` is a read-only
 * notification (e.g. dirty tracking); it never drives the value, so programmatic
 * fills into the contenteditable are preserved.
 *
 * The toolbar wraps on narrow widths and the content area scrolls within a
 * bounded height, so the editor adapts to small screens without overflowing its
 * container.
 */
export function PriRichText({
	name,
	defaultValue,
	onChange,
	placeholder,
	id,
	ariaLabel,
	ariaDescribedby,
	disabled = false,
	testId,
}: {
	readonly name?: string
	/** Initial content as a markdown string. */
	readonly defaultValue?: string
	/** Notified with the current markdown on every edit. Read-only. */
	readonly onChange?: (markdown: string) => void
	readonly placeholder?: string
	readonly id?: string
	readonly ariaLabel?: string
	readonly ariaDescribedby?: string
	readonly disabled?: boolean
	readonly testId?: string
}) {
	const { t } = useLingui()
	const [markdown, setMarkdown] = useState(defaultValue ?? '')

	const editor = useEditor({
		extensions: [StarterKit, Markdown],
		content: defaultValue ?? '',
		// The Markdown extension reads the initial `content` as markdown text.
		contentType: 'markdown',
		editable: !disabled,
		// apps/internal server-renders; deferring the first paint avoids a
		// hydration mismatch on the contenteditable.
		immediatelyRender: false,
		editorProps: {
			attributes: {
				role: 'textbox',
				'aria-multiline': 'true',
				// A disabled editor is non-editable; tell assistive tech so it isn't
				// announced as an editable field that silently rejects input.
				...(disabled ? { 'aria-readonly': 'true' } : {}),
				...(id ? { id } : {}),
				...(ariaLabel ? { 'aria-label': ariaLabel } : {}),
				...(ariaDescribedby ? { 'aria-describedby': ariaDescribedby } : {}),
				...(testId ? { 'data-testid': testId } : {}),
			},
		},
		onUpdate: ({ editor }) => {
			const next = editor.getMarkdown()
			setMarkdown(next)
			onChange?.(next)
		},
	})

	// Reactive marks/nodes state so the toolbar reflects the caret position.
	const active = useEditorState({
		editor,
		selector: ({ editor }) =>
			editor
				? {
						bold: editor.isActive('bold'),
						italic: editor.isActive('italic'),
						strike: editor.isActive('strike'),
						h1: editor.isActive('heading', { level: 1 }),
						h2: editor.isActive('heading', { level: 2 }),
						bulletList: editor.isActive('bulletList'),
						orderedList: editor.isActive('orderedList'),
						blockquote: editor.isActive('blockquote'),
						code: editor.isActive('code'),
						empty: editor.isEmpty,
					}
				: null,
	})

	return (
		<Shell data-disabled={disabled ? 'true' : undefined}>
			<EditorToolbar aria-label={t`Text formatting`}>
				<ToolButton
					label={t`Bold`}
					icon={<Bold size={15} aria-hidden />}
					pressed={active?.bold ?? false}
					disabled={disabled}
					onClick={() => editor?.chain().focus().toggleBold().run()}
				/>
				<ToolButton
					label={t`Italic`}
					icon={<Italic size={15} aria-hidden />}
					pressed={active?.italic ?? false}
					disabled={disabled}
					onClick={() => editor?.chain().focus().toggleItalic().run()}
				/>
				<ToolButton
					label={t`Strikethrough`}
					icon={<Strikethrough size={15} aria-hidden />}
					pressed={active?.strike ?? false}
					disabled={disabled}
					onClick={() => editor?.chain().focus().toggleStrike().run()}
				/>
				<ToolButton
					label={t`Heading 1`}
					icon={<Heading1 size={15} aria-hidden />}
					pressed={active?.h1 ?? false}
					disabled={disabled}
					onClick={() =>
						editor?.chain().focus().toggleHeading({ level: 1 }).run()
					}
				/>
				<ToolButton
					label={t`Heading 2`}
					icon={<Heading2 size={15} aria-hidden />}
					pressed={active?.h2 ?? false}
					disabled={disabled}
					onClick={() =>
						editor?.chain().focus().toggleHeading({ level: 2 }).run()
					}
				/>
				<ToolButton
					label={t`Bullet list`}
					icon={<List size={15} aria-hidden />}
					pressed={active?.bulletList ?? false}
					disabled={disabled}
					onClick={() => editor?.chain().focus().toggleBulletList().run()}
				/>
				<ToolButton
					label={t`Numbered list`}
					icon={<ListOrdered size={15} aria-hidden />}
					pressed={active?.orderedList ?? false}
					disabled={disabled}
					onClick={() => editor?.chain().focus().toggleOrderedList().run()}
				/>
				<ToolButton
					label={t`Quote`}
					icon={<Quote size={15} aria-hidden />}
					pressed={active?.blockquote ?? false}
					disabled={disabled}
					onClick={() => editor?.chain().focus().toggleBlockquote().run()}
				/>
				<ToolButton
					label={t`Code`}
					icon={<Code size={15} aria-hidden />}
					pressed={active?.code ?? false}
					disabled={disabled}
					onClick={() => editor?.chain().focus().toggleCode().run()}
				/>
			</EditorToolbar>

			<Content>
				{(active?.empty ?? markdown.length === 0) && placeholder ? (
					<Placeholder aria-hidden>{placeholder}</Placeholder>
				) : null}
				<EditorContent editor={editor} />
			</Content>

			{name ? <input type='hidden' name={name} value={markdown} /> : null}
		</Shell>
	)
}

function ToolButton({
	label,
	icon,
	pressed,
	disabled,
	onClick,
}: {
	readonly label: string
	readonly icon: React.ReactNode
	readonly pressed: boolean
	readonly disabled: boolean
	readonly onClick: () => void
}) {
	return (
		<IconToolButton
			type='button'
			aria-label={label}
			aria-pressed={pressed}
			data-active={pressed ? 'true' : undefined}
			disabled={disabled}
			// Keep focus in the editor so the toolbar click doesn't blur the
			// selection before the command runs.
			onMouseDown={event => event.preventDefault()}
			onClick={onClick}
		>
			{icon}
		</IconToolButton>
	)
}

const Shell = styled.div`
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
	min-height: 0;

	/* Fill the height a flex parent gives us (the mobile sheet) so the body,
	 * not the chrome, owns the screen. Inert in a normal-flow desktop dialog. */
	@media (max-width: 40rem) {
		flex: 1;
	}

	&[data-disabled='true'] {
		opacity: 0.5;
	}
`

// The shared tool rail is a single non-wrapping row; on desktop let this editor's
// buttons wrap onto a second line so a narrow window never clips them. On phones
// wrapping would steal height from the body, so the rail becomes one row that
// scrolls sideways instead. `min-height` drops to auto so a wrapped rail fits.
const EditorToolbar = styled(PriToolbar.Root)`
	flex-wrap: wrap;
	min-height: auto;
	/* The shared rail's side padding is generous; trim it so the full set of
	 * buttons fits one row in the dialog instead of wrapping the last one. */
	padding-inline: var(--space-sm);

	@media (max-width: 40rem) {
		flex-wrap: nowrap;
		overflow-x: auto;
		scrollbar-width: none;

		&::-webkit-scrollbar {
			display: none;
		}
	}
`

const IconToolButton = styled.button`
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 1.9rem;
	height: 1.9rem;
	padding: 0;
	background: transparent;
	border: 1px solid transparent;
	border-radius: var(--shape-2xs);
	color: var(--color-on-surface);
	cursor: pointer;
	flex-shrink: 0;

	/* Touch needs a 44px hit target; grow the button on coarse pointers. */
	@media (pointer: coarse) {
		width: 2.75rem;
		height: 2.75rem;
	}
	transition:
		background 120ms ease,
		border-color 120ms ease,
		color 120ms ease;

	&:hover:not(:disabled) {
		background: var(--highlight-inset);
		border-color: var(--color-metal-edge);
	}

	&:focus-visible {
		outline: none;
		box-shadow: var(--glow-active);
	}

	&:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	&[data-active='true'] {
		background: var(--highlight-inset);
		border-color: var(--color-metal-edge);
		color: var(--color-primary);
	}
`

const Content = styled.div`
	position: relative;
	background: var(--color-paper-aged);
	border: none;
	border-bottom: 2px solid var(--color-outline);
	box-shadow: inset 0 1px 2px var(--shadow-color-subtle);
	transition: border-color 160ms ease;

	&:focus-within {
		border-bottom-color: var(--color-primary);
	}

	/* On the phone sheet the editor fills the remaining height and scrolls
	 * inside itself, rather than capping at 40vh, so the body gets the screen.
	 * EditorContent renders an unstyled wrapper div between here and .tiptap, so
	 * it has to flex too or it would collapse the editor to its min-height. */
	@media (max-width: 40rem) {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;

		& > div {
			flex: 1;
			min-height: 0;
			display: flex;
			flex-direction: column;
		}

		.tiptap {
			/* Small floor on mobile so the editor can shrink under the on-screen
			 * keyboard instead of pushing the footer off the sheet. */
			min-height: 8rem;
			max-height: none;
			flex: 1;
		}
	}

	.tiptap {
		min-height: 14rem;
		max-height: 40vh;
		overflow-y: auto;
		padding: var(--space-xs) var(--space-sm);
		font-family: var(--font-body);
		font-size: var(--typescale-body-large-size);
		line-height: var(--typescale-body-large-line);
		color: var(--color-on-surface);
		outline: none;
		overflow-wrap: anywhere;
	}

	.tiptap :first-child {
		margin-top: 0;
	}

	.tiptap h1 {
		font-family: var(--font-display);
		font-size: var(--typescale-title-large-size);
		line-height: var(--typescale-title-large-line);
		margin: var(--space-sm) 0 var(--space-2xs);
	}

	.tiptap h2 {
		font-family: var(--font-display);
		font-size: var(--typescale-title-medium-size);
		line-height: var(--typescale-title-medium-line);
		margin: var(--space-sm) 0 var(--space-2xs);
	}

	.tiptap p {
		margin: var(--space-2xs) 0;
	}

	.tiptap ul,
	.tiptap ol {
		margin: var(--space-2xs) 0;
		padding-left: var(--space-lg);
	}

	.tiptap blockquote {
		margin: var(--space-2xs) 0;
		padding-left: var(--space-sm);
		border-left: 3px solid var(--color-outline);
		color: var(--color-on-surface-variant);
	}

	.tiptap code {
		font-family: var(--font-mono, monospace);
		font-size: 0.9em;
		padding: 0.1em 0.3em;
		border-radius: var(--shape-3xs, 2px);
		background: color-mix(in oklab, var(--color-on-surface) 8%, transparent);
	}

	.tiptap a {
		color: var(--color-primary);
		text-decoration: underline;
	}
`

const Placeholder = styled.span`
	position: absolute;
	top: var(--space-xs);
	left: var(--space-sm);
	pointer-events: none;
	font-family: var(--font-body);
	font-size: var(--typescale-body-large-size);
	line-height: var(--typescale-body-large-line);
	color: var(--color-on-surface-variant);
	opacity: 0.7;
	font-style: italic;
`

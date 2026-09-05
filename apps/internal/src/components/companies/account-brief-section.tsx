import { Trans, useLingui } from '@lingui/react/macro'
import { ChevronRight, Eye, NotebookPen, Pencil } from 'lucide-react'
import { css, styled } from 'next-yak'
import { useState } from 'react'

import { PriButton, PriCollapsible, PriTextarea } from '@batuda/ui/pri'

import { MarkdownView } from '#/components/markdown/markdown-view'
import { agedPaperSurface, stenciledTitle } from '#/lib/workshop-mixins'

export type AccountBriefCompany = {
	readonly accountBrief: string | null
}

/**
 * The account's running notes. Saving replaces whatever was there, and no
 * earlier version is kept. Who else writes them is in docs/architecture.md.
 *
 * Editing is a plain textarea of markdown rather than a rich editor, because
 * what research writes is markdown too — keeping one format means a person and
 * a run are always writing the same kind of thing into the same page. The
 * preview is there so nobody has to read their own markup to check it.
 */
export function AccountBriefSection({
	company,
	onSave,
}: {
	readonly company: AccountBriefCompany
	readonly onSave: (field: string, next: unknown) => Promise<void>
}) {
	const { t } = useLingui()
	const [editing, setEditing] = useState(false)
	const [draft, setDraft] = useState('')
	const [previewing, setPreviewing] = useState(false)
	const [saving, setSaving] = useState(false)
	const [expanded, setExpanded] = useState(false)

	const brief = company.accountBrief ?? ''
	// A brief long enough to bury what sits under it is folded to a readable
	// height; the reader opens it when it is the thing they came for.
	const isLong = brief.length > LONG_BRIEF_CHARS

	const startEditing = () => {
		setDraft(brief)
		setPreviewing(false)
		setEditing(true)
	}

	// A rejected save has already put a message on screen, and the editor stays
	// open holding the text. Letting it reject on would only add an unhandled
	// rejection to the console for something already dealt with.
	const save = async () => {
		setSaving(true)
		try {
			await onSave('accountBrief', draft)
			setEditing(false)
		} catch {
			// Handled by the caller's toast.
		} finally {
			setSaving(false)
		}
	}

	return (
		<PriCollapsible.Root defaultOpen>
			<TriggerWrap>
				<PriCollapsible.Trigger data-testid='company-brief-trigger'>
					<ChevronRight size={14} aria-hidden />
					<NotebookPen size={14} aria-hidden />
					<Trans>Account brief</Trans>
				</PriCollapsible.Trigger>
			</TriggerWrap>
			<PriCollapsible.Panel>
				<Body data-testid='company-brief-panel'>
					{editing ? (
						<>
							<EditorToolbar>
								<ModeToggle
									type='button'
									$active={!previewing}
									onClick={() => setPreviewing(false)}
									data-testid='company-brief-mode-write'
								>
									<Pencil size={12} aria-hidden />
									<Trans>Write</Trans>
								</ModeToggle>
								<ModeToggle
									type='button'
									$active={previewing}
									onClick={() => setPreviewing(true)}
									data-testid='company-brief-mode-preview'
								>
									<Eye size={12} aria-hidden />
									<Trans>Preview</Trans>
								</ModeToggle>
							</EditorToolbar>
							{previewing ? (
								<Preview data-testid='company-brief-preview'>
									{draft.trim() === '' ? (
										<Empty>
											<Trans>Nothing to preview yet.</Trans>
										</Empty>
									) : (
										<MarkdownView source={draft} />
									)}
								</Preview>
							) : (
								<PriTextarea
									aria-label={t`Account brief`}
									value={draft}
									onChange={event => setDraft(event.target.value)}
									rows={18}
									data-testid='company-brief-editor'
								/>
							)}
							<Actions>
								<PriButton
									type='button'
									$variant='outlined'
									onClick={() => setEditing(false)}
									disabled={saving}
									data-testid='company-brief-cancel'
								>
									<Trans>Cancel</Trans>
								</PriButton>
								<PriButton
									type='button'
									onClick={() => void save()}
									disabled={saving}
									data-testid='company-brief-save'
								>
									<Trans>Save</Trans>
								</PriButton>
							</Actions>
						</>
					) : brief === '' ? (
						<>
							<Empty data-testid='company-brief-empty'>
								<Trans>
									No brief yet. Research writes one here, or you can start it
									yourself.
								</Trans>
							</Empty>
							<Footer>
								<PriButton
									type='button'
									$variant='outlined'
									onClick={startEditing}
									data-testid='company-brief-edit'
								>
									<Trans>Write a brief</Trans>
								</PriButton>
							</Footer>
						</>
					) : (
						<>
							<Rendered
								data-testid='company-brief-view'
								$folded={isLong && !expanded}
							>
								<MarkdownView source={brief} />
							</Rendered>
							{isLong && (
								<FoldToggle
									type='button'
									onClick={() => setExpanded(e => !e)}
									data-testid='company-brief-fold'
								>
									{expanded ? (
										<Trans>Show less</Trans>
									) : (
										<Trans>Show more</Trans>
									)}
								</FoldToggle>
							)}
							<Footer>
								<PriButton
									type='button'
									$variant='outlined'
									onClick={startEditing}
									data-testid='company-brief-edit'
								>
									<Trans>Edit</Trans>
								</PriButton>
							</Footer>
						</>
					)}
				</Body>
			</PriCollapsible.Panel>
		</PriCollapsible.Root>
	)
}

// Roughly the length at which a brief stops being a glance and starts being a
// document — about a screenful of prose.
const LONG_BRIEF_CHARS = 700

const TriggerWrap = styled.div`
	display: flex;
	justify-content: flex-start;
`

const Body = styled.div`
	${agedPaperSurface}
	display: flex;
	flex-direction: column;
	gap: var(--space-sm);
	padding: var(--space-md);
	margin-top: var(--space-sm);
`

const Rendered = styled.div<{ $folded: boolean }>`
	font-size: var(--typescale-body-medium-size);
	color: var(--color-on-surface);
	/* Prose, so it is held to a line length that can be read rather than to
	 * whatever the column happens to be. */
	max-width: 68ch;

	${p =>
		p.$folded &&
		css`
			max-height: 22rem;
			overflow: hidden;
			mask-image: linear-gradient(to bottom, black 70%, transparent 100%);
		`}
`

const Empty = styled.p`
	margin: 0;
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface-variant);
`

const Preview = styled.div`
	${agedPaperSurface}
	max-width: 68ch;
	min-height: 12rem;
	padding: var(--space-sm);
	border-radius: var(--shape-2xs);
	font-size: var(--typescale-body-medium-size);
	color: var(--color-on-surface);
`

const EditorToolbar = styled.div`
	display: flex;
	gap: var(--space-3xs);
`

const ModeToggle = styled.button<{ $active: boolean }>`
	${stenciledTitle}
	display: inline-flex;
	align-items: center;
	gap: var(--space-3xs);
	min-block-size: 2.75rem;
	padding: var(--space-3xs) var(--space-sm);
	border: 1px solid
		${p => (p.$active ? 'var(--color-primary)' : 'var(--color-outline-variant)')};
	border-radius: var(--shape-2xs);
	background: ${p => (p.$active ? 'var(--color-primary)' : 'transparent')};
	color: ${p =>
		p.$active ? 'var(--color-on-primary)' : 'var(--color-on-surface-variant)'};
	font-size: var(--typescale-label-small-size);
	cursor: pointer;

	&:focus-visible {
		outline: none;
		box-shadow: var(--glow-active);
	}
`

const FoldToggle = styled.button`
	${stenciledTitle}
	align-self: flex-start;
	min-block-size: 2.75rem;
	padding: 0;
	border: none;
	background: transparent;
	font-size: var(--typescale-label-small-size);
	color: var(--color-primary);
	cursor: pointer;

	&:hover {
		text-decoration: underline;
	}

	&:focus-visible {
		outline: none;
		box-shadow: var(--glow-active);
	}
`

const Footer = styled.div`
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: flex-end;
	gap: var(--space-sm);
`

const Actions = styled.div`
	display: flex;
	justify-content: flex-end;
	gap: var(--space-sm);
`

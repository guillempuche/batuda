import { useAtomSet } from '@effect/atom-react'
import { Trans, useLingui } from '@lingui/react/macro'
import { X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import styled from 'styled-components'

import { PriButton, PriDialog, PriInput } from '@batuda/ui/pri'

import {
	createTemplateAtom,
	updateTemplateAtom,
} from '#/atoms/instruction-atoms'
import { PriRichText } from '#/components/primitives/pri-rich-text'
import { stenciledTitle } from '#/lib/workshop-mixins'

export type TemplateDraft = {
	readonly id: string
	readonly name: string
	readonly body: string
}

// Create a personal template, or edit an existing one. The body is a markdown
// rich-text field (PriRichText) whose value round-trips as a plain markdown
// string. Fields stay uncontrolled and read from FormData on submit, matching
// the app's other dialogs (BaseUI's controlled value+onChange silently drops
// programmatic fills, so FormData is the reliable read); the editor mirrors its
// markdown into a hidden input for the same reason.
export function TemplateEditorDialog({
	open,
	onOpenChange,
	editing,
	onSaved,
	scope = 'personal',
}: {
	readonly open: boolean
	readonly onOpenChange: (next: boolean) => void
	// null = create a new template; set = edit an existing one.
	readonly editing: TemplateDraft | null
	readonly onSaved: () => void
	// New templates are personal unless an admin creates an org-owned one.
	readonly scope?: 'personal' | 'org'
}) {
	const { t } = useLingui()
	const createTemplate = useAtomSet(createTemplateAtom, { mode: 'promiseExit' })
	const updateTemplate = useAtomSet(updateTemplateAtom, { mode: 'promiseExit' })
	const [submitting, setSubmitting] = useState(false)
	const [errorMessage, setErrorMessage] = useState<string | null>(null)
	// A close (Esc, backdrop, Cancel, browser Back) confirms first when the user
	// has typed something, so a stray navigation can't drop their draft.
	const dirtyRef = useRef(false)
	const [confirmDiscard, setConfirmDiscard] = useState(false)
	const keepEditingRef = useRef<HTMLButtonElement>(null)

	// Reseed guard state whenever the dialog reopens or retargets a row. `editing`
	// and `open` gate the reset but aren't read in the body, so Biome can't infer
	// them as deps.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset must re-run when the dialog reopens or switches target
	useEffect(() => {
		dirtyRef.current = false
		setConfirmDiscard(false)
		setErrorMessage(null)
		// A successful save returns early without clearing this, so reset it here;
		// otherwise the reopened dialog shows a disabled "Saving…" button.
		setSubmitting(false)
	}, [editing, open])

	// The discard prompt is a blocking alert; move focus to the safe choice so
	// keyboard and screen-reader users land on it — and don't lose focus to the
	// body when the Cancel button that opened it unmounts.
	useEffect(() => {
		if (confirmDiscard) keepEditingRef.current?.focus()
	}, [confirmDiscard])

	const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		const form = new FormData(event.currentTarget)
		const name = String(form.get('name') ?? '').trim()
		const body = String(form.get('body') ?? '').trim()
		if (name.length === 0 || body.length === 0) {
			setErrorMessage(t`Add a name and instructions before saving.`)
			return
		}
		setSubmitting(true)
		setErrorMessage(null)
		const exit =
			editing === null
				? await createTemplate({
						payload: { name, body, scope },
					} as never)
				: await updateTemplate({
						params: { id: editing.id },
						payload: { name, body },
					} as never)
		if (exit._tag === 'Success') {
			// Saved changes aren't unsaved — close straight past the guard.
			dirtyRef.current = false
			onSaved()
			onOpenChange(false)
			return
		}
		setErrorMessage(t`Could not save the template. Please try again.`)
		setSubmitting(false)
	}

	// Intercepts every user-initiated close so a dirty draft prompts first.
	const handleRootOpenChange = (next: boolean) => {
		if (next) {
			onOpenChange(true)
			return
		}
		if (dirtyRef.current) {
			setConfirmDiscard(true)
			return
		}
		onOpenChange(false)
	}

	const discardAndClose = () => {
		dirtyRef.current = false
		setConfirmDiscard(false)
		onOpenChange(false)
	}

	return (
		<PriDialog.Root open={open} onOpenChange={handleRootOpenChange}>
			<PriDialog.Portal>
				<PriDialog.Backdrop />
				<PriDialog.Popup mobile='sheet' data-testid='template-editor-dialog'>
					<Header>
						<PriDialog.Title>
							<Heading>
								{editing !== null ? (
									<Trans>Edit template</Trans>
								) : scope === 'org' ? (
									<Trans>New org template</Trans>
								) : (
									<Trans>New template</Trans>
								)}
							</Heading>
						</PriDialog.Title>
						<PriDialog.Close
							render={props => (
								<CloseButton type='button' aria-label={t`Close`} {...props}>
									<X size={18} aria-hidden />
								</CloseButton>
							)}
						/>
					</Header>

					<PriDialog.Description
						render={props => (
							<Description {...props}>
								{scope === 'org' ? (
									<Trans>
										Shared with everyone in your organization — their research
										agent follows it on every run.
									</Trans>
								) : (
									<Trans>
										Standing guidance your research agent follows on every run.
									</Trans>
								)}
							</Description>
						)}
					/>

					{/* key remounts the fields so defaultValue reseeds for each target */}
					<Form
						key={editing?.id ?? 'new'}
						onSubmit={handleSubmit}
						data-testid='template-editor-form'
					>
						<Field>
							<Label htmlFor='template-name'>
								<Trans>Name</Trans>
							</Label>
							<PriInput
								id='template-name'
								name='name'
								data-testid='template-editor-name'
								defaultValue={editing?.name ?? ''}
								placeholder={t`e.g. [research] Spain hospitality sourcing`}
								aria-describedby='template-name-hint'
								onChange={() => {
									dirtyRef.current = true
								}}
								required
							/>
							<HelpText id='template-name-hint'>
								<Trans>
									A short label. Start it with a [tag] like [research] to group
									related templates if you like — the brackets are just part of
									the name.
								</Trans>
							</HelpText>
						</Field>

						<EditorField>
							<Label htmlFor='template-body'>
								<Trans>Instructions</Trans>
							</Label>
							<PriRichText
								id='template-body'
								name='body'
								testId='template-editor-body'
								defaultValue={editing?.body ?? ''}
								ariaLabel={t`Instructions`}
								placeholder={t`Standing guidance the agent should follow on every run…`}
								onChange={() => {
									dirtyRef.current = true
								}}
							/>
						</EditorField>

						{errorMessage !== null ? (
							<ErrorBanner role='alert'>{errorMessage}</ErrorBanner>
						) : null}

						{confirmDiscard ? (
							<DiscardBar
								role='alertdialog'
								aria-label={t`Unsaved changes`}
								aria-describedby='template-discard-desc'
							>
								<DiscardText id='template-discard-desc'>
									<Trans>Discard your unsaved changes?</Trans>
								</DiscardText>
								<DiscardActions>
									<PriButton
										ref={keepEditingRef}
										type='button'
										$variant='text'
										onClick={() => setConfirmDiscard(false)}
									>
										<Trans>Keep editing</Trans>
									</PriButton>
									<PriButton
										type='button'
										$variant='destructive'
										data-testid='template-editor-discard'
										onClick={discardAndClose}
									>
										<Trans>Discard</Trans>
									</PriButton>
								</DiscardActions>
							</DiscardBar>
						) : (
							<Footer>
								<PriButton
									type='submit'
									$variant='filled'
									data-testid='template-editor-submit'
									disabled={submitting}
								>
									{submitting ? <Trans>Saving…</Trans> : <Trans>Save</Trans>}
								</PriButton>
								<PriDialog.Close
									render={props => (
										<PriButton type='button' $variant='text' {...props}>
											<Trans>Cancel</Trans>
										</PriButton>
									)}
								/>
							</Footer>
						)}
					</Form>
				</PriDialog.Popup>
			</PriDialog.Portal>
		</PriDialog.Root>
	)
}

const Header = styled.div`
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	gap: var(--space-sm);
`

const Heading = styled.span`
	${stenciledTitle}
	font-size: var(--typescale-title-large-size);
	line-height: var(--typescale-title-large-line);
`

const Description = styled.p`
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface-variant);
	margin: var(--space-3xs) 0 0;

	/* While the keyboard is open on the phone sheet, this context line is dead
	 * weight — drop it so the editor gets the height back. */
	@media (max-width: 40rem) {
		[data-keyboard='open'] & {
			display: none;
		}
	}
`

const CloseButton = styled.button`
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 1.75rem;
	height: 1.75rem;
	padding: 0;

	/* Bigger tap target on touch, matching the editor toolbar. */
	@media (pointer: coarse) {
		width: 2.75rem;
		height: 2.75rem;
	}
	border: none;
	border-radius: var(--shape-2xs);
	background: transparent;
	color: var(--color-on-surface-variant);
	cursor: pointer;

	&:hover {
		background: color-mix(in oklab, var(--color-on-surface) 12%, transparent);
		color: var(--color-on-surface);
	}

	&:focus-visible {
		outline: none;
		box-shadow: var(--glow-active);
	}
`

const Form = styled.form`
	display: flex;
	flex-direction: column;
	gap: var(--space-md);

	/* On the phone sheet the form fills the popup so its editor field can grow
	 * to take the screen and the actions settle at the bottom. It also becomes
	 * the scroll fallback: if the keyboard shrinks the sheet below what the
	 * chrome + editor + footer need, the form scrolls under the sticky footer
	 * instead of the footer colliding with the editor. */
	@media (max-width: 40rem) {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
	}
`

const Field = styled.div`
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
`

// The instructions field holds the editor; on the phone sheet it grows to fill
// the height the shorter fields leave behind so reading/editing gets the room.
const EditorField = styled(Field)`
	@media (max-width: 40rem) {
		flex: 1;
		min-height: 0;
	}
`

const Label = styled.label`
	${stenciledTitle}
	font-size: var(--typescale-label-small-size);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--color-on-surface-variant);
`

const HelpText = styled.p`
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface-variant);
	margin: 0;

	/* The field placeholder carries the gist; drop the long hint on the phone
	 * sheet so the editor body gets the reclaimed height. */
	@media (max-width: 40rem) {
		display: none;
	}
`

const ErrorBanner = styled.div`
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	color: var(--color-error);
	padding: var(--space-2xs) var(--space-sm);
	border: 1px solid var(--color-error);
	border-radius: var(--shape-2xs);
`

const Footer = styled.div`
	display: flex;
	gap: var(--space-sm);
	justify-content: flex-end;

	/* Thumb-friendly full-width actions on the phone sheet, Save on top, pinned
	 * to the bottom so it stays above the keyboard while the form scrolls under
	 * it. The paper background + top shadow keep scrolling content legible. */
	@media (max-width: 40rem) {
		position: sticky;
		bottom: 0;
		flex-direction: column;
		gap: var(--space-2xs);
		padding-top: var(--space-2xs);
		background: var(--color-paper-aged);
		box-shadow: 0 -0.75rem 0.75rem -0.5rem var(--shadow-color-deep);

		& > * {
			width: 100%;
		}
	}
`

const DiscardBar = styled.div`
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--space-md);
	flex-wrap: wrap;
	padding: var(--space-2xs) var(--space-sm);
	border: 1px solid var(--color-outline);
	border-radius: var(--shape-2xs);
	background: var(--color-surface-container);

	@media (max-width: 40rem) {
		position: sticky;
		bottom: 0;
		flex-direction: column;
		align-items: stretch;
		gap: var(--space-xs);
	}
`

const DiscardText = styled.span`
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface-variant);
`

const DiscardActions = styled.div`
	display: flex;
	gap: var(--space-sm);
	margin-left: auto;

	@media (max-width: 40rem) {
		margin-left: 0;

		& > * {
			flex: 1;
		}
	}
`

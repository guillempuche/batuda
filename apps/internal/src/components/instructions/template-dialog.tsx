import { useAtomSet } from '@effect/atom-react'
import { Trans, useLingui } from '@lingui/react/macro'
import { useBlocker } from '@tanstack/react-router'
import { Copy, MoreHorizontal, Trash2, UserRoundPlus, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import styled from 'styled-components'

import {
	PriButton,
	PriDialog,
	PriInput,
	PriMenu,
	usePriToast,
} from '@batuda/ui/pri'

import {
	createTemplateAtom,
	updateTemplateAtom,
} from '#/atoms/instruction-atoms'
import {
	narrowSavedTemplate,
	type TemplateShape,
} from '#/components/instructions/instruction-shapes'
import { MarkdownView } from '#/components/markdown/markdown-view'
import { PriRichText } from '#/components/primitives/pri-rich-text'
import { RelativeDate } from '#/components/shared/relative-date'
import { SrOnly } from '#/components/shared/sr-only'
import { stenciledTitle } from '#/lib/workshop-mixins'

/**
 * Reading and writing one instruction template, in the same dialog.
 *
 * Reading is the way in — the guidance is prose, and prose is for reading — and
 * Edit turns the same dialog into the editor without closing it, so stepping
 * from one to the other never loses your place. Saving returns to reading, so a
 * change can be checked where it was made.
 *
 * The mode is deliberately local rather than part of the address: `?read=` can
 * be opened on top of a half-written stack, and moving the mode through the URL
 * would throw that draft away to look something up.
 *
 * The fields are uncontrolled and read from `FormData` on submit, matching the
 * app's other dialogs — BaseUI's controlled value+onChange silently drops
 * programmatic fills. That means they only re-seed when the form remounts, so
 * the remount key follows the template being edited and never the mode.
 */
export function TemplateDialog({
	open,
	startInEdit = false,
	target,
	scope = 'personal',
	canTransfer = false,
	onOpenChange,
	onSaved,
	onDelete,
	onTransfer,
	testId,
}: {
	readonly open: boolean
	// A row's Edit button opens straight into writing; a name opens into reading.
	readonly startInEdit?: boolean
	// null = writing a new template rather than opening an existing one.
	readonly target: TemplateShape | null
	readonly scope?: 'personal' | 'org'
	readonly canTransfer?: boolean
	readonly onOpenChange: (next: boolean) => void
	readonly onSaved: () => void
	readonly onDelete: (target: TemplateShape) => void
	readonly onTransfer: (target: TemplateShape) => void
	readonly testId: string
}) {
	const { t } = useLingui()
	const toast = usePriToast()
	const createTemplate = useAtomSet(createTemplateAtom, { mode: 'promiseExit' })
	const updateTemplate = useAtomSet(updateTemplateAtom, { mode: 'promiseExit' })

	const isCreate = target === null
	const [editing, setEditing] = useState(isCreate || startInEdit)
	const [submitting, setSubmitting] = useState(false)
	const [errorMessage, setErrorMessage] = useState<string | null>(null)
	// What the server last handed back. Read mode shows this rather than the row
	// from the list: refreshing a list keeps the previous value while the request
	// is in flight, so reading straight after a save would show the old text and
	// look like the save had failed.
	const [saved, setSaved] = useState<TemplateShape | null>(null)
	// A close or a step back to reading confirms first once something is typed,
	// so a stray key can't drop the draft.
	const dirtyRef = useRef(false)
	const [confirmDiscard, setConfirmDiscard] = useState(false)
	const keepEditingRef = useRef<HTMLButtonElement>(null)
	const editButtonRef = useRef<HTMLButtonElement>(null)
	const nameRef = useRef<HTMLInputElement>(null)
	// The control that had focus when the discard prompt appeared, so keeping the
	// draft hands the writer back to it rather than to the top of the dialog.
	const focusedBeforePromptRef = useRef<HTMLElement | null>(null)
	// Set when the guard is answering a browser Back rather than a click, so
	// discarding lets that navigation through instead of only closing the dialog.
	const pendingNav = useRef<(() => void) | null>(null)

	// Reseed the guard whenever the dialog opens or moves to another template.
	// Keyed on the id, not the row: the list rebuilds its rows on every refresh,
	// and reacting to that would reset a half-written draft in the background.
	const targetId = target?.id ?? null
	// biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the template being opened, not the row object the list rebuilds on every refresh
	useEffect(() => {
		dirtyRef.current = false
		setConfirmDiscard(false)
		setErrorMessage(null)
		setSaved(null)
		// A successful save returns early without clearing this, so reset it here;
		// otherwise the reopened dialog shows a disabled "Saving…" button.
		setSubmitting(false)
		setEditing(targetId === null || startInEdit)
	}, [targetId, open, startInEdit])

	// The discard prompt is a blocking alert; move focus to the safe choice so
	// keyboard and screen-reader users land on it — and don't lose focus to the
	// body when the control that opened it unmounts.
	useEffect(() => {
		if (confirmDiscard) keepEditingRef.current?.focus()
	}, [confirmDiscard])

	// Swapping the body without closing the dialog would leave focus on a button
	// that no longer exists, so it moves with the mode.
	useEffect(() => {
		if (!open) return
		if (editing) nameRef.current?.focus()
		else editButtonRef.current?.focus()
	}, [editing, open])

	// Sighted readers watch the dialog turn into the editor and back. Focus moves
	// within the same dialog, so nothing is announced on its own — this says which
	// mode you landed in. It stays empty until the first switch, so opening the
	// dialog isn't narrated twice.
	const [modeAnnouncement, setModeAnnouncement] = useState('')
	const announcedMode = useRef<boolean | null>(null)
	useEffect(() => {
		if (!open) {
			announcedMode.current = null
			setModeAnnouncement('')
			return
		}
		if (announcedMode.current === null) {
			announcedMode.current = editing
			return
		}
		if (announcedMode.current === editing) return
		announcedMode.current = editing
		setModeAnnouncement(
			editing ? t`Editing this template` : t`Reading this template`,
		)
	}, [editing, open, t])

	// Every way into the prompt notes where focus stood first. It has to happen
	// here rather than once the prompt is up, because the control that asks
	// (Cancel) is the one the prompt replaces.
	const askDiscard = () => {
		const active = document.activeElement
		// A browser Back arrives with nothing focused, and the page body counts as
		// an element — handing focus back to it is the very thing this avoids.
		focusedBeforePromptRef.current =
			active instanceof HTMLElement && active !== document.body ? active : null
		setConfirmDiscard(true)
	}

	// Browser Back never reaches the dialog's own close handler — it drops the
	// search key, and the dialog is simply told it is shut. Blocking the
	// navigation is the only way an unsaved rewrite survives a stray Back.
	const blocker = useBlocker({
		shouldBlockFn: () => open && editing && dirtyRef.current,
		disabled: !open || !editing,
		withResolver: true,
	})
	// biome-ignore lint/correctness/useExhaustiveDependencies: listing askDiscard would re-run this on every render and overwrite the remembered focus with the prompt's own button
	useEffect(() => {
		if (blocker.status !== 'blocked') return
		pendingNav.current = blocker.proceed
		askDiscard()
	}, [blocker.status, blocker.proceed])

	const shown = saved ?? target
	const orgOwned = shown?.ownerUserId === null && !isCreate
	const hasBody = (shown?.body ?? '').trim().length > 0

	const copyBody = async () => {
		try {
			await navigator.clipboard.writeText(shown?.body ?? '')
			toast.add({ title: t`Instructions copied`, type: 'success' })
		} catch {
			toast.add({ title: t`Couldn't copy the instructions`, type: 'error' })
		}
	}

	const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		// Save stays clickable while a save is in flight, so a second press stops
		// here rather than sending the same text twice.
		if (submitting) return
		const form = new FormData(event.currentTarget)
		const name = String(form.get('name') ?? '').trim()
		const body = String(form.get('body') ?? '').trim()
		if (name.length === 0 || body.length === 0) {
			setErrorMessage(t`Add a name and instructions before saving.`)
			return
		}
		setSubmitting(true)
		setErrorMessage(null)
		const exit = target
			? await updateTemplate({
					params: { id: target.id },
					payload: { name, body },
				} as never)
			: await createTemplate({ payload: { name, body, scope } } as never)
		if (exit._tag === 'Success') {
			// Saved changes aren't unsaved — step away without the guard.
			dirtyRef.current = false
			onSaved()
			if (target === null) {
				onOpenChange(false)
				return
			}
			// Show what the server stored, then let the reader read it back. If the
			// reply arrives in an unexpected shape, the typed text is still a
			// truthful stand-in for what was just sent.
			setSaved(
				narrowSavedTemplate(exit) ?? { ...target, name, body, updatedAt: null },
			)
			setSubmitting(false)
			setEditing(false)
			return
		}
		setErrorMessage(t`Could not save the template. Please try again.`)
		setSubmitting(false)
	}

	// Every user-initiated close runs through here so a dirty draft prompts first.
	const handleRootOpenChange = (next: boolean) => {
		if (next) {
			onOpenChange(true)
			return
		}
		if (editing && dirtyRef.current) {
			askDiscard()
			return
		}
		onOpenChange(false)
	}

	// Cancel steps back to reading rather than closing, so it needs the same
	// guard the close paths get — otherwise the gentlest-looking way out is the
	// one that quietly throws the draft away.
	const leaveEditing = () => {
		if (dirtyRef.current) {
			askDiscard()
			return
		}
		if (isCreate) onOpenChange(false)
		else setEditing(false)
	}

	const keepEditing = () => {
		setConfirmDiscard(false)
		// Back to whatever had focus before the prompt. Cancel is usually that
		// control and the prompt takes its place, so fall back to the name field.
		const previous = focusedBeforePromptRef.current
		focusedBeforePromptRef.current = null
		if (previous?.isConnected) previous.focus()
		else nameRef.current?.focus()
		if (pendingNav.current !== null) {
			pendingNav.current = null
			blocker.reset?.()
		}
	}

	const discard = () => {
		dirtyRef.current = false
		setConfirmDiscard(false)
		focusedBeforePromptRef.current = null
		const proceed = pendingNav.current
		pendingNav.current = null
		if (proceed !== null) {
			proceed()
			return
		}
		if (isCreate) onOpenChange(false)
		else setEditing(false)
	}

	// Reading offers more than fits a phone footer side by side, so only Edit and
	// Copy stay in the open and the rest collect behind one control — unless
	// there is just one, which would cost a tap and buy nothing.
	const extraActions = [
		...(canTransfer && shown !== null
			? [
					{
						key: 'transfer',
						label: t`Hand to a colleague`,
						icon: <UserRoundPlus size={14} aria-hidden />,
						run: () => onTransfer(shown),
					},
				]
			: []),
		...(shown !== null
			? [
					{
						key: 'delete',
						label: t`Delete`,
						icon: <Trash2 size={14} aria-hidden />,
						run: () => onDelete(shown),
					},
				]
			: []),
	]

	return (
		<PriDialog.Root open={open} onOpenChange={handleRootOpenChange}>
			<PriDialog.Portal>
				<PriDialog.Backdrop />
				<PriDialog.Popup mobile='sheet' data-testid={testId}>
					<SrOnly role='status' aria-live='polite'>
						{modeAnnouncement}
					</SrOnly>
					<Header>
						<TitleBlock>
							<PriDialog.Title>
								<Heading>
									{isCreate ? (
										scope === 'org' ? (
											<Trans>New org template</Trans>
										) : (
											<Trans>New template</Trans>
										)
									) : editing ? (
										<Trans>Edit template</Trans>
									) : (
										(shown?.name ?? '')
									)}
								</Heading>
							</PriDialog.Title>
							{!editing && shown?.updatedAt ? (
								<Meta>
									<Trans>Last changed</Trans>{' '}
									<RelativeDate value={shown.updatedAt} />
								</Meta>
							) : null}
						</TitleBlock>
						<PriDialog.Close
							render={props => (
								<CloseButton type='button' aria-label={t`Close`} {...props}>
									<X size={18} aria-hidden />
								</CloseButton>
							)}
						/>
					</Header>

					{editing ? (
						<>
							<PriDialog.Description
								render={props => (
									<Description {...props}>
										{orgOwned ? (
											<Trans>
												Shared with everyone in your organization — their agents
												follow it on every run.
											</Trans>
										) : (
											<Trans>
												Standing guidance your research agent follows on every
												run.
											</Trans>
										)}
									</Description>
								)}
							/>

							{orgOwned ? (
								<OrgNotice
									id='template-org-notice'
									role='note'
									data-testid={`${testId}-org-notice`}
								>
									<Trans>
										This one belongs to your organization. What you save here
										changes it for everybody.
									</Trans>
								</OrgNotice>
							) : null}

							{/* Keyed on the template, never the mode: a remount re-seeds the
							    uncontrolled fields, which would wipe a draft on every flip. */}
							<Form
								key={target?.id ?? 'new'}
								onSubmit={handleSubmit}
								data-testid='template-editor-form'
							>
								<Field>
									<Label htmlFor='template-name'>
										<Trans>Name</Trans>
									</Label>
									<PriInput
										ref={nameRef}
										id='template-name'
										name='name'
										data-testid='template-editor-name'
										defaultValue={target?.name ?? ''}
										placeholder={t`e.g. [research] Spain hospitality sourcing`}
										// Focus lands straight in this field when reading turns into
										// writing, past the notice above it, so the notice is read
										// out with the field rather than only being there to see.
										aria-describedby={
											orgOwned
												? 'template-org-notice template-name-hint'
												: 'template-name-hint'
										}
										onChange={() => {
											dirtyRef.current = true
										}}
										required
									/>
									<HelpText id='template-name-hint'>
										<Trans>
											A short label. Start it with a [tag] like [research] to
											group related templates if you like — the brackets are
											just part of the name.
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
										defaultValue={target?.body ?? ''}
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
												onClick={keepEditing}
											>
												<Trans>Keep editing</Trans>
											</PriButton>
											<PriButton
												type='button'
												$variant='destructive'
												data-testid='template-editor-discard'
												onClick={discard}
											>
												<Trans>Discard</Trans>
											</PriButton>
										</DiscardActions>
									</DiscardBar>
								) : (
									<Footer>
										{/* aria-disabled, not disabled: switching a focused button
										    to disabled throws focus to the top of the page, and a
										    failed save would leave the writer stranded there.
										    handleSubmit ignores the repeat press instead. */}
										<PriButton
											type='submit'
											$variant='filled'
											data-testid='template-editor-submit'
											aria-disabled={submitting}
										>
											{submitting ? (
												<Trans>Saving…</Trans>
											) : (
												<Trans>Save</Trans>
											)}
										</PriButton>
										<PriButton
											type='button'
											$variant='text'
											data-testid='template-editor-cancel'
											onClick={leaveEditing}
										>
											<Trans>Cancel</Trans>
										</PriButton>
									</Footer>
								)}
							</Form>
						</>
					) : (
						<>
							{/* Long guidance scrolls on its own, so it has to be reachable by
							    keyboard — otherwise anything past the first screenful can
							    only be read with a mouse wheel. */}
							<Body
								data-testid={`${testId}-body`}
								role='region'
								aria-label={t`Instructions`}
								tabIndex={hasBody ? 0 : -1}
							>
								{hasBody ? (
									<MarkdownView source={shown?.body ?? ''} />
								) : (
									<EmptyBody>
										<Trans>
											This template is empty, so it adds nothing to a run. Fill
											it in to give your agents something to follow.
										</Trans>
									</EmptyBody>
								)}
							</Body>

							<Footer>
								<PriButton
									ref={editButtonRef}
									type='button'
									$variant='filled'
									data-testid={`${testId}-edit`}
									onClick={() => setEditing(true)}
								>
									<Trans>Edit</Trans>
								</PriButton>
								{hasBody ? (
									<PriButton
										type='button'
										$variant='text'
										data-testid={`${testId}-copy`}
										onClick={() => {
											void copyBody()
										}}
									>
										<Copy size={14} aria-hidden />
										<Trans>Copy</Trans>
									</PriButton>
								) : null}
								{extraActions.length === 1 && extraActions[0] ? (
									<PriButton
										type='button'
										$variant='text'
										data-testid={`${testId}-${extraActions[0].key}`}
										onClick={extraActions[0].run}
									>
										{extraActions[0].icon}
										<span>{extraActions[0].label}</span>
									</PriButton>
								) : extraActions.length > 1 ? (
									<PriMenu.Root>
										<PriMenu.Trigger
											render={props => (
												<PriButton
													type='button'
													$variant='text'
													aria-label={t`More actions`}
													data-testid={`${testId}-more`}
													{...props}
												>
													<MoreHorizontal size={16} aria-hidden />
												</PriButton>
											)}
										/>
										<PriMenu.Portal>
											<PriMenu.Positioner sideOffset={6}>
												<PriMenu.Popup>
													{extraActions.map(action => (
														<PriMenu.Item
															key={action.key}
															data-testid={`${testId}-${action.key}`}
															onClick={action.run}
														>
															{action.icon}
															<span>{action.label}</span>
														</PriMenu.Item>
													))}
												</PriMenu.Popup>
											</PriMenu.Positioner>
										</PriMenu.Portal>
									</PriMenu.Root>
								) : null}
							</Footer>
						</>
					)}
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

const TitleBlock = styled.div`
	display: flex;
	flex-direction: column;
	gap: var(--space-3xs);
	min-width: 0;
`

const Heading = styled.span`
	${stenciledTitle}
	font-size: var(--typescale-title-large-size);
	line-height: var(--typescale-title-large-line);
`

const Meta = styled.span`
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface-variant);
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

// Rewriting the organization's guidance affects colleagues who will never see
// this dialog, so the warning sits above the fields rather than below them.
const OrgNotice = styled.p`
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface);
	margin: var(--space-2xs) 0 0;
	padding: var(--space-2xs) var(--space-sm);
	border-radius: var(--shape-2xs);
	border-left: 2px solid var(--color-primary);
	background: color-mix(in oklab, var(--color-primary) 8%, transparent);
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

// Long guidance scrolls here rather than pushing the dialog off screen. On the
// phone sheet it takes the height the chrome leaves behind, the same way the
// editor does, so reading a long template scrolls inside the body.
const Body = styled.div`
	margin-top: var(--space-sm);
	flex: 1;
	min-height: 0;
	overflow-y: auto;

	&:focus-visible {
		outline: none;
		box-shadow: var(--glow-active);
	}
`

const EmptyBody = styled.p`
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	font-style: italic;
	color: var(--color-on-surface-variant);
	margin: 0;
`

const Form = styled.form`
	display: flex;
	flex-direction: column;
	gap: var(--space-md);
	margin-top: var(--space-sm);

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
	align-items: center;
	gap: var(--space-sm);
	justify-content: flex-end;
	margin-top: var(--space-md);

	/* Thumb-friendly full-width actions on the phone sheet, the primary one on
	 * top, pinned to the bottom so it stays above the keyboard while the form
	 * scrolls under it. The paper background + top shadow keep scrolling content
	 * legible. */
	@media (max-width: 40rem) {
		position: sticky;
		bottom: 0;
		flex-direction: column;
		align-items: stretch;
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

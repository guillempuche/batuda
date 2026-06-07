import { useAtomSet } from '@effect/atom-react'
import { Trans, useLingui } from '@lingui/react/macro'
import { X } from 'lucide-react'
import { useState } from 'react'
import styled from 'styled-components'

import { PriButton, PriDialog, PriInput, PriTextarea } from '@batuda/ui/pri'

import {
	createTemplateAtom,
	updateTemplateAtom,
} from '#/atoms/instruction-atoms'
import { stenciledTitle } from '#/lib/workshop-mixins'

export type TemplateDraft = {
	readonly id: string
	readonly name: string
	readonly body: string
}

// Create a personal template, or edit an existing one. The body is plain prompt
// text (no rich-text editor — instruction text, not a document). Fields are
// uncontrolled and read from FormData on submit, matching the app's other
// dialogs (BaseUI's controlled value+onChange silently drops programmatic
// fills, so FormData is the reliable read).
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
			onSaved()
			onOpenChange(false)
			return
		}
		setErrorMessage(t`Could not save the template. Please try again.`)
		setSubmitting(false)
	}

	return (
		<PriDialog.Root open={open} onOpenChange={onOpenChange}>
			<PriDialog.Portal>
				<PriDialog.Backdrop />
				<PriDialog.Popup data-testid='template-editor-dialog'>
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
								placeholder={t`e.g. Spain hospitality sourcing`}
								aria-describedby='template-name-hint'
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

						<Field>
							<Label htmlFor='template-body'>
								<Trans>Instructions</Trans>
							</Label>
							<PriTextarea
								id='template-body'
								name='body'
								data-testid='template-editor-body'
								defaultValue={editing?.body ?? ''}
								rows={8}
								placeholder={t`Standing guidance the agent should follow on every run…`}
								required
							/>
						</Field>

						{errorMessage !== null ? (
							<ErrorBanner role='alert'>{errorMessage}</ErrorBanner>
						) : null}

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
`

const CloseButton = styled.button`
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 1.75rem;
	height: 1.75rem;
	padding: 0;
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
`

const Field = styled.div`
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
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
`

import { Trans, useLingui } from '@lingui/react/macro'
import { ChevronRight, NotebookPen } from 'lucide-react'
import { useState } from 'react'
import styled from 'styled-components'

import { PriButton, PriCollapsible, PriTextarea } from '@batuda/ui/pri'

import { MarkdownView } from '#/components/markdown/markdown-view'
import { RelativeDate } from '#/components/shared/relative-date'
import { agedPaperSurface, stenciledTitle } from '#/lib/workshop-mixins'

export type AccountBriefCompany = {
	readonly accountBrief: string | null
	readonly briefUpdatedBy: string | null
	readonly briefUpdatedAt: string | null
}

/**
 * The account's running notes — one shared page that both the salesperson and
 * research write to.
 *
 * Research seeds it while nobody has edited it, and only adds underneath once
 * somebody has, so the note about who last wrote here is the reassurance that
 * editing is safe: past that point nothing can overwrite what you typed.
 *
 * Editing is a plain textarea of markdown rather than a rich editor, because
 * what research appends is markdown too — keeping one format means a person and
 * a run are always writing the same kind of thing into the same page.
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
	const [saving, setSaving] = useState(false)

	const brief = company.accountBrief ?? ''
	const ownedByPerson = company.briefUpdatedBy !== null

	const startEditing = () => {
		setDraft(brief)
		setEditing(true)
	}

	const save = async () => {
		setSaving(true)
		try {
			await onSave('accountBrief', draft)
			setEditing(false)
		} finally {
			setSaving(false)
		}
	}

	return (
		<PriCollapsible.Root defaultOpen={brief !== ''}>
			<TriggerWrap>
				<Trigger data-testid='company-brief-trigger'>
					<ChevronRight size={14} aria-hidden />
					<NotebookPen size={14} aria-hidden />
					<Trans>Account brief</Trans>
				</Trigger>
			</TriggerWrap>
			<PriCollapsible.Panel>
				<Body data-testid='company-brief-panel'>
					{editing ? (
						<>
							<PriTextarea
								aria-label={t`Account brief`}
								value={draft}
								onChange={event => setDraft(event.target.value)}
								rows={14}
								data-testid='company-brief-editor'
							/>
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
					) : (
						<>
							{brief === '' ? (
								<Empty data-testid='company-brief-empty'>
									<Trans>
										No brief yet. Research writes one here, or you can start it
										yourself.
									</Trans>
								</Empty>
							) : (
								<Rendered data-testid='company-brief-view'>
									<MarkdownView source={brief} />
								</Rendered>
							)}
							<Footer>
								<Attribution data-testid='company-brief-attribution'>
									{ownedByPerson ? (
										company.briefUpdatedAt !== null ? (
											<Trans>
												Edited by hand{' '}
												<RelativeDate
													value={company.briefUpdatedAt}
													fallback={t`recently`}
												/>
												. Research adds below your text.
											</Trans>
										) : (
											<Trans>
												Edited by hand. Research adds below your text.
											</Trans>
										)
									) : (
										<Trans>
											Written by research. Editing it makes it yours.
										</Trans>
									)}
								</Attribution>
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

const TriggerWrap = styled.div`
	display: flex;
	justify-content: flex-start;
`

const Trigger = styled(PriCollapsible.Trigger)`
	& > svg:first-child {
		transition: transform 200ms ease;
	}

	&[data-open] > svg:first-child,
	&[aria-expanded='true'] > svg:first-child {
		transform: rotate(90deg);
	}
`

const Body = styled.div`
	${agedPaperSurface}
	display: flex;
	flex-direction: column;
	gap: var(--space-sm);
	padding: var(--space-md);
	margin-top: var(--space-sm);
`

const Rendered = styled.div`
	font-size: var(--typescale-body-medium-size);
	color: var(--color-on-surface);
`

const Empty = styled.p`
	margin: 0;
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface-variant);
`

const Footer = styled.div`
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: space-between;
	gap: var(--space-sm);
`

const Attribution = styled.span`
	${stenciledTitle}
	font-size: var(--typescale-label-small-size);
	color: var(--color-on-surface-variant);
`

const Actions = styled.div`
	display: flex;
	justify-content: flex-end;
	gap: var(--space-sm);
`

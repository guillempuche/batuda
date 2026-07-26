import { useAtomSet } from '@effect/atom-react'
import { Trans, useLingui } from '@lingui/react/macro'
import { useNavigate } from '@tanstack/react-router'
import { useCallback, useState } from 'react'
import styled from 'styled-components'

import { PriButton, PriInput } from '@batuda/ui/pri'

import { rerunResearchAtom } from '#/atoms/research-atoms'
import { brushedMetalPlate } from '#/lib/workshop-mixins'

/**
 * When a run grounded on the wrong company (or shipped a look-alike's data), a
 * person supplies the correct official domain and re-runs. The re-run locks onto
 * that site via the grounding path, and this navigates to the fresh run.
 */
export function TargetCorrection({
	researchId,
}: {
	readonly researchId: string
}) {
	const { t } = useLingui()
	const navigate = useNavigate()
	const rerun = useAtomSet(rerunResearchAtom, { mode: 'promiseExit' })
	const [domain, setDomain] = useState('')
	const [submitting, setSubmitting] = useState(false)
	const [errorMessage, setErrorMessage] = useState<string | null>(null)

	const canSubmit = domain.trim().length > 0 && !submitting

	// React 19 form action — queues through hydration like the create dialog.
	const handleAction = useCallback(async () => {
		if (!canSubmit) return
		setSubmitting(true)
		setErrorMessage(null)

		const exit = await rerun({
			params: { id: researchId },
			payload: { domain: domain.trim() },
		})

		if (exit._tag === 'Success') {
			const value = exit.value as Record<string, unknown> | null
			const newId = typeof value?.['id'] === 'string' ? value['id'] : null
			if (value?.['status'] === 'started' && newId !== null) {
				void navigate({ to: '/research/$id', params: { id: newId } })
				return
			}
			// The backend rejected the domain (unparseable).
			setErrorMessage(
				t`That does not look like a website. Try the company's domain, like acme.com.`,
			)
			setSubmitting(false)
			return
		}
		setErrorMessage(t`Could not start the re-run. Please try again.`)
		setSubmitting(false)
	}, [canSubmit, rerun, researchId, domain, navigate, t])

	return (
		<Panel data-testid='research-target-correction'>
			<Label htmlFor='target-correction-domain'>
				<Trans>Wrong company? Enter its official website</Trans>
			</Label>
			<HelpText>
				<Trans>
					This overrides the site I auto-detected and re-runs the research
					locked onto the company at that domain.
				</Trans>
			</HelpText>
			<Form action={handleAction}>
				<PriInput
					id='target-correction-domain'
					data-testid='research-target-correction-domain'
					value={domain}
					placeholder={t`acme.com`}
					onChange={event => {
						setDomain(event.target.value)
					}}
				/>
				<PriButton
					type='submit'
					$variant='filled'
					data-testid='research-target-correction-submit'
					disabled={!canSubmit}
				>
					{submitting ? (
						<Trans>Re-running…</Trans>
					) : (
						<Trans>Re-run with this domain</Trans>
					)}
				</PriButton>
			</Form>
			{errorMessage !== null ? (
				<ErrorBanner role='alert'>{errorMessage}</ErrorBanner>
			) : null}
		</Panel>
	)
}

const Panel = styled.div`
	${brushedMetalPlate}
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
	padding: var(--space-sm);
	border-radius: var(--shape-2xs);
`

const Label = styled.label`
	font-family: var(--font-display);
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

const Form = styled.form`
	display: flex;
	gap: var(--space-sm);
	align-items: flex-start;
	flex-wrap: wrap;
`

const ErrorBanner = styled.div`
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	color: var(--color-error);
`

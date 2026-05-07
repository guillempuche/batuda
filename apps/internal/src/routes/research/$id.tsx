import { useLingui } from '@lingui/react/macro'
import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import styled from 'styled-components'

import { useSetDocumentTitle } from '#/components/layout/top-bar-title'
import { RunDetail } from '#/components/research/run-detail'
import { stenciledTitle } from '#/lib/workshop-mixins'

export const Route = createFileRoute('/research/$id')({
	head: () => ({ meta: [{ title: 'Research run — Batuda' }] }),
	component: ResearchRunPage,
})

function ResearchRunPage() {
	const { t } = useLingui()
	const { id } = Route.useParams()
	useSetDocumentTitle(t`Research run`)

	return (
		<Page>
			<BackLink to='/companies'>
				<ArrowLeft size={14} aria-hidden />
				<BackLabel>{t`Back to companies`}</BackLabel>
			</BackLink>
			<RunDetail researchId={id} />
		</Page>
	)
}

const Page = styled.div`
	display: flex;
	flex-direction: column;
	gap: var(--space-md);
`

const BackLink = styled(Link)`
	${stenciledTitle}
	display: inline-flex;
	align-items: center;
	gap: var(--space-2xs);
	font-size: var(--typescale-label-small-size);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--color-on-surface-variant);
	text-decoration: none;
	width: fit-content;

	&:hover {
		color: var(--color-on-surface);
	}
`

const BackLabel = styled.span``

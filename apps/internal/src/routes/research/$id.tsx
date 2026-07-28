import { useLingui } from '@lingui/react/macro'
import { createFileRoute, Link } from '@tanstack/react-router'
import { AsyncResult } from 'effect/unstable/reactivity'
import { ArrowLeft } from 'lucide-react'
import styled from 'styled-components'

import {
	researchDetailAtom,
	runProposedUpdatesAtom,
	runProposedUpdatesFirstPage,
} from '#/atoms/research-atoms'
import { useSetDocumentTitle } from '#/components/layout/top-bar-title'
import { RunDetail } from '#/components/research/run-detail'
import { dehydrateAtom } from '#/lib/atom-hydration'
import { listPageQuery } from '#/lib/list-page'
import { getServerCookieHeader } from '#/lib/server-cookie'
import { stenciledTitle } from '#/lib/workshop-mixins'

/**
 * Server-only load: forwards the Better-Auth cookie and pre-fetches the run
 * and its proposed updates so the detail view and its review paint on first
 * render instead of flashing a spinner.
 */
async function loadRunOnServer(id: string) {
	const [{ Effect }, { makeBatudaApiServer }, cookie] = await Promise.all([
		import('effect'),
		import('#/lib/batuda-api-server'),
		getServerCookieHeader(),
	])
	const program = Effect.gen(function* () {
		const client = yield* makeBatudaApiServer(cookie ?? undefined)
		const run = yield* client.research.get({ params: { id } })
		const proposals = yield* client.research.listProposedUpdates({
			params: { id },
			// The review screen's own first slice, asked for the same way, so the
			// browser reuses this answer instead of asking again.
			query: listPageQuery(runProposedUpdatesFirstPage()),
		})
		return { run, proposals }
	})
	return Effect.runPromise(program)
}

export const Route = createFileRoute('/research/$id')({
	loader: async ({ params: { id } }) => {
		if (!import.meta.env.SSR) {
			return { dehydrated: [] as const }
		}
		try {
			const { run, proposals } = await loadRunOnServer(id)
			return {
				dehydrated: [
					dehydrateAtom(researchDetailAtom(id), AsyncResult.success(run)),
					dehydrateAtom(
						runProposedUpdatesAtom(id, runProposedUpdatesFirstPage()),
						AsyncResult.success(proposals),
					),
				] as const,
			}
		} catch (error) {
			console.warn(
				'[ResearchRunLoader] falling back to empty hydration:',
				error,
			)
			return { dehydrated: [] as const }
		}
	},
	head: () => ({ meta: [{ title: 'Research run — Batuda' }] }),
	component: ResearchRunPage,
})

function ResearchRunPage() {
	const { t } = useLingui()
	const { id } = Route.useParams()
	useSetDocumentTitle(t`Research run`)

	return (
		<Page>
			<BackLink to='/research'>
				<ArrowLeft size={14} aria-hidden />
				<BackLabel>{t`Back to research`}</BackLabel>
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

import { useLingui } from '@lingui/react/macro'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Effect } from 'effect'
import { AsyncResult } from 'effect/unstable/reactivity'
import { ArrowLeft } from 'lucide-react'
import { styled } from 'next-yak'

import {
	researchDetailAtom,
	runProposedUpdatesAtom,
	runProposedUpdatesFirstPage,
} from '#/atoms/research-atoms'
import { useSetDocumentTitle } from '#/components/layout/top-bar-title'
import { RunDetail } from '#/components/research/run-detail'
import { dehydrateAtom, handOverFromServer } from '#/lib/atom-hydration'
import {
	dehydrateAttributeDeclarations,
	fetchAttributeDeclarations,
} from '#/lib/attribute-declarations'
import type { BatudaApiServerClient } from '#/lib/batuda-api-server'
import { listPageQuery } from '#/lib/list-page'
import { stenciledTitle } from '#/lib/workshop-mixins'

/**
 * The run, its proposed updates and the attributes the organisation declares, so
 * the detail view and its review paint on first render instead of flashing a
 * spinner. Without the declarations the values a run found would first read as
 * their bare keys and then rename themselves a moment later.
 *
 * All three at once: none of them needs an answer from another, and asked one
 * after the next the page waits three round trips to paint one frame.
 */
function loadRunOnServer(client: BatudaApiServerClient, id: string) {
	return Effect.gen(function* () {
		const [run, proposals, attributes] = yield* Effect.all(
			[
				client.research.get({ params: { id } }),
				client.research.listProposedUpdates({
					params: { id },
					// The review screen's own first slice, asked for the same way, so the
					// browser reuses this answer instead of asking again.
					query: listPageQuery(runProposedUpdatesFirstPage()),
				}),
				fetchAttributeDeclarations(client),
			],
			{ concurrency: 3 },
		)
		return { run, proposals, attributes }
	})
}

export const Route = createFileRoute('/_authed/research/$id')({
	loader: ({ params: { id } }) =>
		handOverFromServer({
			label: 'ResearchRunLoader',
			empty: { dehydrated: [] },
			fetch: client => loadRunOnServer(client, id),
			handOver: ({ run, proposals, attributes }) => ({
				dehydrated: [
					dehydrateAtom(researchDetailAtom(id), AsyncResult.success(run)),
					dehydrateAtom(
						runProposedUpdatesAtom(id, runProposedUpdatesFirstPage()),
						AsyncResult.success(proposals),
					),
					...dehydrateAttributeDeclarations(attributes),
				],
			}),
		}),
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

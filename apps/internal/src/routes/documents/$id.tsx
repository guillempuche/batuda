import { useAtomRefresh, useAtomValue } from '@effect/atom-react'
import { Trans, useLingui } from '@lingui/react/macro'
import { createFileRoute, notFound } from '@tanstack/react-router'
import { DateTime } from 'effect'
import { AsyncResult } from 'effect/unstable/reactivity'
import styled from 'styled-components'

import { documentAtomFor } from '#/atoms/documents-atoms'
import { DOCUMENT_KIND_LABELS } from '#/components/documents/document-kinds'
import { useSetDocumentTitle } from '#/components/layout/top-bar-title'
import { MarkdownView } from '#/components/markdown/markdown-view'
import { ErrorState } from '#/components/shared/error-state'
import { LoadingSpinner } from '#/components/shared/loading-spinner'
import { RelativeDate } from '#/components/shared/relative-date'
import { dehydrateAtom } from '#/lib/atom-hydration'
import { documentOpenUrl } from '#/lib/document-links'
import { getServerCookieHeader } from '#/lib/server-cookie'
import { stenciledTitle } from '#/lib/workshop-mixins'

/**
 * A document on a page of its own.
 *
 * This is what makes a document something you can link to — paste the address
 * into a message, keep it open in a tab, come back to it tomorrow. Reading one
 * inside a popup on the company page works, but nothing about that popup can be
 * shared with anybody.
 */
async function loadDocumentOnServer(id: string) {
	const [{ Effect }, { makeBatudaApiServer }, cookie] = await Promise.all([
		import('effect'),
		import('#/lib/batuda-api-server'),
		getServerCookieHeader(),
	])
	const program = Effect.gen(function* () {
		const client = yield* makeBatudaApiServer(cookie ?? undefined)
		return yield* client.documents.get({ params: { id } })
	})
	return Effect.runPromise(program)
}

// A kind the app does not know is shown as it is stored rather than blank.
function kindLabel(i18n: { _: (d: never) => string }, value: string): string {
	const found = DOCUMENT_KIND_LABELS.find(k => k.value === value)
	return found ? i18n._(found.label as never) : value
}

function isNotFoundError(error: unknown): boolean {
	if (!error || typeof error !== 'object') return false
	return (error as Record<string, unknown>)['_tag'] === 'NotFound'
}

export const Route = createFileRoute('/documents/$id')({
	loader: async ({ params: { id } }) => {
		if (!import.meta.env.SSR) {
			return { dehydrated: [] as const }
		}
		try {
			const document = await loadDocumentOnServer(id)
			return {
				dehydrated: [
					dehydrateAtom(documentAtomFor(id), AsyncResult.success(document)),
				] as const,
			}
		} catch (error) {
			if (isNotFoundError(error)) throw notFound()
			console.warn('[DocumentLoader] falling back to empty hydration:', error)
			return { dehydrated: [] as const }
		}
	},
	head: () => ({ meta: [{ title: 'Document — Batuda' }] }),
	component: DocumentPage,
})

function DocumentPage() {
	const { i18n, t } = useLingui()
	const { id } = Route.useParams()
	useSetDocumentTitle(t`Document`)

	const atom = documentAtomFor(id)
	const result = useAtomValue(atom)
	const refresh = useAtomRefresh(atom)

	if (AsyncResult.isInitial(result)) return <LoadingSpinner />
	if (AsyncResult.isFailure(result)) {
		return (
			<ErrorState
				title={t`Could not load this document`}
				onRetry={() => refresh()}
			/>
		)
	}

	const doc = result.value

	return (
		<Page data-testid='document-page'>
			<Header>
				<Title>{doc.title ?? t`Untitled document`}</Title>
				<Meta>
					<span>{kindLabel(i18n, doc.type)}</span>
					<RelativeDate value={DateTime.formatIso(doc.updatedAt)} />
				</Meta>
			</Header>

			{doc.format === 'html' ? (
				<Notice>
					<Trans>
						This document is a web page. It opens in a tab of its own, exactly
						as it was saved.
					</Trans>
					<OpenPageLink
						href={documentOpenUrl(id)}
						target='_blank'
						rel='noreferrer'
						data-testid='document-page-open-original'
					>
						<Trans>Open the page</Trans>
					</OpenPageLink>
				</Notice>
			) : (
				<Body data-testid='document-page-body'>
					<MarkdownView source={doc.content} />
				</Body>
			)}
		</Page>
	)
}

const Page = styled.article`
	display: flex;
	flex-direction: column;
	gap: var(--space-lg);
	max-width: 48rem;
	margin: 0 auto;
	padding: var(--space-lg);
`

const Header = styled.header`
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
`

const Title = styled.h1`
	${stenciledTitle};
	margin: 0;
`

const Meta = styled.div`
	display: flex;
	gap: var(--space-sm);
	color: var(--color-text-muted);
	font-size: var(--font-size-sm);
`

const Body = styled.div`
	line-height: 1.6;
`

const Notice = styled.div`
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	gap: var(--space-md);
	color: var(--color-text-muted);
	font-size: var(--font-size-sm);
`

// An ordinary link, so the address is there to copy and the browser opens it
// the way it opens any other page.
const OpenPageLink = styled.a`
	align-self: flex-start;
	color: var(--color-primary);
	font-size: var(--font-size-sm);
	text-decoration: underline;
`

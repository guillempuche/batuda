import { useAtomRefresh, useAtomSet, useAtomValue } from '@effect/atom-react'
import { Trans, useLingui } from '@lingui/react/macro'
import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { AsyncResult } from 'effect/unstable/reactivity'
import { ArrowLeft, Eye, Globe, Save } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import styled from 'styled-components'

import type { TiptapDocument } from '@engranatge/ui/blocks'
import { allBlockExtensions } from '@engranatge/ui/blocks'
import { PriButton, PriTabs, usePriToast } from '@engranatge/ui/pri'

import { pageAtomFor } from '#/atoms/pages-atoms'
import { EmptyState } from '#/components/shared/empty-state'
import { LoadingSpinner } from '#/components/shared/loading-spinner'
import { dehydrateAtom } from '#/lib/atom-hydration'
import { ForjaApiAtom } from '#/lib/forja-api-atom'
import { getServerCookieHeader } from '#/lib/server-cookie'
import { useTabSearchParam } from '#/lib/tab-search'
import {
	agedPaperSurface,
	brushedMetalBezel,
	brushedMetalPlate,
	stenciledTitle,
} from '#/lib/workshop-mixins'

type PageDetail = {
	readonly id: string
	readonly slug: string
	readonly lang: string
	readonly title: string
	readonly status: string
	readonly template: string | null
	readonly content: TiptapDocument
	readonly meta: Record<string, unknown> | null
	readonly publishedAt: string | null
	readonly viewCount: number
}

async function loadPageOnServer(id: string): Promise<unknown> {
	const [{ Effect }, { makeForjaApiServer }, cookie] = await Promise.all([
		import('effect'),
		import('#/lib/forja-api-server'),
		getServerCookieHeader(),
	])
	const program = Effect.gen(function* () {
		const client = yield* makeForjaApiServer(cookie ?? undefined)
		return yield* client.pages.get({ params: { id } })
	})
	return Effect.runPromise(program)
}

const PAGE_TABS = ['editor', 'meta'] as const
type PageTab = (typeof PAGE_TABS)[number]

type PageEditorSearch = { readonly tab?: string }

export const Route = createFileRoute('/pages/$id')({
	validateSearch: (raw: Record<string, unknown>): PageEditorSearch =>
		typeof raw['tab'] === 'string' ? { tab: raw['tab'] } : {},
	loader: async ({ params: { id } }) => {
		if (!import.meta.env.SSR) {
			return { dehydrated: [] as const, id }
		}
		try {
			const page = await loadPageOnServer(id)
			return {
				dehydrated: [
					dehydrateAtom(pageAtomFor(id), AsyncResult.success(page)),
				] as const,
				id,
			}
		} catch (error) {
			if (isNotFoundError(error)) throw notFound()
			console.warn('[PageEditorLoader] falling back:', error)
			return { dehydrated: [] as const, id }
		}
	},
	component: PageEditorPage,
})

function isNotFoundError(error: unknown): boolean {
	if (!error || typeof error !== 'object') return false
	return (error as Record<string, unknown>)['_tag'] === 'NotFound'
}

function PageEditorPage() {
	const { t } = useLingui()
	const { id } = Route.useParams()
	const atom = useMemo(() => pageAtomFor(id), [id])
	const result = useAtomValue(atom)

	const page = useMemo<PageDetail | null>(
		() => (AsyncResult.isSuccess(result) ? narrowPage(result.value) : null),
		[result],
	)

	if (AsyncResult.isInitial(result)) {
		return (
			<Page>
				<LoadingSpinner />
			</Page>
		)
	}

	if (AsyncResult.isFailure(result) || page === null) {
		return (
			<Page>
				<EmptyState
					title={t`Could not load this page`}
					description={t`Check that the session is valid or try again.`}
				/>
			</Page>
		)
	}

	return <EditorBody page={page} />
}

function EditorBody({ page }: { page: PageDetail }) {
	const { t } = useLingui()
	const toastManager = usePriToast()
	const [tab, setTab] = useTabSearchParam<PageTab>(PAGE_TABS, 'editor')
	const refreshPage = useAtomRefresh(
		useMemo(() => pageAtomFor(page.id), [page.id]),
	)

	const updatePage = useAtomSet(ForjaApiAtom.mutation('pages', 'update'), {
		mode: 'promiseExit',
	})
	const publishPage = useAtomSet(ForjaApiAtom.mutation('pages', 'publish'), {
		mode: 'promiseExit',
	})

	const [title, setTitle] = useState(page.title)
	const [saving, setSaving] = useState(false)
	const [publishing, setPublishing] = useState(false)

	const editor = useEditor({
		extensions: [...allBlockExtensions, StarterKit],
		content: page.content as Record<string, unknown>,
		immediatelyRender: false,
	})

	const handleSave = useCallback(async () => {
		if (!editor) return
		setSaving(true)
		const content = editor.getJSON()
		const exit = await updatePage({
			params: { id: page.id },
			payload: { title, content },
		} as never)
		if (exit._tag === 'Success') {
			toastManager.add({
				title: t`Page saved`,
				description: t`Changes have been saved.`,
				type: 'success',
			})
			refreshPage()
		} else {
			toastManager.add({
				title: t`Save failed`,
				description: t`Could not save the page. Please try again.`,
				type: 'error',
			})
			console.error('[forja] pages.update failed', exit.cause)
		}
		setSaving(false)
	}, [editor, page.id, title, updatePage, toastManager, t, refreshPage])

	const handlePublish = useCallback(async () => {
		setPublishing(true)
		const exit = await publishPage({
			params: { id: page.id },
		} as never)
		if (exit._tag === 'Success') {
			toastManager.add({
				title: t`Page published`,
				description: t`The page is now live.`,
				type: 'success',
			})
			refreshPage()
		} else {
			toastManager.add({
				title: t`Publish failed`,
				description: t`Could not publish the page. Please try again.`,
				type: 'error',
			})
			console.error('[forja] pages.publish failed', exit.cause)
		}
		setPublishing(false)
	}, [page.id, publishPage, toastManager, t, refreshPage])

	const publicUrl = `https://engranatge.localhost/${page.lang}/${page.slug}`

	return (
		<Page>
			<Header>
				<BackLink to='/pages'>
					<ArrowLeft size={16} aria-hidden />
					<Trans>Pages</Trans>
				</BackLink>
				<HeaderMain>
					<TitleInput
						value={title}
						onChange={e => setTitle(e.target.value)}
						placeholder={t`Page title`}
					/>
					<HeaderMeta>
						<MetaTag>{page.lang}</MetaTag>
						<MetaTag>{page.status}</MetaTag>
						{page.status === 'published' && (
							<PreviewLink
								href={publicUrl}
								target='_blank'
								rel='noopener noreferrer'
							>
								<Globe size={14} aria-hidden />
								<Trans>Preview</Trans>
							</PreviewLink>
						)}
					</HeaderMeta>
				</HeaderMain>
				<Actions>
					<PriButton
						type='button'
						$variant='outlined'
						onClick={handleSave}
						disabled={saving}
					>
						<Save size={16} aria-hidden />
						{saving ? t`Saving…` : t`Save`}
					</PriButton>
					{page.status !== 'published' && (
						<PriButton
							type='button'
							$variant='filled'
							onClick={handlePublish}
							disabled={publishing}
						>
							<Eye size={16} aria-hidden />
							{publishing ? t`Publishing…` : t`Publish`}
						</PriButton>
					)}
				</Actions>
			</Header>

			<PriTabs.Root value={tab} onValueChange={v => setTab(v as PageTab)}>
				<PriTabs.List>
					<PriTabs.Tab value='editor'>
						<Trans>Editor</Trans>
					</PriTabs.Tab>
					<PriTabs.Tab value='meta'>
						<Trans>Settings</Trans>
					</PriTabs.Tab>
					<PriTabs.Indicator />
				</PriTabs.List>

				<PriTabs.Panel value='editor'>
					<EditorWrap>
						{editor ? <EditorContent editor={editor} /> : <LoadingSpinner />}
					</EditorWrap>
				</PriTabs.Panel>

				<PriTabs.Panel value='meta'>
					<MetaPanel>
						<MetaField>
							<MetaLabel>
								<Trans>Slug</Trans>
							</MetaLabel>
							<MetaValue>{page.slug}</MetaValue>
						</MetaField>
						<MetaField>
							<MetaLabel>
								<Trans>Language</Trans>
							</MetaLabel>
							<MetaValue>{page.lang}</MetaValue>
						</MetaField>
						<MetaField>
							<MetaLabel>
								<Trans>Template</Trans>
							</MetaLabel>
							<MetaValue>{page.template ?? '—'}</MetaValue>
						</MetaField>
						<MetaField>
							<MetaLabel>
								<Trans>Views</Trans>
							</MetaLabel>
							<MetaValue>{page.viewCount}</MetaValue>
						</MetaField>
						{page.status === 'published' && (
							<MetaField>
								<MetaLabel>
									<Trans>Public URL</Trans>
								</MetaLabel>
								<PreviewLink
									href={publicUrl}
									target='_blank'
									rel='noopener noreferrer'
								>
									{publicUrl}
								</PreviewLink>
							</MetaField>
						)}
					</MetaPanel>
				</PriTabs.Panel>
			</PriTabs.Root>
		</Page>
	)
}

function narrowPage(raw: unknown): PageDetail | null {
	if (!raw || typeof raw !== 'object') return null
	const r = raw as Record<string, unknown>
	if (typeof r['id'] !== 'string') return null
	if (typeof r['slug'] !== 'string') return null
	if (typeof r['title'] !== 'string') return null
	const str = (key: string) =>
		typeof r[key] === 'string' ? (r[key] as string) : null
	return {
		id: r['id'],
		slug: r['slug'],
		lang: typeof r['lang'] === 'string' ? r['lang'] : 'en',
		title: r['title'],
		status: typeof r['status'] === 'string' ? r['status'] : 'draft',
		template: str('template'),
		content: (r['content'] as TiptapDocument) ?? {
			type: 'doc' as const,
			content: [],
		},
		meta:
			r['meta'] && typeof r['meta'] === 'object'
				? (r['meta'] as Record<string, unknown>)
				: null,
		publishedAt: str('publishedAt'),
		viewCount: typeof r['viewCount'] === 'number' ? r['viewCount'] : 0,
	}
}

const Page = styled.div.withConfig({ displayName: 'PageEditorPage' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-lg);
`

const Header = styled.header.withConfig({ displayName: 'PageEditorHeader' })`
	${brushedMetalPlate}
	display: flex;
	flex-direction: column;
	gap: var(--space-sm);
	padding: var(--space-md) var(--space-lg);
	box-shadow: var(--elevation-workshop-md);
`

const BackLink = styled(Link).withConfig({ displayName: 'PageEditorBackLink' })`
	display: inline-flex;
	align-items: center;
	gap: var(--space-2xs);
	font-size: var(--typescale-label-large-size);
	color: var(--color-on-surface-variant);
	text-decoration: none;

	&:hover {
		color: var(--color-primary);
	}
`

const HeaderMain = styled.div.withConfig({
	displayName: 'PageEditorHeaderMain',
})`
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: space-between;
	gap: var(--space-md);
`

const TitleInput = styled.input.withConfig({
	displayName: 'PageEditorTitleInput',
})`
	${stenciledTitle}
	font-size: var(--typescale-headline-medium-size);
	line-height: var(--typescale-headline-medium-line);
	letter-spacing: 0.04em;
	border: none;
	background: transparent;
	color: var(--color-on-surface);
	flex: 1 1 300px;
	min-width: 0;
	padding: var(--space-2xs) 0;

	&:focus {
		outline: none;
		border-bottom: 2px solid var(--color-primary);
	}
`

const HeaderMeta = styled.div.withConfig({
	displayName: 'PageEditorHeaderMeta',
})`
	display: flex;
	align-items: center;
	gap: var(--space-sm);
`

const MetaTag = styled.span.withConfig({ displayName: 'PageEditorMetaTag' })`
	${brushedMetalBezel}
	font-size: var(--typescale-label-medium-size);
	padding: var(--space-3xs) var(--space-sm);
	text-transform: uppercase;
	letter-spacing: 0.06em;
`

const Actions = styled.div.withConfig({ displayName: 'PageEditorActions' })`
	display: flex;
	align-items: center;
	gap: var(--space-sm);
	justify-content: flex-end;
`

const PreviewLink = styled.a.withConfig({
	displayName: 'PageEditorPreviewLink',
})`
	display: inline-flex;
	align-items: center;
	gap: var(--space-2xs);
	font-size: var(--typescale-label-large-size);
	color: var(--color-primary);
	text-decoration: none;

	&:hover {
		text-decoration: underline;
	}
`

const EditorWrap = styled.div.withConfig({
	displayName: 'PageEditorEditorWrap',
})`
	${agedPaperSurface}
	padding: var(--space-lg);
	min-height: 400px;

	.tiptap {
		outline: none;
		min-height: 300px;
		font-family: var(--font-body);
		font-size: var(--typescale-body-large-size);
		line-height: var(--typescale-body-large-line);
		color: var(--color-on-surface);
	}

	.tiptap [data-type] {
		padding: var(--space-md);
		margin: var(--space-sm) 0;
		border: 1px dashed var(--color-outline);
		border-radius: 8px;
		background: color-mix(in oklab, var(--color-surface) 90%, transparent);
	}

	.tiptap [data-type]::before {
		content: attr(data-type);
		display: block;
		font-size: var(--typescale-label-small-size);
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--color-on-surface-variant);
		margin-bottom: var(--space-xs);
	}
`

const MetaPanel = styled.div.withConfig({
	displayName: 'PageEditorMetaPanel',
})`
	${agedPaperSurface}
	padding: var(--space-lg);
	display: flex;
	flex-direction: column;
	gap: var(--space-md);
`

const MetaField = styled.div.withConfig({
	displayName: 'PageEditorMetaField',
})`
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
`

const MetaLabel = styled.span.withConfig({
	displayName: 'PageEditorMetaLabel',
})`
	font-size: var(--typescale-label-large-size);
	text-transform: uppercase;
	letter-spacing: 0.08em;
	color: var(--color-on-surface-variant);
`

const MetaValue = styled.span.withConfig({
	displayName: 'PageEditorMetaValue',
})`
	font-size: var(--typescale-body-large-size);
	color: var(--color-on-surface);
`

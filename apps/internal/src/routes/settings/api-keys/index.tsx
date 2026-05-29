import { useAtomRefresh, useAtomSet, useAtomValue } from '@effect/atom-react'
import { Trans, useLingui } from '@lingui/react/macro'
import { createFileRoute, Link } from '@tanstack/react-router'
import { AsyncResult } from 'effect/unstable/reactivity'
import { ArrowLeft, Copy, KeyRound, Trash2 } from 'lucide-react'
import type { FormEvent } from 'react'
import { useMemo, useState } from 'react'
import styled from 'styled-components'

import {
	PriButton,
	PriDialog,
	PriField,
	PriInput,
	usePriToast,
} from '@batuda/ui/pri'

import { BatudaApiAtom } from '#/lib/batuda-api-atom'
import {
	brushedMetalPlate,
	rulerUnderRule,
	stenciledTitle,
} from '#/lib/workshop-mixins'

/**
 * Org-owned API keys for AI/MCP sessions. Any org member can mint, list,
 * and delete keys for the active organization. The plaintext secret is
 * returned only once at creation time — the list endpoint carries the
 * masked `start` prefix instead, so the reveal dialog is the single
 * opportunity to copy the key before it is gone.
 */

type ApiKeyRow = {
	readonly id: string
	readonly name: string | null
	readonly start: string | null
	readonly prefix: string | null
	readonly expiresAt: string | null
	readonly createdAt: string
	readonly enabled: boolean
	readonly createdBy: {
		readonly name: string | null
		readonly email: string
	} | null
}

// The one-time create response — the only place the plaintext `key` exists.
type CreatedApiKey = {
	readonly id: string
	readonly key: string
	readonly name: string | null
	readonly start: string | null
	readonly prefix: string | null
	readonly expiresAt: string | null
	readonly createdAt: string
}

// `list` carries no params/query/payload, so the request object is empty.
const apiKeysListAtom = BatudaApiAtom.query('apiKeys', 'list', {})

export const Route = createFileRoute('/settings/api-keys/')({
	head: () => ({ meta: [{ title: 'API keys — Batuda' }] }),
	component: ApiKeysPage,
})

function ApiKeysPage() {
	const { t } = useLingui()
	const toastManager = usePriToast()

	const listResult = useAtomValue(apiKeysListAtom)
	const refreshList = useAtomRefresh(apiKeysListAtom)

	const createKey = useAtomSet(BatudaApiAtom.mutation('apiKeys', 'create'), {
		mode: 'promiseExit',
	})
	const deleteKey = useAtomSet(BatudaApiAtom.mutation('apiKeys', 'delete'), {
		mode: 'promiseExit',
	})

	// The freshly-minted secret lives here only while the reveal dialog is
	// open; closing the dialog clears it so the plaintext never lingers in
	// React state longer than the one viewing.
	const [created, setCreated] = useState<CreatedApiKey | null>(null)
	const [submitting, setSubmitting] = useState(false)
	// The row awaiting confirmation drives the delete dialog; `deletingId` is
	// the in-flight delete so its button can show progress and lock out a
	// double-submit.
	const [confirmTarget, setConfirmTarget] = useState<{
		readonly id: string
		readonly label: string
	} | null>(null)
	const [deletingId, setDeletingId] = useState<string | null>(null)
	const [formError, setFormError] = useState<string | null>(null)
	const [copied, setCopied] = useState(false)

	const rows = useMemo<ReadonlyArray<ApiKeyRow>>(
		() =>
			AsyncResult.isSuccess(listResult) ? narrowKeys(listResult.value) : [],
		[listResult],
	)
	const isLoading = AsyncResult.isInitial(listResult)
	const isFailure = AsyncResult.isFailure(listResult)
	const confirmLabel = confirmTarget?.label ?? ''

	const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		if (submitting) return
		// Inputs stay DOM-owned and are read via FormData on submit: a
		// controlled value+onChange pair drops programmatic fill() updates,
		// so the field would submit empty under automation.
		const form = new FormData(event.currentTarget)
		const name = String(form.get('name') ?? '').trim()
		const expiresRaw = String(form.get('expiresInDays') ?? '').trim()
		if (name.length === 0) {
			setFormError(t`Give the key a name so you can recognize it later.`)
			return
		}
		const payload: Record<string, unknown> = { name }
		if (expiresRaw.length > 0) {
			const expiresInDays = Number(expiresRaw)
			if (!Number.isFinite(expiresInDays) || expiresInDays <= 0) {
				setFormError(t`Expiry must be a number of days greater than zero.`)
				return
			}
			payload['expiresInDays'] = expiresInDays
		}

		setSubmitting(true)
		setFormError(null)
		const exit = await createKey({ payload } as never)
		setSubmitting(false)
		if (exit._tag === 'Success') {
			const minted = narrowCreated(exit.value)
			if (minted) {
				setCopied(false)
				setCreated(minted)
				event.currentTarget.reset()
				refreshList()
				return
			}
		}
		setFormError(t`Could not create the key. Please try again.`)
	}

	const confirmDelete = async () => {
		const target = confirmTarget
		if (!target || deletingId !== null) return
		setDeletingId(target.id)
		const exit = await deleteKey({ params: { id: target.id } } as never)
		setDeletingId(null)
		setConfirmTarget(null)
		if (exit._tag === 'Success') {
			toastManager.add({
				title: t`Key deleted`,
				description: t`The API key can no longer be used.`,
				type: 'success',
			})
			refreshList()
			return
		}
		toastManager.add({
			title: t`Delete failed`,
			description: t`Could not delete the key. Please try again.`,
			type: 'error',
		})
	}

	const handleCopy = async () => {
		if (!created) return
		try {
			await navigator.clipboard.writeText(created.key)
			setCopied(true)
		} catch {
			toastManager.add({
				title: t`Copy failed`,
				description: t`Select the key and copy it manually.`,
				type: 'error',
			})
		}
	}

	const closeReveal = () => {
		// Drop the plaintext the moment the dialog closes — it is never
		// retrievable again from the server.
		setCreated(null)
		setCopied(false)
	}

	return (
		<Page>
			<BackLink to='/settings' aria-label={t`Back to settings`}>
				<ArrowLeft size={14} aria-hidden />
				<span>
					<Trans>Settings</Trans>
				</span>
			</BackLink>

			<Intro>
				<Heading>
					<KeyRound size={20} aria-hidden />
					<Trans>API keys</Trans>
				</Heading>
				<Subtitle>
					<Trans>
						Keys let AI agents and MCP clients act on behalf of this
						organization.
					</Trans>
				</Subtitle>
			</Intro>

			<CreateCard>
				<SectionTitle>
					<Trans>Create a key</Trans>
				</SectionTitle>
				<CreateForm onSubmit={handleCreate} data-testid='create-api-key-form'>
					<FieldRow>
						<PriField.Root>
							<PriField.Label htmlFor='api-key-name'>
								<Trans>Name</Trans>
							</PriField.Label>
							<PriInput
								id='api-key-name'
								name='name'
								type='text'
								required
								placeholder={t`e.g. Claude Desktop`}
								data-testid='api-key-name'
							/>
						</PriField.Root>
						<PriField.Root>
							<PriField.Label htmlFor='api-key-expiry'>
								<Trans>Expires in (days)</Trans>
							</PriField.Label>
							<PriInput
								id='api-key-expiry'
								name='expiresInDays'
								type='number'
								min={1}
								inputMode='numeric'
								placeholder={t`Never`}
								data-testid='api-key-expiry'
							/>
						</PriField.Root>
					</FieldRow>
					{formError ? (
						<FormError role='alert' data-testid='api-key-error'>
							{formError}
						</FormError>
					) : null}
					<Actions>
						<PriButton
							type='submit'
							$variant='filled'
							disabled={submitting}
							data-testid='create-api-key'
						>
							<KeyRound size={16} aria-hidden />
							<span>{submitting ? t`Creating…` : t`Create key`}</span>
						</PriButton>
					</Actions>
				</CreateForm>
			</CreateCard>

			<ListSection>
				<SectionTitle>
					<Trans>Your keys</Trans>
				</SectionTitle>
				{isLoading ? (
					<Empty>
						<Trans>Loading…</Trans>
					</Empty>
				) : isFailure ? (
					<Empty role='alert'>
						<Trans>Could not load your keys. Refresh to try again.</Trans>
					</Empty>
				) : rows.length === 0 ? (
					<Empty data-testid='api-keys-empty'>
						<Trans>No keys yet. Create one above to connect an agent.</Trans>
					</Empty>
				) : (
					<KeyList>
						{rows.map(row => {
							const label = row.name ?? t`Untitled key`
							const isDeleting = deletingId === row.id
							const creatorName =
								row.createdBy?.name ?? row.createdBy?.email ?? null
							return (
								<KeyRow key={row.id} data-testid='api-key-row'>
									<KeyInfo>
										<KeyName data-testid='api-key-name-label'>{label}</KeyName>
										<KeyMeta>
											{row.start ? (
												<MaskedPrefix data-testid='api-key-prefix'>
													{row.start}…
												</MaskedPrefix>
											) : null}
											<MetaItem>
												<Trans>Created {formatDate(row.createdAt)}</Trans>
											</MetaItem>
											{creatorName ? (
												<MetaItem data-testid='api-key-creator'>
													<Trans>by {creatorName}</Trans>
												</MetaItem>
											) : null}
											<MetaItem>
												{row.expiresAt ? (
													<Trans>Expires {formatDate(row.expiresAt)}</Trans>
												) : (
													<Trans>Never expires</Trans>
												)}
											</MetaItem>
											{row.enabled ? null : (
												<DisabledTag>
													<Trans>Disabled</Trans>
												</DisabledTag>
											)}
										</KeyMeta>
									</KeyInfo>
									<PriButton
										type='button'
										$variant='outlined'
										disabled={isDeleting}
										data-testid={`api-key-delete-${row.id}`}
										onClick={() => {
											setConfirmTarget({ id: row.id, label })
										}}
									>
										<Trash2 size={14} aria-hidden />
										<span>{isDeleting ? t`Deleting…` : t`Delete`}</span>
									</PriButton>
								</KeyRow>
							)
						})}
					</KeyList>
				)}
			</ListSection>

			<PriDialog.Root
				open={created !== null}
				onOpenChange={(nextOpen: boolean) => {
					if (!nextOpen) closeReveal()
				}}
			>
				<PriDialog.Portal>
					<PriDialog.Backdrop />
					<PriDialog.Popup data-testid='api-key-reveal'>
						<PriDialog.Title>
							<Trans>Copy your key now</Trans>
						</PriDialog.Title>
						<PriDialog.Description>
							<Trans>
								This is the only time the full key is shown. Store it somewhere
								safe — I can't show it again.
							</Trans>
						</PriDialog.Description>
						<SecretBox>
							<SecretValue data-testid='api-key-secret'>
								{created?.key ?? ''}
							</SecretValue>
							<PriButton
								type='button'
								$variant='filled'
								data-testid='api-key-copy'
								onClick={() => {
									void handleCopy()
								}}
							>
								<Copy size={14} aria-hidden />
								<span>{copied ? t`Copied` : t`Copy`}</span>
							</PriButton>
							<SrOnly role='status' aria-live='polite'>
								{copied ? t`Copied` : ''}
							</SrOnly>
						</SecretBox>
						<RevealActions>
							<PriDialog.Close
								render={props => (
									<PriButton
										type='button'
										$variant='text'
										data-testid='api-key-reveal-close'
										{...props}
									>
										<Trans>Done</Trans>
									</PriButton>
								)}
							/>
						</RevealActions>
					</PriDialog.Popup>
				</PriDialog.Portal>
			</PriDialog.Root>

			<PriDialog.Root
				open={confirmTarget !== null}
				onOpenChange={(nextOpen: boolean) => {
					// Hold the dialog open while a delete is in flight so the row
					// can't vanish mid-request; otherwise a backdrop/Esc dismissal
					// cancels the confirmation.
					if (!nextOpen && deletingId === null) setConfirmTarget(null)
				}}
			>
				<PriDialog.Portal>
					<PriDialog.Backdrop />
					<PriDialog.Popup data-testid='api-key-delete-dialog'>
						<PriDialog.Title>
							<Trans>Delete this key?</Trans>
						</PriDialog.Title>
						<PriDialog.Description>
							<Trans>
								Any agent using "{confirmLabel}" will stop working. This can't
								be undone.
							</Trans>
						</PriDialog.Description>
						<ConfirmActions>
							<PriDialog.Close
								render={props => (
									<PriButton
										type='button'
										$variant='text'
										disabled={deletingId !== null}
										data-testid='api-key-delete-cancel'
										{...props}
									>
										<Trans>Cancel</Trans>
									</PriButton>
								)}
							/>
							<PriButton
								type='button'
								$variant='filled'
								disabled={deletingId !== null}
								data-testid='api-key-delete-confirm'
								onClick={() => {
									void confirmDelete()
								}}
							>
								<Trash2 size={14} aria-hidden />
								<span>
									{deletingId !== null ? t`Deleting…` : t`Delete key`}
								</span>
							</PriButton>
						</ConfirmActions>
					</PriDialog.Popup>
				</PriDialog.Portal>
			</PriDialog.Root>
		</Page>
	)
}

function narrowKeys(rows: ReadonlyArray<unknown>): ReadonlyArray<ApiKeyRow> {
	const out: Array<ApiKeyRow> = []
	for (const row of rows) {
		if (!row || typeof row !== 'object') continue
		const r = row as Record<string, unknown>
		const id = typeof r['id'] === 'string' ? r['id'] : null
		const createdAt = typeof r['createdAt'] === 'string' ? r['createdAt'] : null
		if (id === null || createdAt === null) continue
		out.push({
			id,
			createdAt,
			name: typeof r['name'] === 'string' ? r['name'] : null,
			start: typeof r['start'] === 'string' ? r['start'] : null,
			prefix: typeof r['prefix'] === 'string' ? r['prefix'] : null,
			expiresAt: typeof r['expiresAt'] === 'string' ? r['expiresAt'] : null,
			enabled: r['enabled'] !== false,
			createdBy: narrowCreatedBy(r['createdBy']),
		})
	}
	return out
}

function narrowCreatedBy(
	value: unknown,
): { readonly name: string | null; readonly email: string } | null {
	if (!value || typeof value !== 'object') return null
	const v = value as Record<string, unknown>
	const email = typeof v['email'] === 'string' ? v['email'] : null
	if (email === null) return null
	return { name: typeof v['name'] === 'string' ? v['name'] : null, email }
}

function narrowCreated(value: unknown): CreatedApiKey | null {
	if (!value || typeof value !== 'object') return null
	const r = value as Record<string, unknown>
	if (typeof r['id'] !== 'string' || typeof r['key'] !== 'string') return null
	if (typeof r['createdAt'] !== 'string') return null
	return {
		id: r['id'],
		key: r['key'],
		createdAt: r['createdAt'],
		name: typeof r['name'] === 'string' ? r['name'] : null,
		start: typeof r['start'] === 'string' ? r['start'] : null,
		prefix: typeof r['prefix'] === 'string' ? r['prefix'] : null,
		expiresAt: typeof r['expiresAt'] === 'string' ? r['expiresAt'] : null,
	}
}

function formatDate(iso: string): string {
	const date = new Date(iso)
	if (Number.isNaN(date.getTime())) return iso
	return date.toLocaleDateString(undefined, {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
	})
}

const Page = styled.div.withConfig({ displayName: 'ApiKeysPage' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-lg);
`

const BackLink = styled(Link).withConfig({ displayName: 'ApiKeysBackLink' })`
	display: inline-flex;
	align-items: center;
	gap: var(--space-2xs);
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface-variant);
	text-decoration: none;
	width: fit-content;

	&:hover {
		color: var(--color-primary);
	}
`

const Intro = styled.div.withConfig({ displayName: 'ApiKeysIntro' })`
	${rulerUnderRule}
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
	padding-bottom: var(--space-xs);
`

const Heading = styled.h2.withConfig({ displayName: 'ApiKeysHeading' })`
	${stenciledTitle}
	display: inline-flex;
	align-items: center;
	gap: var(--space-2xs);
	font-size: var(--typescale-headline-large-size);
	line-height: var(--typescale-headline-large-line);
	margin: 0;
`

const Subtitle = styled.p.withConfig({ displayName: 'ApiKeysSubtitle' })`
	font-family: var(--font-body);
	font-size: var(--typescale-body-large-size);
	line-height: var(--typescale-body-large-line);
	font-style: italic;
	color: var(--color-on-surface-variant);
	margin: 0;
`

const CreateCard = styled.section.withConfig({
	displayName: 'ApiKeysCreateCard',
})`
	${brushedMetalPlate}
	display: flex;
	flex-direction: column;
	gap: var(--space-md);
	padding: var(--space-md);
	border-radius: var(--shape-2xs);
`

const SectionTitle = styled.h3.withConfig({
	displayName: 'ApiKeysSectionTitle',
})`
	${stenciledTitle}
	font-size: var(--typescale-title-medium-size);
	line-height: var(--typescale-title-medium-line);
	margin: 0;
`

const CreateForm = styled.form.withConfig({ displayName: 'ApiKeysCreateForm' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-md);
`

const FieldRow = styled.div.withConfig({ displayName: 'ApiKeysFieldRow' })`
	display: flex;
	gap: var(--space-md);
	flex-wrap: wrap;

	> * {
		flex: 1 1 12rem;
	}
`

const Actions = styled.div.withConfig({ displayName: 'ApiKeysActions' })`
	display: flex;
	justify-content: flex-end;
`

const FormError = styled.p.withConfig({ displayName: 'ApiKeysFormError' })`
	margin: 0;
	padding: var(--space-2xs) var(--space-sm);
	border-left: 3px solid var(--color-error);
	background: color-mix(in srgb, var(--color-error) 6%, transparent);
	color: var(--color-error);
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	font-style: italic;
`

const ListSection = styled.section.withConfig({ displayName: 'ApiKeysList' })`
	${brushedMetalPlate}
	display: flex;
	flex-direction: column;
	gap: var(--space-sm);
	padding: var(--space-md);
	border-radius: var(--shape-2xs);
`

const Empty = styled.p.withConfig({ displayName: 'ApiKeysEmpty' })`
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	font-style: italic;
	color: var(--color-on-surface-variant);
	margin: 0;
`

const KeyList = styled.ul.withConfig({ displayName: 'ApiKeysKeyList' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-sm);
	margin: 0;
	padding: 0;
	list-style: none;
`

const KeyRow = styled.li.withConfig({ displayName: 'ApiKeysKeyRow' })`
	display: flex;
	align-items: center;
	gap: var(--space-md);
	padding: var(--space-sm) var(--space-md);
	border-radius: var(--shape-3xs);
	background: color-mix(in oklab, var(--color-on-surface) 4%, transparent);
	border: 1px solid color-mix(in oklab, var(--color-on-surface) 10%, transparent);
`

const KeyInfo = styled.div.withConfig({ displayName: 'ApiKeysKeyInfo' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
	flex: 1;
	min-width: 0;
`

const KeyName = styled.span.withConfig({ displayName: 'ApiKeysKeyName' })`
	${stenciledTitle}
	font-size: var(--typescale-title-small-size);
	overflow: hidden;
	text-overflow: ellipsis;
`

const KeyMeta = styled.div.withConfig({ displayName: 'ApiKeysKeyMeta' })`
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--space-2xs) var(--space-sm);
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface-variant);
`

const MaskedPrefix = styled.code.withConfig({
	displayName: 'ApiKeysMaskedPrefix',
})`
	font-family: var(--font-mono, ui-monospace, SFMono-Regular, monospace);
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface);
`

const MetaItem = styled.span.withConfig({ displayName: 'ApiKeysMetaItem' })`
	white-space: nowrap;
`

const DisabledTag = styled.span.withConfig({
	displayName: 'ApiKeysDisabledTag',
})`
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--color-error);
`

const SecretBox = styled.div.withConfig({ displayName: 'ApiKeysSecretBox' })`
	display: flex;
	align-items: stretch;
	gap: var(--space-sm);
	flex-wrap: wrap;
`

const SrOnly = styled.span.withConfig({ displayName: 'ApiKeysSrOnly' })`
	position: absolute;
	width: 1px;
	height: 1px;
	padding: 0;
	margin: -1px;
	overflow: hidden;
	clip: rect(0, 0, 0, 0);
	white-space: nowrap;
	border: 0;
`

const SecretValue = styled.code.withConfig({
	displayName: 'ApiKeysSecretValue',
})`
	flex: 1 1 16rem;
	min-width: 0;
	padding: var(--space-xs) var(--space-sm);
	background-color: var(--color-paper-aged);
	border: 1px dashed var(--color-outline);
	border-radius: var(--shape-3xs);
	font-family: var(--font-mono, ui-monospace, SFMono-Regular, monospace);
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface);
	word-break: break-all;
`

const RevealActions = styled.div.withConfig({
	displayName: 'ApiKeysRevealActions',
})`
	display: flex;
	justify-content: flex-end;
`

const ConfirmActions = styled.div.withConfig({
	displayName: 'ApiKeysConfirmActions',
})`
	display: flex;
	justify-content: flex-end;
	gap: var(--space-sm);
	flex-wrap: wrap;
`

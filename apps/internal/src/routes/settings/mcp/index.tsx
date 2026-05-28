import { Trans, useLingui } from '@lingui/react/macro'
import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowLeft, Check, Copy, Plug } from 'lucide-react'
import { useState } from 'react'
import styled from 'styled-components'

import { usePriToast } from '@batuda/ui/pri'

import { apiBaseUrl } from '#/lib/api-base'
import {
	brushedMetalPlate,
	rulerUnderRule,
	stenciledTitle,
} from '#/lib/workshop-mixins'

/**
 * Help page for connecting an AI tool to this org over MCP. Two paths: dev
 * tools paste a config snippet with an API key; chat interfaces (ChatGPT,
 * Claude.ai) can't carry a key, so they add the server by URL and approve it
 * over OAuth. Every snippet embeds the live server URL, so it's correct for
 * whichever environment the page is served from.
 */

export const Route = createFileRoute('/settings/mcp/')({
	head: () => ({ meta: [{ title: 'Connect AI tools — Batuda' }] }),
	component: McpSetupPage,
})

// The config snippet for each file-config tool, given the live MCP URL. Tool
// names, file paths, and the snippets themselves are not translated (brands,
// paths, code); only the surrounding guidance is.
type HeaderClient = {
	readonly id: string
	readonly label: string
	readonly where: string
	readonly snippet: (mcpUrl: string) => string
}

const jsonBlock = (server: Record<string, unknown>, key = 'mcpServers') =>
	JSON.stringify({ [key]: { batuda: server } }, null, 2)

const HEADER_CLIENTS: ReadonlyArray<HeaderClient> = [
	{
		id: 'claude-code',
		label: 'Claude Code',
		where: 'Terminal',
		snippet: url =>
			`claude mcp add --transport http batuda ${url} \\\n  --header "x-api-key: YOUR_API_KEY"`,
	},
	{
		id: 'cursor',
		label: 'Cursor',
		where: '~/.cursor/mcp.json',
		snippet: url =>
			jsonBlock({ url, headers: { 'x-api-key': 'YOUR_API_KEY' } }),
	},
	{
		id: 'vscode',
		label: 'VS Code (Copilot)',
		where: '.vscode/mcp.json',
		snippet: url =>
			jsonBlock(
				{ type: 'http', url, headers: { 'x-api-key': 'YOUR_API_KEY' } },
				'servers',
			),
	},
	{
		id: 'windsurf',
		label: 'Windsurf',
		where: '~/.codeium/windsurf/mcp_config.json',
		snippet: url =>
			jsonBlock({ serverUrl: url, headers: { 'x-api-key': 'YOUR_API_KEY' } }),
	},
	{
		id: 'codex',
		label: 'Codex CLI',
		where: '~/.codex/config.toml',
		snippet: url =>
			`[mcp_servers.batuda]\nurl = "${url}"\nhttp_headers = { "x-api-key" = "YOUR_API_KEY" }`,
	},
	{
		id: 'gemini',
		label: 'Gemini CLI',
		where: '~/.gemini/settings.json',
		snippet: url =>
			jsonBlock({ httpUrl: url, headers: { 'x-api-key': 'YOUR_API_KEY' } }),
	},
	{
		id: 'claude-desktop',
		label: 'Claude Desktop',
		where: 'claude_desktop_config.json',
		snippet: url =>
			jsonBlock({
				command: 'npx',
				// biome-ignore lint/suspicious/noTemplateCurlyInString: literal placeholder mcp-remote resolves from the env block below, not a JS template.
				args: ['-y', 'mcp-remote', url, '--header', 'x-api-key:${API_KEY}'],
				env: { API_KEY: 'YOUR_API_KEY' },
			}),
	},
]

function McpSetupPage() {
	const { t } = useLingui()
	const toastManager = usePriToast()
	const [copiedId, setCopiedId] = useState<string | null>(null)
	const [copiedLabel, setCopiedLabel] = useState('')
	const mcpUrl = `${apiBaseUrl()}/mcp`

	const copy = async (id: string, text: string, label: string) => {
		try {
			await navigator.clipboard.writeText(text)
			setCopiedId(id)
			// Drives a polite live region so the copy is announced, not just shown.
			setCopiedLabel(label)
			setTimeout(
				() => setCopiedId(current => (current === id ? null : current)),
				1500,
			)
		} catch {
			toastManager.add({
				title: t`Couldn't copy`,
				description: t`Select the text and copy it manually.`,
				type: 'error',
			})
		}
	}

	return (
		<Page>
			<Announce role='status' aria-live='polite'>
				{copiedId ? t`Copied ${copiedLabel}` : ''}
			</Announce>
			<BackLink to='/settings' aria-label={t`Back to settings`}>
				<ArrowLeft size={14} aria-hidden />
				<span>
					<Trans>Settings</Trans>
				</span>
			</BackLink>

			<Intro>
				<Heading>
					<Plug size={20} aria-hidden />
					<Trans>Connect AI tools over MCP</Trans>
				</Heading>
				<Subtitle>
					<Trans>
						Give an AI assistant access to this organization's CRM. Dev tools
						use an API key; chat interfaces connect over OAuth.
					</Trans>
				</Subtitle>
			</Intro>

			<Section>
				<SectionTitle>
					<Trans>Dev tools (API key)</Trans>
				</SectionTitle>
				<SectionLead>
					<Trans>
						Create an API key, then paste the snippet for your tool — replacing{' '}
						<Mono>YOUR_API_KEY</Mono> with it. The key acts in this
						organization.
					</Trans>{' '}
					<Link to='/settings/api-keys'>
						<Trans>Create an API key</Trans>
					</Link>
				</SectionLead>

				{HEADER_CLIENTS.map(client => {
					const snippet = client.snippet(mcpUrl)
					return (
						<ClientBlock key={client.id}>
							<BlockHead>
								<ClientName>{client.label}</ClientName>
								<Where>{client.where}</Where>
							</BlockHead>
							<CodeWrap>
								<Pre>
									<code>{snippet}</code>
								</Pre>
								<CopyButton
									type='button'
									data-testid={`mcp-copy-${client.id}`}
									aria-label={t`Copy the ${client.label} config`}
									onClick={() => void copy(client.id, snippet, client.label)}
								>
									{copiedId === client.id ? (
										<Check size={14} aria-hidden />
									) : (
										<Copy size={14} aria-hidden />
									)}
								</CopyButton>
							</CodeWrap>
							{client.id === 'gemini' ? (
								<Note>
									<Trans>
										Use <Mono>httpUrl</Mono>, not <Mono>url</Mono> — plain{' '}
										<Mono>url</Mono> selects the old SSE transport.
									</Trans>
								</Note>
							) : null}
							{client.id === 'claude-desktop' ? (
								<Note>
									<Trans>
										Claude Desktop can't reach a remote server directly, so this
										bridges through <Mono>mcp-remote</Mono> (needs Node
										installed). Or add it as an OAuth connector instead.
									</Trans>
								</Note>
							) : null}
						</ClientBlock>
					)
				})}
			</Section>

			<Section>
				<SectionTitle>
					<Trans>Chat interfaces (OAuth)</Trans>
				</SectionTitle>
				<SectionLead>
					<Trans>
						ChatGPT and Claude.ai can't send a key, so they connect over OAuth.
						Add this server by URL, approve it, and it appears under your
						connections.
					</Trans>
				</SectionLead>

				<UrlRow>
					<Pre>
						<code>{mcpUrl}</code>
					</Pre>
					<CopyButton
						type='button'
						data-testid='mcp-copy-url'
						aria-label={t`Copy the server URL`}
						onClick={() => void copy('url', mcpUrl, t`server URL`)}
					>
						{copiedId === 'url' ? (
							<Check size={14} aria-hidden />
						) : (
							<Copy size={14} aria-hidden />
						)}
					</CopyButton>
				</UrlRow>

				<Steps>
					<li>
						<Trans>
							<Strong>ChatGPT:</Strong> Settings → Connectors → turn on
							Developer mode → add the URL above and choose OAuth. (Plus, Pro,
							Business, Enterprise, or Edu.)
						</Trans>
					</li>
					<li>
						<Trans>
							<Strong>Claude.ai:</Strong> Settings → Connectors → Add custom
							connector → paste the URL above.
						</Trans>
					</li>
				</Steps>

				<SectionLead>
					<Trans>
						After approving, manage which org each one acts in here.
					</Trans>{' '}
					<Link to='/settings/mcp/connections'>
						<Trans>Your connections</Trans>
					</Link>
				</SectionLead>
			</Section>
		</Page>
	)
}

const Page = styled.div.withConfig({ displayName: 'McpSetupPage' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-lg);
`

// Off-screen but in the accessibility tree: a polite live region that announces
// a successful copy, which is otherwise only the icon swapping to a check.
const Announce = styled.span`
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

const BackLink = styled(Link).withConfig({ displayName: 'McpSetupBackLink' })`
	display: inline-flex;
	align-items: center;
	gap: var(--space-2xs);
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface-variant);
	text-decoration: none;
	width: fit-content;
	border-radius: var(--shape-3xs);

	&:hover {
		color: var(--color-primary);
	}

	&:focus-visible {
		outline: none;
		box-shadow: var(--glow-active);
	}
`

const Intro = styled.div.withConfig({ displayName: 'McpSetupIntro' })`
	${rulerUnderRule}
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
	padding-bottom: var(--space-xs);
`

const Heading = styled.h2.withConfig({ displayName: 'McpSetupHeading' })`
	${stenciledTitle}
	display: inline-flex;
	align-items: center;
	gap: var(--space-2xs);
	font-size: var(--typescale-headline-large-size);
	line-height: var(--typescale-headline-large-line);
	margin: 0;
`

const Subtitle = styled.p.withConfig({ displayName: 'McpSetupSubtitle' })`
	font-family: var(--font-body);
	font-size: var(--typescale-body-large-size);
	line-height: var(--typescale-body-large-line);
	font-style: italic;
	color: var(--color-on-surface-variant);
	margin: 0;
`

const Section = styled.section.withConfig({ displayName: 'McpSetupSection' })`
	${brushedMetalPlate}
	display: flex;
	flex-direction: column;
	gap: var(--space-sm);
	padding: var(--space-md);
	border-radius: var(--shape-2xs);
`

const SectionTitle = styled.h3.withConfig({
	displayName: 'McpSetupSectionTitle',
})`
	${stenciledTitle}
	font-size: var(--typescale-title-medium-size);
	line-height: var(--typescale-title-medium-line);
	margin: 0;
`

const SectionLead = styled.p.withConfig({ displayName: 'McpSetupLead' })`
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	line-height: var(--typescale-body-medium-line);
	color: var(--color-on-surface-variant);
	margin: 0;

	a {
		color: var(--color-primary);
		border-radius: var(--shape-3xs);
	}

	a:focus-visible {
		outline: none;
		box-shadow: var(--glow-active);
		text-decoration: underline;
	}
`

const ClientBlock = styled.div.withConfig({ displayName: 'McpSetupClient' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
`

const BlockHead = styled.div.withConfig({ displayName: 'McpSetupBlockHead' })`
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: var(--space-sm);
	flex-wrap: wrap;
`

const ClientName = styled.span.withConfig({
	displayName: 'McpSetupClientName',
})`
	${stenciledTitle}
	font-size: var(--typescale-title-small-size);
`

const Where = styled.code.withConfig({ displayName: 'McpSetupWhere' })`
	font-family: var(--font-mono, ui-monospace, SFMono-Regular, monospace);
	font-size: var(--typescale-label-small-size);
	color: var(--color-on-surface-variant);
`

const CodeWrap = styled.div.withConfig({ displayName: 'McpSetupCodeWrap' })`
	position: relative;
`

const Pre = styled.pre.withConfig({ displayName: 'McpSetupPre' })`
	margin: 0;
	padding: var(--space-sm);
	padding-right: var(--space-xl);
	border-radius: var(--shape-3xs);
	background: color-mix(in oklab, var(--color-on-surface) 6%, transparent);
	border: 1px solid color-mix(in oklab, var(--color-on-surface) 10%, transparent);
	overflow-x: auto;
	font-family: var(--font-mono, ui-monospace, SFMono-Regular, monospace);
	font-size: var(--typescale-body-small-size);
	line-height: 1.5;
	color: var(--color-on-surface);
	white-space: pre;
`

const CopyButton = styled.button.withConfig({ displayName: 'McpSetupCopy' })`
	position: absolute;
	top: var(--space-2xs);
	right: var(--space-2xs);
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 1.75rem;
	height: 1.75rem;
	border-radius: var(--shape-3xs);
	border: 1px solid var(--color-outline);
	background: var(--color-surface);
	color: var(--color-on-surface-variant);
	cursor: pointer;

	&:hover {
		color: var(--color-primary);
	}

	&:focus-visible {
		outline: none;
		box-shadow: var(--glow-active);
	}
`

const Note = styled.p.withConfig({ displayName: 'McpSetupNote' })`
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	font-style: italic;
	color: var(--color-on-surface-variant);
	margin: 0;
`

const UrlRow = styled.div.withConfig({ displayName: 'McpSetupUrlRow' })`
	position: relative;
`

const Steps = styled.ul.withConfig({ displayName: 'McpSetupSteps' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-xs);
	margin: 0;
	padding-left: var(--space-md);
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	line-height: var(--typescale-body-medium-line);
	color: var(--color-on-surface);
`

const Strong = styled.strong.withConfig({ displayName: 'McpSetupStrong' })`
	font-weight: 700;
`

const Mono = styled.code.withConfig({ displayName: 'McpSetupMono' })`
	font-family: var(--font-mono, ui-monospace, SFMono-Regular, monospace);
	font-size: 0.92em;
	padding: 0 var(--space-3xs);
	border-radius: var(--shape-3xs);
	background: color-mix(in oklab, var(--color-on-surface) 8%, transparent);
`

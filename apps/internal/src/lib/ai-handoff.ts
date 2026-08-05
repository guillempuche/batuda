/**
 * Links that carry a question about something in the CRM into a chat.
 *
 * Batuda's own answer to "now do something with this company" is the chat
 * assistant, not another screen here: Settings → MCP walks people through
 * connecting this organisation to Claude.ai or ChatGPT, and once that is done
 * the assistant can read and write the same records. These links are the bridge
 * from a row on screen to that conversation.
 *
 * The wording is the caller's, so it arrives in whatever language the person is
 * reading the app in.
 *
 * **Why the prompt is also copied.** Neither service documents a way to open its
 * web chat with the question already typed. Anthropic documents `q` only for the
 * desktop scheme (`claude://claude.ai/new?q=…`) and `prompt` only for Claude
 * Code (`claude.ai/code`), neither of which is the plain chat this points at;
 * OpenAI's `?q=` is widely used but appears in no help page of theirs. So `q` is
 * still sent — it costs nothing and works where it is honoured — but the caller
 * puts the question on the clipboard as well, and a chat that opens empty is one
 * paste away rather than a dead end. Revisit if either service ever documents
 * this properly.
 */

export type AiAssistant = 'claude' | 'chatgpt'

const NEW_CHAT_URL: Record<AiAssistant, string> = {
	claude: 'https://claude.ai/new',
	chatgpt: 'https://chatgpt.com/',
}

/**
 * A link to a new chat, asking `prompt` where the service honours it. Pair it
 * with putting `prompt` on the clipboard — see the note above.
 */
export function aiChatUrl(assistant: AiAssistant, prompt: string): string {
	const url = new URL(NEW_CHAT_URL[assistant])
	url.searchParams.set('q', prompt)
	return url.toString()
}

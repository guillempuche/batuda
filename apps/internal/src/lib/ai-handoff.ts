/**
 * Links that open a chat already asking about something in the CRM.
 *
 * Batuda's own answer to "now do something with this company" is the chat
 * assistant, not another screen here: Settings → MCP walks people through
 * connecting this organisation to Claude.ai or ChatGPT, and once that is done
 * the assistant can read and write the same records. These links are the bridge
 * from a row on screen to that conversation, with the question already typed.
 *
 * The wording is the caller's, so it arrives in whatever language the person is
 * reading the app in.
 *
 * The query parameter each service reads is the one thing here that belongs to
 * somebody else and can change without warning. Both are kept in this one place
 * so following them is a single edit.
 */

export type AiAssistant = 'claude' | 'chatgpt'

const NEW_CHAT_URL: Record<AiAssistant, string> = {
	claude: 'https://claude.ai/new',
	chatgpt: 'https://chatgpt.com/',
}

/** A link that opens a new chat with `prompt` already in the box. */
export function aiChatUrl(assistant: AiAssistant, prompt: string): string {
	const url = new URL(NEW_CHAT_URL[assistant])
	url.searchParams.set('q', prompt)
	return url.toString()
}

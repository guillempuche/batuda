/**
 * Removes a model's chain-of-thought from text before it is persisted or read.
 *
 * Open-weights models routinely wrap their reasoning in `<think>…</think>` (or
 * `<thinking>…</thinking>`) and emit it inline ahead of the real answer. Left in,
 * it lands verbatim in the human-facing brief and in the transcript the extractor
 * reads. This strips those blocks — the reasoning is never part of the output.
 *
 * Only whole `<think>…</think>` pairs are removed. A lone stray tag is left alone
 * on purpose: this also runs over the concatenated agent transcript, where a
 * scraped page could carry an unpaired tag, and dropping text around it would
 * discard real evidence.
 */

// Non-greedy so several blocks in one string each go; case-insensitive because
// models vary the tag casing; `[\s\S]` so a multi-line block matches.
const REASONING_BLOCK = /<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi

export const stripReasoning = (text: string): string =>
	text.replace(REASONING_BLOCK, '').trim()

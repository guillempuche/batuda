import { Prompt, Response } from 'effect/unstable/ai'
import { describe, expect, it } from 'vitest'

import {
	MAX_PROMPT_PASSAGES,
	PROMPT_PASSAGE_MIN_CHARS,
	PROMPT_PASSAGES_CHARS_PER_ANSWER,
	PROMPT_SNIPPET_CHARS,
	passageShare,
	promptCharsOf,
	responsePartsForPrompt,
	searchResultForPrompt,
} from './search-result-for-prompt'

const longPassage = 'instal·lacions elèctriques a Girona. '.repeat(400)

const searchAnswer = {
	items: [
		{
			url: 'https://valenti.example/',
			title: 'Valentí Serveis i Instal·lacions',
			snippet: 'Instal·lació i manteniment de sistemes industrials.',
			content: longPassage,
		},
		{
			url: 'https://electer.example/',
			title: 'Electer',
			snippet: 's'.repeat(PROMPT_SNIPPET_CHARS + 50),
		},
	],
	units: 1,
}

const toolResult = (
	name: string,
	result: unknown,
	isFailure = false,
): Response.AnyPart =>
	Response.makePart('tool-result', {
		id: `call-${name}`,
		name,
		isFailure,
		result,
		encodedResult: result,
		providerExecuted: false,
		preliminary: false,
	})

describe('searchResultForPrompt', () => {
	describe('when a result carries a long passage of its page', () => {
		it('should keep where it is and what it is called, and cut the passage to its opening', () => {
			// GIVEN a search answer whose first result brought a long passage

			// WHEN shortened for the prompt
			const shortened = searchResultForPrompt(searchAnswer) as {
				items: ReadonlyArray<Record<string, string>>
				units: number
			}

			// THEN the address and title are whole and the passage is its opening
			expect(shortened.items[0]?.['url']).toBe('https://valenti.example/')
			expect(shortened.items[0]?.['title']).toBe(
				'Valentí Serveis i Instal·lacions',
			)
			expect(shortened.items[0]?.['content']).toBe(
				`${longPassage.slice(0, passageShare(1))}…`,
			)
			// AND a short summary line is left alone
			expect(shortened.items[0]?.['snippet']).toBe(
				'Instal·lació i manteniment de sistemes industrials.',
			)
			// AND what the answer says beside its results rides along
			expect(shortened.units).toBe(1)
		})

		it('should not touch the answer it was handed', () => {
			// GIVEN the same answer

			// WHEN shortened
			searchResultForPrompt(searchAnswer)

			// THEN the passage the run grounds on is still whole
			expect(searchAnswer.items[0]?.content).toBe(longPassage)
		})
	})

	describe('when many results bring a passage', () => {
		it('should share one allowance between them, and show no passage once it is spent', () => {
			// GIVEN answers of three and of forty results, every one with a long passage
			const answerOf = (count: number) => ({
				items: Array.from({ length: count }, (_, n) => ({
					url: `https://r${n}.example/`,
					title: `Result ${n}`,
					snippet: 's',
					content: longPassage,
				})),
			})
			const passagesOf = (count: number) =>
				(
					searchResultForPrompt(answerOf(count)) as {
						items: ReadonlyArray<{ content?: string }>
					}
				).items.map(item => item.content?.length ?? 0)

			// THEN three results keep a third of the allowance each
			expect(passagesOf(3)).toEqual(
				Array(3).fill(PROMPT_PASSAGES_CHARS_PER_ANSWER / 3 + 1),
			)
			// AND of forty, as many as the allowance reaches are shown the least
			// any result is shown and the rest go without, so the total holds
			expect(passagesOf(40)).toEqual([
				...Array(MAX_PROMPT_PASSAGES).fill(PROMPT_PASSAGE_MIN_CHARS + 1),
				...Array(40 - MAX_PROMPT_PASSAGES).fill(0),
			])
			// AND a result that lost its passage still says where and what it is
			const last = (
				searchResultForPrompt(answerOf(40)) as {
					items: ReadonlyArray<Record<string, unknown>>
				}
			).items[39]
			expect(last).toEqual({
				url: 'https://r39.example/',
				title: 'Result 39',
				snippet: 's',
			})
		})

		it('should not count a result without a passage against the allowance', () => {
			// GIVEN the answer above: one result with a passage, one without

			// THEN the one passage has the whole allowance
			expect(passageShare(1)).toBe(PROMPT_PASSAGES_CHARS_PER_ANSWER)
			const shortened = searchResultForPrompt(searchAnswer) as {
				items: ReadonlyArray<{ content?: string }>
			}
			expect(shortened.items[0]?.content).toHaveLength(
				PROMPT_PASSAGES_CHARS_PER_ANSWER + 1,
			)
		})
	})

	describe('when a result has a long summary line and no passage', () => {
		it('should cut the summary line and add no passage', () => {
			// WHEN shortened
			const shortened = searchResultForPrompt(searchAnswer) as {
				items: ReadonlyArray<Record<string, string>>
			}

			// THEN the line is its opening and there is still no passage
			expect(shortened.items[1]?.['snippet']).toHaveLength(
				PROMPT_SNIPPET_CHARS + 1,
			)
			expect('content' in (shortened.items[1] ?? {})).toBe(false)
		})
	})

	describe('when the answer is not a list of results', () => {
		it('should hand it back as it came', () => {
			// GIVEN a refusal, an error's words, nothing, and a list of oddities
			const refusal = { status: 'budget_exhausted' }
			const oddities = { items: ['not a result', 7, null] }

			// THEN each comes back unchanged
			expect(searchResultForPrompt(refusal)).toBe(refusal)
			expect(searchResultForPrompt('provider error')).toBe('provider error')
			expect(searchResultForPrompt(null)).toBeNull()
			expect(searchResultForPrompt(oddities)).toEqual(oddities)
		})
	})
})

describe('responsePartsForPrompt', () => {
	describe('when a round searched and opened a page', () => {
		it('should shorten the search and leave the page and the calls as they came', () => {
			// GIVEN a round's reply: two calls, a search answer and a page
			const page = { url: 'https://valenti.example/', markdown: longPassage }
			const call = Response.makePart('tool-call', {
				id: 'call-web_search',
				name: 'web_search',
				params: { query: 'instal·ladors Girona' },
				providerExecuted: false,
			})
			const parts = [
				call,
				toolResult('web_search', searchAnswer),
				toolResult('scrape_page', page),
			]

			// WHEN prepared for the prompt
			const prepared = responsePartsForPrompt(parts)

			// THEN the call and the page are the very same parts
			expect(prepared[0]).toBe(parts[0])
			expect(prepared[2]).toBe(parts[2])
			// AND the search is a copy with the same id and name, shortened
			const search = prepared[1] as Response.AnyPart & {
				id: string
				name: string
				encodedResult: { items: ReadonlyArray<{ content?: string }> }
			}
			expect(search).not.toBe(parts[1])
			expect(search.id).toBe('call-web_search')
			expect(search.name).toBe('web_search')
			expect(search.encodedResult.items[0]?.content?.length).toBe(
				passageShare(1) + 1,
			)
			// AND the part the run reads afterwards still holds the whole passage
			expect(
				(parts[1] as unknown as { result: typeof searchAnswer }).result.items[0]
					?.content,
			).toBe(longPassage)
		})

		it('should still give every call its answer once the prompt is built', () => {
			// GIVEN a reply with one call and its answer
			const parts = [
				Response.makePart('tool-call', {
					id: 'call-web_search',
					name: 'web_search',
					params: { query: 'instal·ladors Girona' },
					providerExecuted: false,
				}),
				toolResult('web_search', searchAnswer),
			]

			// WHEN the prompt is built from the prepared parts
			const prompt = Prompt.fromResponseParts(responsePartsForPrompt(parts))

			// THEN the tool message answers the call by id, with the shorter text
			const toolMessage = prompt.content.find(
				message => message.role === 'tool',
			)
			const answer = toolMessage?.content[0] as
				| { id: string; result: { items: ReadonlyArray<{ content?: string }> } }
				| undefined
			expect(answer?.id).toBe('call-web_search')
			expect(answer?.result.items[0]?.content?.length).toBe(passageShare(1) + 1)
		})
	})

	describe('when a search failed', () => {
		it('should leave the failure as it came', () => {
			// GIVEN a failed search whose answer happens to look like results
			const parts = [toolResult('web_search', searchAnswer, true)]

			// THEN the part is handed back untouched
			expect(responsePartsForPrompt(parts)[0]).toBe(parts[0])
		})
	})

	describe('when there is nothing in the reply', () => {
		it('should hand back nothing', () => {
			expect(responsePartsForPrompt([])).toEqual([])
		})
	})
})

describe('promptCharsOf', () => {
	describe('when a reply holds a tool answer', () => {
		it('should count the answer once, as the text the prompt takes', () => {
			// GIVEN a page answer, which the part holds twice over
			const page = { url: 'https://valenti.example/', markdown: longPassage }
			const parts = [toolResult('scrape_page', page)]

			// WHEN counted
			const counted = promptCharsOf(parts)

			// THEN it is about one copy of the page, not two
			expect(counted).toBeGreaterThan(longPassage.length)
			expect(counted).toBeLessThan(longPassage.length * 1.5)
		})

		it('should count a shortened search by its shorter text', () => {
			// GIVEN a search answer before and after shortening
			const parts = [toolResult('web_search', searchAnswer)]

			// THEN the prepared parts count far less than the passage they left out
			expect(promptCharsOf(responsePartsForPrompt(parts))).toBeLessThan(
				longPassage.length / 2,
			)
		})
	})

	describe('when a reply holds only the model’s words', () => {
		it('should count the part as written', () => {
			const parts = [Response.makePart('text', { text: 'Buscaré gremis.' })]
			expect(promptCharsOf(parts)).toBe(JSON.stringify(parts[0]).length)
		})
	})

	describe('when the reply is empty', () => {
		it('should count nothing', () => {
			expect(promptCharsOf([])).toBe(0)
		})
	})
})

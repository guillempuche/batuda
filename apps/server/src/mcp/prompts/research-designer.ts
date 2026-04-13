import { Effect, Schema } from 'effect'
import { McpServer } from 'effect/unstable/ai'

import { schemaRegistry } from '@engranatge/research'

import { LangParam, langDirective } from './_lang'

export const ResearchDesignerPrompt = McpServer.prompt({
	name: 'research-designer',
	description:
		'Help a user design a research query: choose a schema, set budget, phrase the question.',
	parameters: {
		topic: Schema.String,
		lang: LangParam,
	},
	content: ({ topic, lang }) =>
		Effect.gen(function* () {
			const schemaNames = Object.keys(schemaRegistry)

			return `${langDirective(lang)}

You are helping design a research query for the Forja CRM research engine.

**Topic:** ${topic}

**Available schemas:**
${schemaNames.map(name => `- \`${name}\``).join('\n')}

Guide the user through:
1. **Query phrasing** — write a clear, specific research query that will guide the AI agent
2. **Schema selection** — which output schema fits best? Explain the trade-offs
3. **Context** — should this be anchored to existing CRM rows? If so, which?
4. **Budget** — estimate the likely cost tier (free registry, cheap web scraping, or paid reports)
5. **Hints** — suggest language, recency, and location hints if relevant

Output a ready-to-use JSON body for \`POST /research\`.`
		}),
})

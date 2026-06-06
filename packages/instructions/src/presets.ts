import type { Agent } from './domain'

// A Batuda-authored instruction template the user can import into their org or
// personal library. Importing copies the body into an `instruction_templates`
// row (recording `source_preset_id`); the catalog itself is code — versioned
// with the app, never user-edited — and can seed an org default stack.
export interface InstructionPreset {
	readonly id: string
	readonly name: string
	readonly agent: Agent
	readonly body: string
}

export const instructionPresets: ReadonlyArray<InstructionPreset> = [
	{
		id: 'research-icp-qualification',
		name: '[research] ICP qualification',
		agent: 'research',
		body: [
			'When researching a company, always assess fit against the ideal customer profile:',
			"- Note the company's size, sector, and apparent buying stage.",
			'- Call out concrete signals of need for the offering, and any disqualifiers.',
			'- End with a one-line verdict — strong fit, possible fit, or poor fit — and the single most important reason.',
		].join('\n'),
	},
	{
		id: 'research-spain-market',
		name: '[research] Spain market sourcing',
		agent: 'research',
		body: [
			'Prioritise primary Spanish-language sources for companies based in Spain:',
			"- Prefer official registries, the company's own site, and reputable local press over aggregators.",
			'- Capture the legal name and any trading names, plus the province or city.',
			'- Keep figures in their original currency and note the date they refer to.',
		].join('\n'),
	},
	{
		id: 'research-concise-brief',
		name: '[research] Concise brief',
		agent: 'research',
		body: [
			'Write the brief to be skimmed in under a minute:',
			'- Lead with the conclusion, then the few facts that support it.',
			'- Use short sentences and plain words; avoid filler and hedging.',
			'- Omit anything you could not verify from a source.',
		].join('\n'),
	},
]

export const presetById = (id: string): InstructionPreset | undefined =>
	instructionPresets.find(preset => preset.id === id)

export const presetsForAgent = (
	agent: Agent,
): ReadonlyArray<InstructionPreset> =>
	instructionPresets.filter(preset => preset.agent === agent)

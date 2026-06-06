// AI instruction templates — a surface-neutral library of named prompt blocks
// (org + user owned) and per-agent default stacks. An agent resolves an ordered
// stack into prompt segments + a cache fingerprint at run time. The tables' DDL
// lives with the app's migrations, not here; this package owns the logic.

export type {
	Agent,
	AgentDefaultStack,
	InstructionTemplate,
	StackItem,
} from './domain'
export { AgentSchema, agents } from './domain'
export { fingerprintTemplates } from './fingerprint'
export type { InstructionPreset } from './presets'
export { instructionPresets, presetById, presetsForAgent } from './presets'
export type {
	ResolvedInstructions,
	ResolveInstructionsArgs,
	StackSource,
} from './resolver'
export {
	assembleSegments,
	personalTemplatesInOrgStack,
	pickStackSource,
	resolveInstructions,
} from './resolver'

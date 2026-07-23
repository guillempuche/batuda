// AI instruction templates — a surface-neutral library of named prompt blocks
// (org + user owned) and per-agent default stacks. An agent resolves an ordered
// stack into prompt segments + a cache fingerprint at run time. The tables' DDL
// lives with the app's migrations, not here; this package owns the logic.

export type {
	Agent,
	InstructionStack,
	InstructionTemplate,
	StackComposition,
	StackItem,
} from './domain'
export { AgentSchema, agents } from './domain'
export { fingerprintTemplates } from './fingerprint'
export type {
	CreateStackInput,
	CreateTemplateInput,
	DeleteTemplateResult,
	StackSummary,
	StackWriteResult,
} from './management'
export {
	clearDefaultStack,
	createStack,
	createTemplate,
	deleteStack,
	deleteTemplate,
	forkTemplate,
	getDefaultStacks,
	getStack,
	getTemplate,
	listStacks,
	listTemplates,
	setDefaultStack,
	transferTemplateToUser,
	updateStack,
	updateTemplateFields,
} from './management'
export type {
	StackTemplatesCheck,
	TemplateEditMode,
} from './management-logic'
export { classifyStackTemplates, decideTemplateEdit } from './management-logic'
export type {
	AmbiguousRef,
	InstructionCandidate,
	ResolvedInstructions,
	ResolveInstructionsArgs,
	ResolveRefsResult,
	ResolveStackRefResult,
	StackCandidate,
	StackSource,
} from './resolver'
export {
	assembleSegments,
	classifyInstructionRefs,
	classifyStackRef,
	isUuidRef,
	personalTemplatesInOrgStack,
	pickStackSource,
	resolveInstructionRefs,
	resolveInstructions,
	resolveStackRef,
} from './resolver'

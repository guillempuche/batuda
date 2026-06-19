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
export type {
	AcceptDonationResult,
	CreateTemplateInput,
	DeleteTemplateResult,
	Donation,
	ProposeDonationInput,
	RejectDonationResult,
	SetDefaultStackInput,
	SetDefaultStackResult,
	StackView,
} from './management'
export {
	acceptDonation,
	clearUserDefaultStack,
	createTemplate,
	deleteTemplate,
	forkTemplate,
	getDefaultStacks,
	getTemplate,
	listDonations,
	listTemplates,
	proposeDonation,
	rejectDonation,
	setDefaultStack,
	transferTemplateToUser,
	updateTemplateFields,
} from './management'
export type {
	StackTemplatesCheck,
	TemplateEditMode,
} from './management-logic'
export { classifyStackTemplates, decideTemplateEdit } from './management-logic'
export type {
	ResolvedInstructions,
	ResolveInstructionsArgs,
	StackComposition,
	StackSource,
} from './resolver'
export {
	assembleSegments,
	personalTemplatesInOrgStack,
	pickStackSource,
	resolveInstructions,
} from './resolver'

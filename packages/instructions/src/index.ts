// AI instruction templates — a surface-neutral library of named prompt blocks
// (org + user owned) and per-agent default stacks. An agent resolves an ordered
// stack into prompt segments + a cache fingerprint at run time. The tables' DDL
// lives with the app's migrations, not here; this package owns the logic.

export type {
	AttributeFilter,
	AttributeFilterCheck,
	AttributeWriteCheck,
	AttributeWritePlan,
	AttributeWriteResult,
	CheckedValue,
	CleanDeclaration,
	CreateAttributeInput,
	DeclarationCheck,
	DeclarationContext,
	DeclarationInput,
	DeclarationRefusal,
	DeclaredAttribute,
	DeclaredShape,
	FilterRefusal,
	UpdateAttributeFields,
	WriteRefusal,
} from './attributes'
export {
	createAttribute,
	declaredByKey,
	deleteAttribute,
	getAttribute,
	listActiveAttributes,
	listAttributes,
	readStackAttributesForRun,
	sameShape,
	toDeclaration,
	updateAttribute,
	validateAttributeFilter,
	validateAttributeWrite,
	validateDeclaration,
	validateKey,
} from './attributes'
export type {
	Agent,
	InstructionStack,
	InstructionTemplate,
	ResearchAttribute,
	StackComposition,
	StackItem,
} from './domain'
export { AgentSchema, agents } from './domain'
export { fingerprintAttributes, fingerprintTemplates } from './fingerprint'
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
	getDefaultStacks,
	getStack,
	getTemplate,
	listStacks,
	listTemplates,
	setDefaultStack,
	templateInUse,
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
	personalTemplatesInOrgStack,
	pickStackSource,
	resolveInstructionRefs,
	resolveInstructions,
	resolveStackRef,
} from './resolver'
export { isUuidRef } from './uuid'

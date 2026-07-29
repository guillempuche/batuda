import { personalTemplatesInOrgStack } from './resolver'

// Pure management decisions, separated from the SQL layer so every branch can be
// unit-tested without a database.

export type TemplateEditMode = 'in_place' | 'deny'

// How an edit to a template should be applied:
//   - you edit your own template in place;
//   - anyone in the organization edits a template the organization owns in
//     place, because shared guidance is everyone's to look after;
//   - editing someone else's personal template is denied (RLS hides it anyway).
export const decideTemplateEdit = (args: {
	readonly ownerUserId: string | null
	readonly actorUserId: string
}): TemplateEditMode =>
	args.ownerUserId === args.actorUserId || args.ownerUserId === null
		? 'in_place'
		: 'deny'

export type StackTemplatesCheck =
	| { readonly kind: 'ok' }
	| { readonly kind: 'unknown'; readonly missing: ReadonlyArray<string> }
	| {
			readonly kind: 'personal_in_org'
			readonly offending: ReadonlyArray<string>
	  }

// Validate the templates a default stack references: every requested id must be
// readable (present in `found`), and an org stack may reference only org-owned
// templates (otherwise a personal template would be hidden by RLS from other
// members and silently dropped from their resolved prompt).
export const classifyStackTemplates = (args: {
	readonly requestedIds: ReadonlyArray<string>
	readonly found: ReadonlyArray<{
		readonly id: string
		readonly ownerUserId: string | null
	}>
	readonly isOrgStack: boolean
}): StackTemplatesCheck => {
	const foundIds = new Set(args.found.map(t => t.id))
	const missing = args.requestedIds.filter(id => !foundIds.has(id))
	if (missing.length > 0) return { kind: 'unknown', missing }
	if (args.isOrgStack) {
		const offending = personalTemplatesInOrgStack(
			args.found.map(t => ({ templateId: t.id, ownerUserId: t.ownerUserId })),
		)
		if (offending.length > 0) return { kind: 'personal_in_org', offending }
	}
	return { kind: 'ok' }
}

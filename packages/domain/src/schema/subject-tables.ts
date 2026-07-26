import { Schema } from 'effect'

// The CRM rows something can be attached to. A link row names its target as a
// table name plus an id — one foreign key cannot point at several different
// tables — so the name is checked against a fixed list, kept here so everything
// reading or writing a link agrees on it. The checks stay unnamed on purpose: a
// name would reach outside systems in place of the values it allows.

// A research run reaches only these two — it enriches an organisation or a
// person, and has nothing to say about a task or a meeting.
export const RESEARCH_SUBJECT_TABLES = ['companies', 'contacts'] as const
export const ResearchSubjectTable = Schema.Literals(RESEARCH_SUBJECT_TABLES)
export type ResearchSubjectTable = typeof ResearchSubjectTable.Type

// Notes get written about anything, so a document also hangs off the work in
// flight — a task, an offer, a meeting — not just the organisation or person.
export const DOCUMENT_SUBJECT_TABLES = [
	'companies',
	'contacts',
	'tasks',
	'proposals',
	'calendar_events',
] as const
export const DocumentSubjectTable = Schema.Literals(DOCUMENT_SUBJECT_TABLES)
export type DocumentSubjectTable = typeof DocumentSubjectTable.Type

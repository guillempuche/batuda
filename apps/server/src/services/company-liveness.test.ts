// A deleted company's records are hidden by asking about the company they
// belong to, because they carry no deleted mark of their own. That question has
// to be asked by every read of them, and the leak this guards against is the one
// read where somebody forgets — the records stay on their list, each pointing at
// a company nobody can open.
//
// What this catches: a file that reads company-linked rows and asks the question
// nowhere. What it cannot catch: a second query added inside a file that already
// asks it once. The exempt list below is the honest part — each entry says why
// that file is allowed to read without asking.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const SERVER_SRC = join(import.meta.dirname, '..')

// The tables whose rows belong to a company and have no deleted mark of their
// own, so their visibility is the company's.
const COMPANY_LINKED = [
	'FROM tasks',
	'FROM interactions',
	'FROM proposals',
	'FROM timeline_activity',
	'FROM calendar_events',
	'FROM document_links',
]

const READERS = [
	'handlers/calendar.ts',
	'handlers/documents.ts',
	'handlers/interactions.ts',
	'handlers/proposals.ts',
	'handlers/timeline.ts',
	'mcp/prompts/company-research.ts',
	'mcp/prompts/daily-briefing.ts',
	'mcp/prompts/interaction-follow-up.ts',
	'mcp/resources/document.ts',
	'mcp/resources/timeline.ts',
	'mcp/tools/calendar.ts',
	'mcp/tools/documents.ts',
	'mcp/tools/interactions.ts',
	'mcp/tools/proposals.ts',
	'mcp/tools/tasks.ts',
	'mcp/tools/timeline.ts',
	'services/calendar-forward-dispatch.ts',
	'services/calendar-rsvp-dispatch.ts',
	'services/calendar.ts',
	'services/companies.ts',
	'services/documents.ts',
	'services/org-resolution.ts',
	'services/pipeline.ts',
	'services/recordings.ts',
	'services/tasks.ts',
	'services/timeline-activity.ts',
]

// Files that read these tables without asking, on purpose. Anything not listed
// here has to ask, so a new reader fails this until somebody decides which it is.
const EXEMPT = new Map<string, string>([
	[
		'services/pipeline.ts',
		'Names the company itself in each query, joining companies directly rather than through the shared predicate.',
	],
	[
		'services/timeline-activity.ts',
		'Writes the rows rather than listing them, and the company it writes against is checked before the write.',
	],
	[
		'services/companies.ts',
		'Reads within one company that has already been resolved as visible.',
	],
	[
		'services/documents.ts',
		'Resolves a document by id and checks the subject separately through requireLiveCompany.',
	],
	[
		'services/org-resolution.ts',
		'Resolves which organisation a request belongs to, before any company is in play.',
	],
	[
		'services/recordings.ts',
		'Keyed on a call recording, whose own deleted mark is what hides it.',
	],
	[
		'services/calendar-rsvp-dispatch.ts',
		'Reads a calendar event and its message to answer an invitation; no company list is shown.',
	],
	[
		'services/calendar-forward-dispatch.ts',
		'Resolves one recipient to forward an invitation to; no company list is shown.',
	],
	[
		'mcp/tools/tasks.ts',
		'Lists tasks through TaskService, which asks on its behalf; its own read is one task fetched by id after an update that changed nothing.',
	],
	[
		'mcp/prompts/daily-briefing.ts',
		'Reads through PipelineService, which asks on its behalf.',
	],
	[
		'mcp/resources/document.ts',
		'Resolves one document by id, whose subject links are checked where they are written.',
	],
	[
		'handlers/documents.ts',
		'Resolves documents by id and subject, checked through requireLiveCompany where linked.',
	],
	[
		'mcp/tools/documents.ts',
		'Resolves documents by id and subject, checked through requireLiveCompany where linked.',
	],
])

const read = (relative: string): string =>
	readFileSync(join(SERVER_SRC, relative), 'utf8')

describe('reads of a company’s records', () => {
	describe('when a file lists rows that belong to a company', () => {
		it('should ask whether that company can still be seen', () => {
			// GIVEN every file that reads a company-linked table
			const missing = READERS.filter(relative => {
				if (EXEMPT.has(relative)) return false
				const source = read(relative)
				const readsThem = COMPANY_LINKED.some(table => source.includes(table))
				return readsThem && !source.includes('companyVisible')
			})

			// THEN each of them asks, or says in the exempt list above why it does
			// not — a reader that does neither is the leak this exists to catch
			expect(missing).toEqual([])
		})
	})
})

describe('the exempt list', () => {
	describe('when a file is allowed to read without asking', () => {
		it('should still be a file that exists and reads these rows', () => {
			// GIVEN exemptions granted for a reason
			const stale = [...EXEMPT.keys()].filter(relative => {
				if (!READERS.includes(relative)) return true
				const source = read(relative)
				return !COMPANY_LINKED.some(table => source.includes(table))
			})

			// THEN none of them is left over from a file that has since changed,
			// because a stale exemption silently excuses a real reader later
			expect(stale).toEqual([])
		})
	})
})

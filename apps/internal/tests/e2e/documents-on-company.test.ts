import { execSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

import { expect, test } from '@playwright/test'

import { DATABASE_URL } from './helpers/database-url'
import { waitForInteractive } from './helpers/hydration'
import { setActiveOrgBySlug } from './helpers/set-active-org'

// Covers the documents panel on the company Files tab: list, read, create and
// edit.
//
// Both write paths assert against the database, because the dialog closing
// only proves the mutation resolved — not that the row carries the title,
// type and content that were typed.
//
// Selectors verified against:
//   apps/internal/src/components/companies/documents-panel.tsx
//     (company-add-document, document-row-{id}, document-edit-{id},
//      document-dialog, document-view, document-title, document-type,
//      document-content, document-save)
//   apps/internal/src/routes/companies/$slug.tsx (?tab=files)
//
// Auth: runs in the `authed` project and inherits Alice's session cookie from
// the `setup` project's storageState.

const COMPANY_SLUG = 'cal-pep-fonda'

// The one title this file writes through the UI. Named so cleanup can find the
// row whose id the test never learns.
const CREATED_TITLE = 'e2e — created document'

const psql = (sqlText: string): string =>
	execSync(`psql "${DATABASE_URL}" -tA -c "${sqlText.replace(/"/g, '\\"')}"`, {
		encoding: 'utf8',
	}).trim()

let companyId = ''
let readableId = ''
let editableId = ''

// A document and the record it is filed under are two rows. Both are written
// here, because a document filed nowhere is one the panel cannot list.
const seedDocument = (
	orgId: string,
	id: string,
	type: string,
	title: string,
	content: string,
): void => {
	psql(
		`INSERT INTO documents (id, organization_id, type, title, content)
		 VALUES ('${id}', '${orgId}', '${type}', '${title}', '${content}')`,
	)
	psql(
		`INSERT INTO document_links (organization_id, document_id, subject_table, subject_id)
		 VALUES ('${orgId}', '${id}', 'companies', '${companyId}')`,
	)
}

const deleteDocument = (id: string): void => {
	// timeline_activity has no FK to documents, so the activity the create path
	// records outlives the row unless it goes first.
	psql(
		`DELETE FROM timeline_activity WHERE entity_type='document' AND entity_id='${id}'`,
	)
	psql(`DELETE FROM documents WHERE id='${id}'`)
}

test.describe('documents on the company Files tab', () => {
	test.beforeAll(() => {
		// GIVEN cal-pep-fonda exists. The demo seed already gives it documents,
		// but this file seeds its own so the assertions below name content this
		// test controls rather than fixture prose that may be reworded.
		const orgId = psql(
			`SELECT organization_id FROM companies WHERE slug='${COMPANY_SLUG}' LIMIT 1`,
		)
		companyId = psql(
			`SELECT id FROM companies WHERE slug='${COMPANY_SLUG}' LIMIT 1`,
		)
		expect(orgId, 'taller seeded').not.toBe('')
		expect(companyId, 'cal-pep-fonda seeded').not.toBe('')

		readableId = randomUUID()
		seedDocument(
			orgId,
			readableId,
			'call_notes',
			'e2e — readable document',
			'## Heading from markdown\n\nBody line the view dialog must render.',
		)

		editableId = randomUUID()
		seedDocument(
			orgId,
			editableId,
			'general',
			'e2e — editable document',
			'Original body.',
		)
	})

	test.afterAll(() => {
		deleteDocument(readableId)
		deleteDocument(editableId)
		const createdIds = psql(
			`SELECT d.id FROM documents d
			 JOIN document_links dl ON dl.document_id = d.id
			 WHERE d.title='${CREATED_TITLE}'
			   AND dl.subject_table='companies' AND dl.subject_id='${companyId}'`,
		)
		for (const id of createdIds.split('\n').filter(Boolean)) {
			deleteDocument(id)
		}
	})

	test.beforeEach(async ({ page }) => {
		await page.goto('/', { waitUntil: 'commit' })
		await setActiveOrgBySlug(page, 'taller')
	})

	test.describe('when the company has documents', () => {
		test('should list them and open one for reading', {
			tag: '@smoke',
		}, async ({ page }) => {
			// WHEN Alice opens the Files tab. Going straight to the tab in the
			// URL avoids having to click the tab trigger first.
			await page.goto(`/companies/${COMPANY_SLUG}?tab=files`, {
				waitUntil: 'networkidle',
			})

			// THEN the seeded document has a row
			const row = page.getByTestId(`document-row-${readableId}`)
			await expect(row).toBeVisible()
			await expect(row).toContainText('e2e — readable document')
			// AND the row is labelled with its kind, not the raw column value
			await expect(row).toContainText('Call notes')

			// WHEN she clicks the row itself, which is its first button — the
			// pencil next to it opens the editor instead. The row opens the
			// reader from a plain onClick, so the click does nothing at all
			// until the browser has taken the page over.
			await waitForInteractive(page, `document-row-${readableId}`)
			await row.getByRole('button').first().click()

			// THEN the dialog opens showing the rendered markdown. Asserting the
			// body text proves the content travelled from the row through
			// MarkdownView, not merely that a dialog appeared.
			await expect(page.getByTestId('document-dialog')).toBeVisible()
			const view = page.getByTestId('document-view')
			await expect(view).toBeVisible()
			await expect(view).toContainText('Body line the view dialog must render.')
			// AND the markdown heading rendered as a heading rather than as
			// literal '##' text
			await expect(view.getByRole('heading')).toContainText(
				'Heading from markdown',
			)
		})
	})

	test.describe('when Alice opens a document on its own page', () => {
		test('should show the body at an address that can be shared', async ({
			page,
		}) => {
			// GIVEN the reader open on the Files tab
			await page.goto(`/companies/${COMPANY_SLUG}?tab=files`, {
				waitUntil: 'networkidle',
			})
			const row = page.getByTestId(`document-row-${readableId}`)
			await expect(row).toBeVisible()
			await waitForInteractive(page, `document-row-${readableId}`)
			await row.getByRole('button').first().click()
			await expect(page.getByTestId('document-view')).toBeVisible()

			// WHEN she follows the link out of the popup
			await page.getByTestId('document-open-full-page').click()

			// THEN the document has an address of its own, and the body is there.
			// Visiting that address directly is the whole point — a popup cannot
			// be sent to anybody.
			await expect(page).toHaveURL(new RegExp(`/documents/${readableId}$`))
			await expect(page.getByTestId('document-page')).toBeVisible()
			await expect(page.getByTestId('document-page-body')).toContainText(
				'Body line the view dialog must render.',
			)

			// AND arriving cold at the same address works the same way
			await page.goto(`/documents/${readableId}`, { waitUntil: 'networkidle' })
			await expect(page.getByTestId('document-page-body')).toContainText(
				'Body line the view dialog must render.',
			)
		})
	})

	test.describe('when Alice looks for a document by its words', () => {
		test('should find it from the documents page', async ({ page }) => {
			// GIVEN the documents page, which lists everything written down
			await page.goto('/documents', { waitUntil: 'networkidle' })
			await expect(page.getByTestId('documents-list')).toBeVisible()

			// WHEN she searches for wording that appears only in one body
			await page.getByTestId('documents-search').fill('Body line the view')

			// THEN that document is the one left, and it links to its own page.
			// Searching the body, not just the title, is the point — the title
			// here says nothing about the words being looked for.
			const row = page.getByTestId(`documents-row-${readableId}`)
			await expect(row).toBeVisible({ timeout: 10_000 })
			await expect(
				page.getByTestId('documents-list').locator('li'),
			).toHaveCount(1)
			await row.click()
			await expect(page).toHaveURL(new RegExp(`/documents/${readableId}$`))
		})
	})

	test.describe('when a document is filed against a person', () => {
		test('should show it on that person, not only on the company', async ({
			page,
		}) => {
			// GIVEN the seed files a note about Pep on his own contact row. This
			// is the whole point of the change: before it, a note about a person
			// could only be filed against the business they work for.
			const contactId = psql(
				`SELECT c.id FROM contacts c
				 JOIN document_links dl ON dl.subject_table='contacts' AND dl.subject_id = c.id
				 WHERE c.company_id = '${companyId}' LIMIT 1`,
			)
			test.skip(contactId === '', 'seed files no document against a contact')

			// WHEN Alice opens that person on the company's People tab
			await page.goto(`/companies/${COMPANY_SLUG}?tab=people`, {
				waitUntil: 'networkidle',
			})
			const editButton = page.getByTestId(`contact-edit-${contactId}`)
			await expect(editButton).toBeVisible()
			await waitForInteractive(page, `contact-edit-${contactId}`)
			await editButton.click()

			// THEN what was written about them is listed there, and leads to the
			// document's own page
			const section = page.getByTestId('subject-documents-contacts')
			await expect(section).toBeVisible()
			await expect(section).toContainText('Working with Pep')
		})
	})

	test.describe('when a document is a saved web page', () => {
		test('should open at an address that keeps working', async ({ page }) => {
			// GIVEN the seeded web page, whose body is a stored file rather than a
			// column, so the only way to read it is the link
			const pageDoc = psql(
				`SELECT id FROM documents WHERE format='html' LIMIT 1`,
			)
			expect(pageDoc, 'seed should provide one HTML document').not.toBe('')

			await page.goto(`/documents/${pageDoc}`, { waitUntil: 'networkidle' })

			// WHEN the link out to the page is read off the rendered markup
			const link = page.getByTestId('document-page-open-original')
			await expect(link).toBeVisible()
			const href = await link.getAttribute('href')
			expect(href).toContain(`/v1/documents/${pageDoc}/open`)

			// THEN following it lands on the stored page. Asserting the body proves
			// the whole chain: the session was accepted, the organisation checked,
			// a fresh storage link minted, and the redirect followed.
			const landed = await page.evaluate(async (url: string) => {
				const res = await fetch(url, { credentials: 'include' })
				return { ok: res.ok, body: (await res.text()).slice(0, 200) }
			}, href!)
			expect(landed.ok).toBe(true)
			expect(landed.body).toContain('Cal Pep Fonda')

			// AND the address is not a one-shot: it is checked and re-minted each
			// time, so a second visit works exactly as the first did
			const again = await page.evaluate(async (url: string) => {
				const res = await fetch(url, { credentials: 'include' })
				return res.ok
			}, href!)
			expect(again).toBe(true)
		})
	})

	test.describe('when Alice adds a document', () => {
		test('should store the title, type and content she typed', async ({
			page,
		}) => {
			// GIVEN the Files tab, with the Add button live. The button opens the
			// dialog from a plain onClick, so a click landing before React has
			// wired it up is swallowed silently.
			await page.goto(`/companies/${COMPANY_SLUG}?tab=files`, {
				waitUntil: 'networkidle',
			})
			await waitForInteractive(page, 'company-add-document')

			// WHEN she opens the add dialog
			await page.getByTestId('company-add-document').click()
			await expect(page.getByTestId('document-dialog')).toBeVisible()

			// AND fills in every field the form offers
			await page.getByTestId('document-title').fill(CREATED_TITLE)
			await page.getByTestId('document-type').selectOption('visit_notes')
			await page
				.getByTestId('document-content')
				.fill('Notes taken during the e2e visit.')
			await page.getByTestId('document-save').click()

			// THEN the dialog closes, which only happens once the create mutation
			// resolved Success — a failure keeps it open with a toast
			await expect(page.getByTestId('document-dialog')).toHaveCount(0)

			// AND the stored row carries the type she chose and the body she
			// typed. The body never appears on the list, and the type can only
			// be set while creating — there is no picker once the document
			// exists — so a wrong value here would go unnoticed on screen.
			await expect(async () => {
				const stored = psql(
					`SELECT d.type || '|' || d.content FROM documents d
					 JOIN document_links dl ON dl.document_id = d.id
					 WHERE d.title='${CREATED_TITLE}'
					   AND dl.subject_table='companies' AND dl.subject_id='${companyId}'`,
				)
				expect(stored).toBe('visit_notes|Notes taken during the e2e visit.')
			}).toPass({ timeout: 10_000 })
		})
	})

	test.describe('when Alice edits an existing document', () => {
		test('should overwrite its content', async ({ page }) => {
			// GIVEN the Files tab with the seeded editable document
			await page.goto(`/companies/${COMPANY_SLUG}?tab=files`, {
				waitUntil: 'networkidle',
			})
			const editButton = page.getByTestId(`document-edit-${editableId}`)
			await expect(editButton).toBeVisible()
			await waitForInteractive(page, `document-edit-${editableId}`)

			// WHEN she opens it for editing and replaces the body
			await editButton.click()
			await expect(page.getByTestId('document-dialog')).toBeVisible()
			const content = page.getByTestId('document-content')
			await expect(content).toHaveValue('Original body.')
			// AND the type picker is absent — type is fixed at creation on this
			// surface, so editing must not offer it
			await expect(page.getByTestId('document-type')).toHaveCount(0)

			await content.fill('Rewritten by the e2e edit test.')
			await page.getByTestId('document-save').click()

			// THEN the dialog closes and the stored row carries the new body
			await expect(page.getByTestId('document-dialog')).toHaveCount(0)
			await expect(async () => {
				const stored = psql(
					`SELECT content FROM documents WHERE id='${editableId}'`,
				)
				expect(stored).toBe('Rewritten by the e2e edit test.')
			}).toPass({ timeout: 10_000 })
		})
	})
})

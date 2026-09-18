import { execSync } from 'node:child_process'

import { expect, type Page, test } from '@playwright/test'

import { DATABASE_URL } from './helpers/database-url'
import { chooseSelectOption } from './helpers/pri-select'
import { setActiveOrgBySlug } from './helpers/set-active-org'

// The filter bar on /emails: the chips, the dropdowns, what each one leaves on
// the list, and what the address carries so a link reopens the same list.
//
// Numbers are never written down here. Sibling specs send mail and open
// conversations against the same seeded database, so the counts move between
// runs; every one below is either read back from the database or compared with
// another count read off the same screen.
//
// Selectors verified against:
//   apps/internal/src/routes/_authed/emails/index.tsx
//     (emails-status-*, emails-filter-*, emails-clear-filters,
//      emails-count-announcement, emails-thread-total, thread-row-{id})
//   apps/internal/src/components/shared/multi-select-filter.tsx
//     (emails-filter-company-owner-option-{userId|none})
//   apps/internal/src/routes/_authed/emails/$threadId.tsx
//     (thread-message-card)

const psql = (sqlText: string): string =>
	execSync(`psql "${DATABASE_URL}" -tA -c "${sqlText.replace(/"/g, '\\"')}"`, {
		encoding: 'utf8',
	}).trim()

// A mailbox somebody keeps to themselves takes its conversations off everybody
// else's list, so "how many are there" has a different answer per person. The
// rule is spelled out here rather than counting the rows outright, because the
// database answers these fixtures as the owner of every row and would hand back
// a number nobody's screen shows.
const visibleThreads = (email: string): number =>
	Number(
		psql(`SELECT count(*) FROM email_thread_links l
		 JOIN organization o ON o.id = l.organization_id
		 WHERE o.slug = 'taller' AND EXISTS (
		   SELECT 1 FROM email_messages m JOIN inboxes i ON i.id = m.inbox_id
		   WHERE m.organization_id = l.organization_id
		     AND m.thread_key = l.external_thread_id
		     AND (i.is_private = false
		          OR i.owner_user_id = (SELECT id FROM "user" WHERE email = '${email}'))
		 )`),
	)

// The same rule one conversation down: which of its messages that person is
// shown.
const visibleMessages = (threadId: string, email: string): number =>
	Number(
		psql(`SELECT count(*) FROM email_messages m
		 JOIN inboxes i ON i.id = m.inbox_id
		 JOIN email_thread_links l
		   ON l.organization_id = m.organization_id
		  AND l.external_thread_id = m.thread_key
		 WHERE l.id = '${threadId}'
		   AND (i.is_private = false
		        OR i.owner_user_id = (SELECT id FROM "user" WHERE email = '${email}'))`),
	)

const userId = (email: string): string =>
	psql(`SELECT id FROM "user" WHERE email = '${email}'`)

// The conversation the team shares that also holds one message from Alice's own
// mailbox — the only thing local that tells the two rules apart.
const sharedThreadId = (): string =>
	psql(`SELECT l.id FROM email_thread_links l
	 JOIN organization o ON o.id = l.organization_id
	 WHERE o.slug = 'taller' AND l.subject = 'Quote for the booking module'`)

async function signedInAsAlice(page: Page): Promise<void> {
	// Sibling files flip her active org, and the list is whichever org is
	// active.
	await page.goto('/', { waitUntil: 'commit' })
	await setActiveOrgBySlug(page, 'taller')
}

async function openList(page: Page, search = ''): Promise<void> {
	await page.goto(`/emails${search}`, { waitUntil: 'networkidle' })
	await expect(page.getByTestId('emails-thread-total')).toBeVisible({
		timeout: 15_000,
	})
}

/**
 * The header's own tally.
 *
 * Counting rows would count one page of the list rather than the list: the grid
 * draws a hundred at a time however much mail there is, and sibling specs keep
 * adding more.
 *
 * Read through `expect.poll` after anything that changes the list — a filter is
 * a fetch, and the tally on screen is the old list's until the new one lands.
 */
async function readTotal(page: Page): Promise<number> {
	const text = await page.getByTestId('emails-thread-total').textContent()
	return Number((text ?? '').replace(/\D/g, ''))
}

async function expectTotal(page: Page, expected: number): Promise<void> {
	await expect.poll(() => readTotal(page), { timeout: 15_000 }).toBe(expected)
}

/**
 * A filter in the address, in either of the two spellings that mean it.
 *
 * A word the address writer would otherwise hand back as something else is
 * written in quotes — `unread` lands as `unread="true"`, since a bare `true`
 * reads as a yes/no rather than as the word (see `stringifySearch` in
 * src/router.tsx). A hand-typed link carries the bare word and means the same
 * filter, so both are the address saying the same thing.
 */
const inAddress = (name: string, value: string): RegExp =>
	new RegExp(`${name}=(?:${value}|%22${value}%22)`)

/** The conversations on screen, in the order the list put them. */
async function rowOrder(page: Page): Promise<ReadonlyArray<string>> {
	await page.waitForLoadState('networkidle')
	return page
		.locator('[data-testid^="thread-row-"]')
		.evaluateAll(rows => rows.map(row => row.getAttribute('data-testid') ?? ''))
}

const threadRow = (page: Page, subject: string) =>
	page.locator('[data-testid^="thread-row-"]').filter({ hasText: subject })

test.describe('emails list filters', () => {
	test.beforeEach(async ({ page }) => {
		await signedInAsAlice(page)
	})

	test.describe('when a second status is chosen', () => {
		test('should widen the list and leave both chips pressed', async ({
			page,
		}) => {
			// GIVEN the list with nothing narrowing it
			await openList(page)
			const everything = await readTotal(page)

			// WHEN one status is picked
			await page.getByTestId('emails-status-closed').click()
			await expect(page).toHaveURL(/status=closed/)
			await expect.poll(() => readTotal(page)).toBeLessThan(everything)
			const closedOnly = await readTotal(page)
			expect(closedOnly, 'the seed must hold a closed thread').toBeGreaterThan(
				0,
			)

			// AND a second is picked rather than swapping the first
			await page.getByTestId('emails-status-archived').click()

			// THEN both are in force and the list has grown. A conversation has one
			// status, so naming a second can only widen — asking for "everything
			// settled" is one question, not two lists read one after the other.
			await expect(page).toHaveURL(
				/status=closed%2Carchived|status=closed,archived/,
			)
			await expect(page.getByTestId('emails-status-closed')).toHaveAttribute(
				'aria-pressed',
				'true',
			)
			await expect(page.getByTestId('emails-status-archived')).toHaveAttribute(
				'aria-pressed',
				'true',
			)
			await expect(page.getByTestId('emails-status-all')).toHaveAttribute(
				'aria-pressed',
				'false',
			)
			await expect.poll(() => readTotal(page)).toBeGreaterThan(closedOnly)
			expect(await readTotal(page)).toBeLessThanOrEqual(everything)
		})

		test('should put both down when All is pressed', async ({ page }) => {
			// GIVEN the list narrowed to everything settled
			await openList(page, '?status=closed,archived')
			await expect(page.getByTestId('emails-status-archived')).toHaveAttribute(
				'aria-pressed',
				'true',
			)

			// WHEN All is pressed
			await page.getByTestId('emails-status-all').click()

			// THEN every status is in view again, and the address says nothing about
			// status at all
			await expect(page).not.toHaveURL(/status=/)
			await expect(page.getByTestId('emails-status-all')).toHaveAttribute(
				'aria-pressed',
				'true',
			)
			await expect(page.getByTestId('emails-status-closed')).toHaveAttribute(
				'aria-pressed',
				'false',
			)
			await expect(page.getByTestId('emails-status-archived')).toHaveAttribute(
				'aria-pressed',
				'false',
			)
			await expectTotal(page, visibleThreads('admin@taller.cat'))
		})
	})

	test.describe('when a "waiting on" value is chosen', () => {
		test('should list only what somebody here still owes an answer to', async ({
			page,
		}) => {
			// GIVEN the whole list
			await openList(page)
			const everything = await readTotal(page)

			// WHEN "Needs a reply" is picked
			await chooseSelectOption(
				page,
				'emails-filter-waiting-on',
				'emails-filter-waiting-on-option-us',
			)

			// THEN the list holds fewer, and the control names which
			await expect(page).toHaveURL(/waitingOn=us/)
			await expect(page.getByTestId('emails-filter-waiting-on')).toHaveText(
				/needs a reply/i,
			)
			await expect.poll(() => readTotal(page)).toBeLessThan(everything)
			expect(await readTotal(page)).toBeGreaterThan(0)

			// AND the one the other side has been left to answer is not among them
			await expect(
				threadRow(page, 'Availability for the October fit-out'),
			).toHaveCount(0)
		})

		test('should list only what the other side has been left to answer', async ({
			page,
		}) => {
			// GIVEN the whole list
			await openList(page)

			// WHEN "Waiting on them" is picked
			await chooseSelectOption(
				page,
				'emails-filter-waiting-on',
				'emails-filter-waiting-on-option-them',
			)

			// THEN the conversation we wrote last on is there
			await expect(page).toHaveURL(/waitingOn=them/)
			await expect(page.getByTestId('emails-filter-waiting-on')).toHaveText(
				/waiting on them/i,
			)
			await expect(
				threadRow(page, 'Availability for the October fit-out'),
			).toHaveCount(1)

			// AND one somebody here wrote to last is not — the two questions are
			// opposites, and a filter that answered both would be no filter
			await expect(threadRow(page, 'Thanks for the visit')).toHaveCount(0)
		})
	})

	test.describe('when a settled status and a "waiting on" meet', () => {
		test('should lift the status when a waiting-on is picked', async ({
			page,
		}) => {
			// GIVEN the list narrowed to what is closed
			await openList(page, '?status=closed')
			await expect(page.getByTestId('emails-status-closed')).toHaveAttribute(
				'aria-pressed',
				'true',
			)

			// WHEN a waiting-on is picked on top of it
			await chooseSelectOption(
				page,
				'emails-filter-waiting-on',
				'emails-filter-waiting-on-option-us',
			)

			// THEN the status is put down. Only an open conversation waits for
			// anybody, so the pair could only ever show an empty list — and a chip
			// left lit over it would narrow nothing while claiming to
			await expect(page).toHaveURL(/waitingOn=us/)
			await expect(page).not.toHaveURL(/status=/)
			await expect(page.getByTestId('emails-status-closed')).toHaveAttribute(
				'aria-pressed',
				'false',
			)
			await expect(page.getByTestId('emails-status-all')).toHaveAttribute(
				'aria-pressed',
				'true',
			)
			await expect(page.getByText('No threads match the filters')).toHaveCount(
				0,
			)
		})

		test('should lift the waiting-on when a settled status is picked', async ({
			page,
		}) => {
			// GIVEN the list narrowed to what needs a reply
			await openList(page, '?waitingOn=us')
			await expect(page.getByTestId('emails-filter-waiting-on')).toHaveText(
				/needs a reply/i,
			)

			// WHEN a settled status is picked on top of it
			await page.getByTestId('emails-status-closed').click()

			// THEN the waiting-on is put down, the same bargain the other way round
			await expect(page).toHaveURL(/status=closed/)
			await expect(page).not.toHaveURL(/waitingOn=/)
			await expect(page.getByTestId('emails-filter-waiting-on')).toHaveText(
				/any thread/i,
			)
			await expect(page.getByText('No threads match the filters')).toHaveCount(
				0,
			)
		})

		test('should keep both when the status picked is Open', async ({
			page,
		}) => {
			// GIVEN the list narrowed to what needs a reply
			await openList(page, '?waitingOn=us')

			// WHEN Open is picked, which is the one status a waiting-on agrees with
			await page.getByTestId('emails-status-open').click()

			// THEN neither is lifted: what the two ask for together is a list that
			// exists, so nothing has to give way
			await expect(page).toHaveURL(/status=open/)
			await expect(page).toHaveURL(/waitingOn=us/)
			await expect(page.getByTestId('emails-status-open')).toHaveAttribute(
				'aria-pressed',
				'true',
			)
			await expect(page.getByTestId('emails-filter-waiting-on')).toHaveText(
				/needs a reply/i,
			)
		})
	})

	test.describe('when unread is chosen', () => {
		test('should narrow to the mail nobody has opened', async ({ page }) => {
			// GIVEN the whole list
			await openList(page)
			const everything = await readTotal(page)

			// WHEN Unread is pressed
			await page.getByTestId('emails-filter-unread').click()

			// THEN the list holds fewer, and the chip says it is on
			await expect(page).toHaveURL(inAddress('unread', 'true'))
			await expect(page.getByTestId('emails-filter-unread')).toHaveAttribute(
				'aria-pressed',
				'true',
			)
			await expect.poll(() => readTotal(page)).toBeLessThan(everything)
			expect(await readTotal(page)).toBeGreaterThan(0)
		})

		test('should drop a conversation once it is marked read', async ({
			page,
		}) => {
			// GIVEN the unread list
			await openList(page, '?unread=true')
			const before = await readTotal(page)
			const first = page.locator('[data-testid^="thread-row-"]').first()
			await expect(first).toBeVisible()
			const rowId = await first.getAttribute('data-testid')
			expect(rowId).not.toBeNull()

			// WHEN that conversation is marked read from its own row
			await first.getByRole('button', { name: 'Mark read' }).click()

			// THEN it leaves the list it no longer belongs on, and the tally above
			// it agrees. A row that stayed put would be a list of unread mail with
			// read mail on it.
			const row = page.locator(`[data-testid="${rowId}"]`)
			await expect(row).toHaveCount(0)
			await expectTotal(page, before - 1)

			// AND put it back, so the seed is as the next spec expects to find it
			await openList(page)
			const restored = page.locator(`[data-testid="${rowId}"]`)
			await restored.getByRole('button', { name: 'Mark unread' }).click()
			await expect(restored).toHaveAttribute('data-unread', 'true')
		})
	})

	test.describe('when has-attachments is chosen', () => {
		test('should leave out the conversation whose only picture is in the message', async ({
			page,
		}) => {
			// GIVEN the whole list
			await openList(page)

			// WHEN mail carrying a file is asked for
			await page.getByTestId('emails-filter-has-attachments').click()

			// THEN the two conversations with a real attachment are there
			await expect(page).toHaveURL(inAddress('hasAttachments', 'true'))
			await expect(threadRow(page, 'Vendor quote — final')).toHaveCount(1)
			await expect(threadRow(page, 'Visit photos attached')).toHaveCount(1)

			// AND the one whose only image is drawn inside the message is not:
			// nothing there can be opened or saved, so counting it would send the
			// reader looking for a file that is not on offer
			await expect(threadRow(page, 'Thanks for the visit')).toHaveCount(0)
		})
	})

	test.describe('when a company owner is chosen', () => {
		test('should list the conversations with the companies that person owns', async ({
			page,
		}) => {
			// GIVEN however many conversations sit on a company Alice has taken
			const mine = Number(
				psql(`SELECT count(*) FROM email_thread_links l
				 JOIN organization o ON o.id = l.organization_id
				 JOIN companies c ON c.id = l.company_id
				 WHERE o.slug = 'taller'
				   AND c.owner_id = (SELECT id FROM "user" WHERE email = 'admin@taller.cat')`),
			)
			expect(mine, 'Alice must own a company with mail on it').toBeGreaterThan(
				0,
			)
			await openList(page)

			// WHEN "My leads" is ticked
			const alice = userId('admin@taller.cat')
			await page.getByTestId('emails-filter-company-owner').click()
			await page
				.getByTestId(`emails-filter-company-owner-option-${alice}`)
				.click()
			await page.keyboard.press('Escape')

			// THEN the list is her leads' mail and nobody else's
			await expect(page).toHaveURL(new RegExp(`companyOwner=${alice}`))
			await expectTotal(page, mine)
			await expect(threadRow(page, 'Quote for the booking module')).toHaveCount(
				1,
			)
		})

		test('should leave out a taken company when the untaken ones are asked for', async ({
			page,
		}) => {
			// GIVEN the whole list
			await openList(page)

			// WHEN "Company without owner" is ticked
			await page.getByTestId('emails-filter-company-owner').click()
			await page.getByTestId('emails-filter-company-owner-option-none').click()
			await page.keyboard.press('Escape')

			// THEN the control names the one choice rather than counting it, and
			// mail on a company somebody has taken is not on the list
			await expect(page).toHaveURL(/companyOwner=none/)
			await expect(page.getByTestId('emails-filter-company-owner')).toHaveText(
				/company without owner/i,
			)
			await expect(threadRow(page, 'Quote for the booking module')).toHaveCount(
				0,
			)
		})
	})

	test.describe('when a quiet period is chosen', () => {
		test('should keep only what nobody has written on since', async ({
			page,
		}) => {
			// GIVEN the whole list
			await openList(page)
			const everything = await readTotal(page)

			// WHEN a fortnight of silence is asked for
			await chooseSelectOption(
				page,
				'emails-filter-quiet',
				'emails-filter-quiet-option-14',
			)

			// THEN the list holds fewer, and the control says how long
			await expect(page).toHaveURL(/quietDays=14/)
			await expect(page.getByTestId('emails-filter-quiet')).toHaveText(
				/14\+ days/,
			)
			await expect.poll(() => readTotal(page)).toBeLessThan(everything)
			expect(await readTotal(page)).toBeGreaterThan(0)

			// AND "Any time" puts it down again rather than standing for some other
			// length of silence
			await chooseSelectOption(
				page,
				'emails-filter-quiet',
				'emails-filter-quiet-option-__all__',
			)
			await expect(page).not.toHaveURL(/quietDays=/)
			await expectTotal(page, everything)
		})
	})

	test.describe('when the order is changed', () => {
		test('should hold the same conversations in another order', async ({
			page,
		}) => {
			// GIVEN the list in its usual order
			await openList(page)
			const byActivity = await rowOrder(page)
			expect(
				byActivity.length,
				'the seed must hold enough mail to order',
			).toBeGreaterThan(1)

			// WHEN the order is changed to the latest message
			await chooseSelectOption(
				page,
				'emails-filter-sort',
				'emails-filter-sort-option-latest_message',
			)
			await expect(page).toHaveURL(/sort=latest_message/)
			await expect(page.getByTestId('emails-filter-sort')).toHaveText(
				/latest message/i,
			)
			await expect
				.poll(async () => (await rowOrder(page)).join(','))
				.not.toBe(byActivity.join(','))

			// THEN the same conversations are on the list, read from the other end.
			// The two answer different questions — when mail last arrived, and when
			// the conversation was last touched, which filing it away also counts.
			const byMessage = await rowOrder(page)
			expect([...byMessage].sort()).toEqual([...byActivity].sort())

			// AND going back to the usual order takes it out of the address, so one
			// list has one link rather than two
			await chooseSelectOption(
				page,
				'emails-filter-sort',
				'emails-filter-sort-option-recent_activity',
			)
			await expect(page).not.toHaveURL(/sort=/)
		})
	})

	test.describe('when the page is opened again', () => {
		test('should keep every control and the total, because the filters live in the address', async ({
			page,
		}) => {
			// GIVEN three controls set from the bar
			await openList(page)
			await page.getByTestId('emails-filter-unread').click()
			await expect(page).toHaveURL(inAddress('unread', 'true'))
			await chooseSelectOption(
				page,
				'emails-filter-quiet',
				'emails-filter-quiet-option-14',
			)
			await chooseSelectOption(
				page,
				'emails-filter-sort',
				'emails-filter-sort-option-latest_message',
			)
			await expect(page).toHaveURL(/sort=latest_message/)
			await page.waitForLoadState('networkidle')
			const before = await readTotal(page)
			const address = new URL(page.url()).search

			// WHEN the page is loaded again from that address
			await page.reload({ waitUntil: 'networkidle' })

			// THEN nothing was in the screen's memory: every control reads back the
			// same and so does the tally
			expect(new URL(page.url()).search).toBe(address)
			await expect(page.getByTestId('emails-filter-unread')).toHaveAttribute(
				'aria-pressed',
				'true',
			)
			await expect(page.getByTestId('emails-filter-quiet')).toHaveText(
				/14\+ days/,
			)
			await expect(page.getByTestId('emails-filter-sort')).toHaveText(
				/latest message/i,
			)
			await expectTotal(page, before)
		})
	})

	test.describe('when Clear filters is pressed', () => {
		test('should put down every filter and the order with them', async ({
			page,
		}) => {
			// GIVEN a list narrowed four ways and read in the other order
			await openList(
				page,
				'?status=open&unread=true&quietDays=14&sort=latest_message',
			)
			await expect(page.getByTestId('emails-clear-filters')).toBeVisible()

			// WHEN the filters are cleared
			await page.getByTestId('emails-clear-filters').click()

			// THEN the address is bare and every control is back where it started —
			// the order included, since it is set from this same bar and a list left
			// in an order nobody remembers choosing reads as broken
			await expect(page).toHaveURL(/\/emails$/)
			await expect(page.getByTestId('emails-status-all')).toHaveAttribute(
				'aria-pressed',
				'true',
			)
			await expect(page.getByTestId('emails-filter-unread')).toHaveAttribute(
				'aria-pressed',
				'false',
			)
			await expect(page.getByTestId('emails-filter-quiet')).toHaveText(
				/any time/i,
			)
			await expect(page.getByTestId('emails-filter-sort')).toHaveText(
				/recent activity/i,
			)
			await expect(page.getByTestId('emails-clear-filters')).toHaveCount(0)
			await expectTotal(page, visibleThreads('admin@taller.cat'))
		})
	})

	test.describe('when the filters are used without looking at the screen', () => {
		test('should say how many threads they left', async ({ page }) => {
			// GIVEN the list unfiltered
			await openList(page)

			// WHEN a chip changes the list without the keyboard moving anywhere
			await page.getByTestId('emails-filter-unread').click()
			await expect(page).toHaveURL(inAddress('unread', 'true'))

			// THEN the change is spoken. Without it a listener gets silence — and
			// the control that quietly lifts another is invisible entirely
			await expect(page.getByTestId('emails-count-announcement')).toHaveText(
				/^\d+ threads with filters applied$/,
				{ timeout: 10_000 },
			)
		})

		test('should say it in the singular when one thread is left', async ({
			page,
		}) => {
			// GIVEN a filter the seed leaves exactly one conversation under: the
			// company nobody has taken. Counted rather than assumed, because what
			// the seed holds moves.
			const unowned = Number(
				psql(`SELECT count(*) FROM email_thread_links l
				 JOIN organization o ON o.id = l.organization_id
				 JOIN companies c ON c.id = l.company_id
				 WHERE o.slug = 'taller' AND c.owner_id IS NULL`),
			)
			expect(
				unowned,
				'the seed must leave exactly one conversation on an unowned company',
			).toBe(1)

			// WHEN the list is narrowed to it
			await openList(page, '?companyOwner=none')

			// THEN it is announced as one thread rather than "1 threads", which
			// reads as a bug to anyone listening
			await expect(page.getByTestId('emails-count-announcement')).toHaveText(
				'1 thread with filters applied',
				{ timeout: 10_000 },
			)
		})
	})

	test.describe('when nothing matches', () => {
		test('should say so and offer the way back', async ({ page }) => {
			// GIVEN a search nothing in the mailbox answers
			await openList(page, '?query=nothing-in-this-mailbox-says-this')

			// THEN the screen says the filters are why it is empty, rather than
			// showing the blank page of somebody with no mail at all
			await expect(page.getByTestId('emails-thread-total')).toHaveText(
				'0 threads',
			)
			await expect(page.getByText('No threads match the filters')).toBeVisible()

			// WHEN the way out is taken
			await page.getByTestId('emails-empty-clear-filters').click()

			// THEN the whole list is back. Without it the only way off an empty
			// screen is the address bar
			await expect(page).toHaveURL(/\/emails$/)
			await expectTotal(page, visibleThreads('admin@taller.cat'))
		})
	})

	test.describe('when the bar is used on a phone', () => {
		test.use({ viewport: { width: 375, height: 812 } })

		test('should put every control within reach at 375px', async ({ page }) => {
			// GIVEN the list on the narrowest screen worth drawing for
			await openList(page)

			// THEN the page does not slide sideways
			const overflow = await page.evaluate(
				() => document.documentElement.scrollWidth - window.innerWidth,
			)
			expect(overflow).toBeLessThanOrEqual(1)

			// AND every dropdown is drawn inside the screen rather than off its
			// edge — the row wraps as it narrows instead of running past the sheet
			for (const testId of [
				'emails-search',
				'emails-filter-waiting-on',
				'emails-filter-quiet',
				'emails-filter-company-owner',
				'emails-filter-sort',
			]) {
				const box = await page.getByTestId(testId).boundingBox()
				if (!box) throw new Error(`${testId} is not drawn at 375px`)
				expect(box.x, `${testId} runs off the left`).toBeGreaterThanOrEqual(0)
				expect(
					box.x + box.width,
					`${testId} runs off the right`,
				).toBeLessThanOrEqual(376)
			}

			// AND the last chip on the strip can still be pressed: the chips sit on
			// one line that slides rather than wrapping onto three rows, so reaching
			// the far end is a scroll and not a dead end
			const attachments = page.getByTestId('emails-filter-has-attachments')
			await attachments.scrollIntoViewIfNeeded()
			await attachments.click()
			await expect(page).toHaveURL(inAddress('hasAttachments', 'true'))
			await expect(attachments).toHaveAttribute('aria-pressed', 'true')

			// AND what the press brought with it is on screen too
			const clear = await page.getByTestId('emails-clear-filters').boundingBox()
			if (!clear) throw new Error('Clear filters is not drawn at 375px')
			expect(clear.x + clear.width).toBeLessThanOrEqual(376)
		})
	})
})

// Mail in a mailbox somebody keeps to themselves, seen from both sides. The
// rule lives next to the rows in the database, so the question here is only
// whether the screen shows what that leaves — a conversation of nothing but
// private mail is off a colleague's list, and a private message inside a shared
// conversation is off the page a colleague opens.
test.describe('private mail in the emails list', () => {
	test.describe('when the mailbox owner looks', () => {
		test.beforeEach(async ({ page }) => {
			await signedInAsAlice(page)
		})

		test('should show her both her own conversation and the private message inside a shared one', async ({
			page,
		}) => {
			// GIVEN Alice's list, which is every conversation the organisation has
			await openList(page)
			await expectTotal(page, visibleThreads('admin@taller.cat'))

			// THEN the conversation only her mailbox holds is on it
			await expect(threadRow(page, 'Your tax return')).toHaveCount(1)

			// AND the shared conversation shows her the message that arrived in that
			// mailbox, alongside the ones the team shares
			const threadId = sharedThreadId()
			await page.goto(`/emails/${threadId}`, { waitUntil: 'networkidle' })
			await expect(page.getByTestId('thread-message-card')).toHaveCount(
				visibleMessages(threadId, 'admin@taller.cat'),
			)
			await expect(page.getByText('Entre nosaltres')).toBeVisible()
		})
	})

	test.describe('when a colleague looks', () => {
		// Carol's own session, not Alice's: the question is precisely what
		// somebody who does not own that mailbox is shown. An empty storage state
		// forces a logged-out start — otherwise /login bounces straight to the
		// dashboard on Alice's cookie.
		test.use({ storageState: { cookies: [], origins: [] } })

		test('should show her neither the private conversation nor the private message', async ({
			page,
		}) => {
			// GIVEN Carol signed in, who is a member of Taller and nothing else
			await page.goto('/login')
			await page.getByTestId('login-email').fill('colleague@taller.cat')
			await page.getByTestId('login-password').fill('batuda-dev-2026')
			await page.getByTestId('login-submit').click()
			await page.waitForURL(/\/$/)
			await expect(page.getByTestId('active-org-name')).toContainText(
				'Taller Demo',
				{ timeout: 10_000 },
			)

			// WHEN she opens the list
			await openList(page)

			// THEN it is shorter than Alice's by the conversation that lives only in
			// her mailbox, and that conversation is not on it under any heading
			await expectTotal(page, visibleThreads('colleague@taller.cat'))
			expect(visibleThreads('colleague@taller.cat')).toBeLessThan(
				visibleThreads('admin@taller.cat'),
			)
			await expect(threadRow(page, 'Your tax return')).toHaveCount(0)

			// AND the conversation the team shares opens without the message that
			// arrived in the private mailbox — the rest of it reads as it should
			const threadId = sharedThreadId()
			await page.goto(`/emails/${threadId}`, { waitUntil: 'networkidle' })
			await expect(page.getByTestId('thread-message-card')).toHaveCount(
				visibleMessages(threadId, 'colleague@taller.cat'),
			)
			await expect(page.getByText('Entre nosaltres')).toHaveCount(0)
		})
	})
})

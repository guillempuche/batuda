import { Schema } from 'effect'

/**
 * Where an id comes from, said on the parameter that asks for it.
 *
 * An assistant holds what a person said, not a database. Every parameter here
 * takes a value it can only have got from an earlier call, and a caller that
 * is not told which call guesses, fails validation, and — having learned
 * nothing from the failure — sends the same request again. Naming the call is
 * what ends that loop.
 *
 * They live together so one record reads the same way everywhere it is asked
 * for, rather than being described afresh, and differently, in each tool.
 *
 * For a parameter a tool can do without, `Schema.optionalKey(SomeIdParam)`
 * keeps the note: the key goes missing from `required` and the description
 * stays on the published property. `Schema.optional` does not — it publishes
 * the property as a choice between the type and null, leaving the note on the
 * inner branch where a client reading the property finds none, and offering a
 * null the decoder then refuses. That is why nothing here uses it.
 */
const from = (source: string) => Schema.String.annotate({ description: source })

export const CompanyIdParam = from(
	'A company id from search_companies; create_companies returns one too.',
)

export const CompanyIdOrSlugParam = from(
	'A company id or slug from search_companies. A company’s name is neither — search for it first.',
)

export const ContactIdParam = from('A contact id from list_contacts.')

export const TaskIdParam = from('A task id from list_tasks or search_tasks.')

export const DocumentIdParam = from('A document id from get_documents.')

/**
 * A row in whichever table `subject_table` names, so the call that produces it
 * changes with that choice rather than being fixed.
 */
export const SUBJECT_ID_SOURCE =
	'The id of the row named by subject_table — a company id from search_companies, a contact id from list_contacts, and so on for whichever table you chose. subject_table says which ones this tool takes; a row from any other is not one of them.'

export const SubjectIdParam = from(SUBJECT_ID_SOURCE)

export const CalendarEventIdParam = from(
	'A calendar event id from list_upcoming_meetings or rsvp_pending_invitations.',
)

export const EventTypeIdParam = from(
	'An event type id from manage_event_types(action:"list").',
)

export const PageIdParam = from('A page id from list_pages.')

export const PageIdOrSlugParam = from(
	'A page id or slug from list_pages; with a slug, pass `lang` too.',
)

export const ProductIdParam = from('A product id from list_products.')

export const ProposalIdParam = from('A proposal id from list_proposals.')

export const RecordingIdParam = from(
	'A recording id from list_call_recordings.',
)

export const EmailThreadIdParam = from(
	'A thread `id` from list_email_threads — the thread’s own id, not the threadId a send answered with.',
)

export const EmailMessageIdParam = from(
	'A message id from list_email_messages; get_email_thread carries the same ids on its messages.',
)

/**
 * Somebody's own address, usually the caller's — which an assistant has no
 * other way to know: the person it is speaking to says "book me in", never
 * which mailbox that is. A colleague's address is equally valid here, so this
 * says where to get the caller's rather than claiming it must be theirs.
 */
export const OwnEmailParam = from(
	'The email address to act as. For the person you are working for, that is `primary.email` from list_email_inboxes — the mailbox they send from by default. A colleague’s address works too when the request names one.',
)

/**
 * Said on the research ids rather than handed out as a schema: those carry a
 * uuid check of their own, and re-declaring it here would let the two drift.
 */
export const RESEARCH_ID_SOURCE =
	'A research run id from list_research, start_research or research_sync.'

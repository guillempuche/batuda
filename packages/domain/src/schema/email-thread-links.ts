import { Schema } from 'effect'

/**
 * Where a conversation stands. `open` is being worked on, `closed` is settled
 * and still on the list, `archived` is out of the way but kept.
 */
export const THREAD_STATUSES = ['open', 'closed', 'archived'] as const
export const ThreadStatus = Schema.Literals(THREAD_STATUSES)
export type ThreadStatus = typeof ThreadStatus.Type

/**
 * Who a conversation is waiting for. `us` means they wrote last and nobody has
 * answered; `them` means we wrote last and the message did not bounce. Only
 * conversations still open are waiting for anyone.
 */
export const THREAD_WAITING_ON = ['us', 'them'] as const
export const ThreadWaitingOn = Schema.Literals(THREAD_WAITING_ON)
export type ThreadWaitingOn = typeof ThreadWaitingOn.Type

/**
 * The order a list of conversations is read in: by what happened last on the
 * conversation, or by the date of its latest message.
 */
export const THREAD_SORTS = ['recent_activity', 'latest_message'] as const
export const ThreadSort = Schema.Literals(THREAD_SORTS)
export type ThreadSort = typeof ThreadSort.Type

import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import { CallRecording } from './call-recordings'

// A raw call_recordings row as node-postgres returns it: byte_size is a BIGINT,
// which the pg driver returns as a STRING (never a number), and the TIMESTAMPTZ
// columns are JS Date objects. Columns are camelCased by the result transform.
const rawRow = {
	id: 'rec_1',
	interactionId: 'int_1',
	storageKey: 'recordings/co_1/abc.mp3',
	mimeType: 'audio/mpeg',
	byteSize: '1048576',
	durationSec: 120,
	transcriptStatus: null,
	transcriptText: null,
	transcriptSegments: null,
	detectedLanguages: null,
	transcribedAt: null,
	transcriptError: null,
	provider: null,
	providerRequestId: null,
	callerSpeakerId: null,
	deletedAt: null,
	createdAt: new Date('2026-07-01T10:00:00Z'),
	updatedAt: new Date('2026-07-01T10:00:00Z'),
}

describe('CallRecording', () => {
	describe('when byte_size arrives as the BIGINT string the pg driver returns', () => {
		it('should decode it to a number rather than rejecting the string', () => {
			// GIVEN a raw row whose byte_size is a string (BIGINT columns come
			//   back as strings from node-postgres). Typing it as a plain number
			//   would 500 every recordings list/get read.
			// WHEN the row is decoded through the domain model
			const decoded = Schema.decodeUnknownSync(CallRecording)(rawRow)
			// THEN the BIGINT string is coerced to a JS number
			expect(decoded.byteSize).toBe(1048576)
		})
	})
})

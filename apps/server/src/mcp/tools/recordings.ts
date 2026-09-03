import { Effect, Schema } from 'effect'
import { Tool, Toolkit } from 'effect/unstable/ai'

import { RecordingDetail, RecordingSummary } from '@batuda/controllers'

import { RecordingService } from '../../services/recordings'
import { CompanyIdParam, RecordingIdParam } from './_ids'
import { McpPageLimit, McpPageOffset, PageResult, toPage } from './_result'

const PlaybackInfo = Schema.Struct({
	url: Schema.String,
	expiresAt: Schema.String,
})
// `get_call_recording` returns the detail alone, or the detail plus a
// short-lived playback URL when the caller asks for one.
const RecordingWithPlayback = Schema.Struct({
	...RecordingDetail.fields,
	playback: PlaybackInfo,
})

const ListCallRecordings = Tool.make('list_call_recordings', {
	description:
		'List call recordings for a company, newest first by interaction date. Returns metadata only (no audio bytes, no transcript yet — transcription ships in a later phase). `hasMore` says whether more matched than were returned — read it before saying how many there are, and ask again with a larger `offset` if it is true.',
	parameters: Schema.Struct({
		company_id: CompanyIdParam,
		limit: Schema.optionalKey(McpPageLimit),
		offset: Schema.optionalKey(McpPageOffset),
	}),
	success: PageResult(RecordingSummary),
})
	.annotate(Tool.Title, 'List Call Recordings')
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

const GetCallRecording = Tool.make('get_call_recording', {
	description:
		'Get a single call recording by id, joined with its parent interaction. Set include_playback_url=true to also return a short-lived signed playback URL (expires in ~10 min) alongside metadata.',
	parameters: Schema.Struct({
		recording_id: RecordingIdParam,
		include_playback_url: Schema.optionalKey(Schema.Boolean),
	}),
	success: Schema.Union([RecordingDetail, RecordingWithPlayback]),
})
	.annotate(Tool.Title, 'Get Call Recording')
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

const DeleteCallRecording = Tool.make('delete_call_recording', {
	description:
		'Soft-delete a call recording. Marks the row deleted_at=now() and best-effort deletes the stored audio object; an orphaned object is fine to leave for a future cleanup cron if the storage delete fails.',
	parameters: Schema.Struct({
		recording_id: RecordingIdParam,
	}),
	success: Schema.Struct({
		status: Schema.Literal('deleted'),
	}),
})
	.annotate(Tool.Title, 'Delete Call Recording')
	.annotate(Tool.Destructive, true)
	.annotate(Tool.Idempotent, true)
	.annotate(Tool.OpenWorld, false)

export const RecordingTools = Toolkit.make(
	ListCallRecordings,
	GetCallRecording,
	DeleteCallRecording,
)

export const RecordingHandlersLive = RecordingTools.toLayer(
	Effect.gen(function* () {
		const svc = yield* RecordingService
		return {
			list_call_recordings: params =>
				svc
					.listForCompany(
						params.company_id,
						params.limit ?? 50,
						params.offset ?? 0,
					)
					.pipe(Effect.map(toPage), Effect.orDie),
			get_call_recording: ({ recording_id, include_playback_url }) =>
				Effect.gen(function* () {
					const recording = yield* svc.getById(recording_id).pipe(Effect.orDie)
					if (!include_playback_url) return recording
					const playback = yield* svc
						.getPlaybackUrl(recording_id)
						.pipe(Effect.orDie)
					return { ...recording, playback }
				}),
			delete_call_recording: ({ recording_id }) =>
				Effect.gen(function* () {
					yield* svc.softDelete(recording_id)
					return { status: 'deleted' as const }
				}).pipe(Effect.orDie),
		}
	}),
)

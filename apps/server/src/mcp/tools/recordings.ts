import { Effect, Schema } from 'effect'
import { Tool, Toolkit } from 'effect/unstable/ai'

import { RecordingService } from '../../services/recordings'

const ListCallRecordings = Tool.make('list_call_recordings', {
	description:
		'List call recordings for a company, newest first by interaction date. Returns metadata only (no audio bytes, no transcript yet — transcription ships in a later phase).',
	parameters: Schema.Struct({
		company_id: Schema.String,
		limit: Schema.optional(Schema.Number),
		offset: Schema.optional(Schema.Number),
	}),
	success: Schema.Unknown,
})
	.annotate(Tool.Title, 'List Call Recordings')
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

const GetCallRecording = Tool.make('get_call_recording', {
	description:
		'Get a single call recording by id, joined with its parent interaction. Returns metadata only — no audio bytes, no transcript yet.',
	parameters: Schema.Struct({
		recording_id: Schema.String,
	}),
	success: Schema.Unknown,
})
	.annotate(Tool.Title, 'Get Call Recording')
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

export const RecordingTools = Toolkit.make(ListCallRecordings, GetCallRecording)

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
					.pipe(Effect.orDie),
			get_call_recording: ({ recording_id }) =>
				svc.getById(recording_id).pipe(Effect.orDie),
		}
	}),
)

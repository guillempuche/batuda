import { randomUUID } from 'node:crypto'

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { Config, Effect, Redacted } from 'effect'

import { normalizeRows, type SeedCtx, silentWav } from './shared'

type RecordingSpec = {
	subject: string
	companySlug: string
	upload: boolean
	durationSec: number
	transcriptStatus?: 'pending' | 'done' | 'failed'
	transcriptText?: string
	transcriptError?: string
	transcriptSegments?: unknown
	detectedLanguages?: unknown
	transcribedAt?: Date
	provider?: string
	providerRequestId?: string
	callerSpeakerId?: string
	deletedAt?: Date
}

export const seedRecordings = (
	{ sql, stamp }: SeedCtx,
	companyMap: Map<string, string>,
) =>
	Effect.gen(function* () {
		yield* Effect.logInfo('Seeding call recordings...')
		const phoneVisitRows = yield* sql<{
			id: string
			subject: string | null
		}>`SELECT id, subject FROM interactions WHERE channel IN ('phone', 'visit')`
		const idBySubject = new Map<string, string>()
		for (const row of phoneVisitRows) {
			if (row.subject) idBySubject.set(row.subject, row.id)
		}

		const storageEndpoint = yield* Config.string('STORAGE_ENDPOINT')
		const storageRegion = yield* Config.string('STORAGE_REGION')
		const storageAccessKeyId = yield* Config.string('STORAGE_ACCESS_KEY_ID')
		const storageSecretAccessKey = yield* Config.redacted(
			'STORAGE_SECRET_ACCESS_KEY',
		)
		const storageBucket = yield* Config.string('STORAGE_BUCKET')
		const s3 = new S3Client({
			endpoint: storageEndpoint,
			region: storageRegion,
			credentials: {
				accessKeyId: storageAccessKeyId,
				secretAccessKey: Redacted.value(storageSecretAccessKey),
			},
			forcePathStyle: true,
		})
		const wavBody = silentWav(0.1)

		const recordingSpecs: RecordingSpec[] = [
			{
				subject: 'Visita al restaurant',
				companySlug: 'cal-pep-fonda',
				upload: true,
				durationSec: 240,
			},
			{
				subject: 'Trucada amb gerent',
				companySlug: 'ferros-baix-llobregat',
				upload: true,
				durationSec: 1820,
				transcriptStatus: 'done',
				transcriptText:
					"Jordi Puig: Bon dia, gràcies per la trucada.\nComercial: Bon dia Jordi, tenim la proposta que comentàvem la setmana passada. Volia confirmar que les dates encaixen.\nJordi: Sí, d'acord, podem començar al maig.",
				transcribedAt: new Date('2026-03-15T10:42:00Z'),
				provider: 'whisper-large-v3',
				providerRequestId: 'wh_req_ferros_001',
				detectedLanguages: { primary: 'ca', confidence: 0.97 },
			},
			{
				subject: "Visita a l'hostal",
				companySlug: 'hostal-pirineu',
				upload: false,
				durationSec: 2700,
				transcriptStatus: 'pending',
				provider: 'whisper-large-v3',
				providerRequestId: 'wh_req_hostal_pending',
			},
			{
				subject: 'Inbound call',
				companySlug: 'coastal-freight',
				upload: false,
				durationSec: 180,
				transcriptStatus: 'failed',
				transcriptError:
					'audio too quiet to transcribe (SNR < 3 dB on primary channel)',
				provider: 'whisper-large-v3',
				providerRequestId: 'wh_req_coastal_001',
			},
			// GDPR soft-delete: audio purged, metadata retained.
			{
				subject: 'Demo presencial a Sitges',
				companySlug: 'tancaments-garraf',
				upload: false,
				durationSec: 7200,
				deletedAt: new Date('2026-04-05T00:00:00Z'),
			},
			{
				subject: 'Seguiment post-demo',
				companySlug: 'hostal-pirineu',
				upload: true,
				durationSec: 1480,
				transcriptStatus: 'done',
				transcriptText:
					'Comercial: Hola Arnau, com ha anat la prova amb el personal?\nArnau Ribas: Bé, molt bé. A veure, té moltes funcions, ens anirà bé.',
				transcribedAt: new Date('2026-04-05T15:30:00Z'),
				provider: 'whisper-large-v3',
				providerRequestId: 'wh_req_hostal_002',
				callerSpeakerId: 'speaker_0',
				detectedLanguages: {
					primary: 'ca',
					secondary: 'es',
					confidence: 0.92,
				},
				transcriptSegments: [
					{
						start: 0,
						end: 3.2,
						speaker: 'speaker_0',
						text: 'Hola Arnau, com ha anat la prova amb el personal?',
					},
					{
						start: 3.2,
						end: 8.5,
						speaker: 'speaker_1',
						text: 'Bé, molt bé. A veure, té moltes funcions, ens anirà bé.',
					},
				],
			},
		]

		const recordingRows: Array<Record<string, unknown>> = []
		let uploadedCount = 0
		for (const spec of recordingSpecs) {
			const interactionId = idBySubject.get(spec.subject)
			if (!interactionId) continue
			const companyId = companyMap.get(spec.companySlug)!
			const storageKey = `recordings/${companyId}/${randomUUID()}.wav`
			if (spec.upload) {
				yield* Effect.tryPromise(() =>
					s3.send(
						new PutObjectCommand({
							Bucket: storageBucket,
							Key: storageKey,
							Body: wavBody,
							ContentType: 'audio/wav',
							ContentLength: wavBody.byteLength,
						}),
					),
				)
				uploadedCount += 1
			}
			recordingRows.push({
				interactionId,
				storageKey,
				mimeType: 'audio/wav',
				byteSize: wavBody.byteLength,
				durationSec: spec.durationSec,
				transcriptStatus: spec.transcriptStatus ?? null,
				transcriptText: spec.transcriptText ?? null,
				transcriptError: spec.transcriptError ?? null,
				transcriptSegments:
					spec.transcriptSegments != null
						? JSON.stringify(spec.transcriptSegments)
						: null,
				detectedLanguages:
					spec.detectedLanguages != null
						? JSON.stringify(spec.detectedLanguages)
						: null,
				transcribedAt: spec.transcribedAt ?? null,
				provider: spec.provider ?? null,
				providerRequestId: spec.providerRequestId ?? null,
				callerSpeakerId: spec.callerSpeakerId ?? null,
				deletedAt: spec.deletedAt ?? null,
			})
		}

		if (recordingRows.length > 0) {
			yield* sql`INSERT INTO call_recordings ${sql.insert(
				normalizeRows(stamp(recordingRows)),
			)}`
			yield* Effect.logInfo(
				`  ${recordingRows.length} recordings (${uploadedCount} uploaded, ${recordingRows.length - uploadedCount} missing/deleted)`,
			)
		}
	})

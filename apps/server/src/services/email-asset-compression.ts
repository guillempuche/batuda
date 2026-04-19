import { Effect } from 'effect'
import sharp from 'sharp'

import { BadRequest } from '@engranatge/controllers'

// Email-domain image compression. Runs server-side in the staging POST
// handler before the StorageProvider.put call — bytes reach storage
// already shaped for email delivery. Other StorageProvider consumers
// (recordings, research blobs) do NOT call this; they store verbatim.
//
// Policy:
//   - images → max dimension 1600px; re-encode to JPEG (no alpha) or PNG
//     (alpha). HEIC/HEIF/AVIF → JPEG for universal client compatibility.
//   - SVG → pass through (no raster resize); caller may sanitize.
//   - GIF → pass through (sharp-resize kills animation).
//   - everything else → caller skips calling this; stored verbatim.
// Hard 25 MB ceiling matches the AgentMail per-message limit.

export const MAX_BYTES = 25 * 1024 * 1024
const DEFAULT_MAX_DIMENSION = 1600
const DEFAULT_JPEG_QUALITY = 82

export interface CompressedAsset {
	readonly bytes: Uint8Array
	readonly contentType: string
	readonly width: number | undefined
	readonly height: number | undefined
}

export interface CompressOptions {
	readonly maxDimension?: number
	readonly jpegQuality?: number
}

// Content types we recognise as rasterizable. HEIF/HEIC/AVIF are rewritten
// to JPEG since they are Apple-/Android-native formats with spotty email-
// client support.
const RASTER_TYPES = new Set([
	'image/jpeg',
	'image/pjpeg',
	'image/png',
	'image/webp',
	'image/heic',
	'image/heif',
	'image/avif',
	'image/tiff',
])

// Pass-through types. Stored byte-identical.
const PASSTHROUGH_IMAGE_TYPES = new Set(['image/gif', 'image/svg+xml'])

export const compressEmailImage = (
	bytes: Uint8Array,
	contentType: string,
	options: CompressOptions = {},
): Effect.Effect<CompressedAsset, BadRequest> =>
	Effect.gen(function* () {
		const lower = contentType.toLowerCase()

		// Guardrail at the top — nothing above 25 MB compresses cheaply,
		// and sharp's default decode limits reject pathological inputs.
		if (bytes.byteLength > MAX_BYTES) {
			return yield* new BadRequest({
				message: `Attachment exceeds ${MAX_BYTES} byte limit`,
			})
		}

		if (PASSTHROUGH_IMAGE_TYPES.has(lower) || !RASTER_TYPES.has(lower)) {
			return {
				bytes,
				contentType,
				width: undefined,
				height: undefined,
			}
		}

		const maxDim = options.maxDimension ?? DEFAULT_MAX_DIMENSION
		const quality = options.jpegQuality ?? DEFAULT_JPEG_QUALITY

		const result = yield* Effect.tryPromise({
			try: async () => {
				// rotate() applies EXIF orientation then strips it — otherwise a
				// resized photo may display rotated on email clients that ignore EXIF.
				const pipeline = sharp(bytes, { failOn: 'warning' }).rotate()

				const metadata = await pipeline.metadata()
				const hasAlpha = Boolean(metadata.hasAlpha)
				const outContentType = hasAlpha ? 'image/png' : 'image/jpeg'

				let resized = pipeline.resize({
					width: maxDim,
					height: maxDim,
					fit: 'inside',
					withoutEnlargement: true,
				})

				if (outContentType === 'image/jpeg') {
					resized = resized.jpeg({
						quality,
						mozjpeg: true,
						progressive: true,
						chromaSubsampling: '4:2:0',
					})
				} else {
					resized = resized.png({
						compressionLevel: 9,
						palette: true,
					})
				}

				const { data, info } = await resized.toBuffer({
					resolveWithObject: true,
				})
				return {
					bytes: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
					contentType: outContentType,
					width: info.width,
					height: info.height,
				} satisfies CompressedAsset
			},
			catch: error =>
				new BadRequest({
					message: `Failed to compress image: ${error instanceof Error ? error.message : String(error)}`,
				}),
		})

		if (result.bytes.byteLength > MAX_BYTES) {
			return yield* new BadRequest({
				message: `Compressed image still exceeds ${MAX_BYTES} byte limit`,
			})
		}
		return result
	})

// Helper for the staging pipeline: tells whether compression should run.
// Non-image types (PDF, zip, docx…) bypass the compressor entirely.
export const isCompressibleImage = (contentType: string): boolean => {
	const lower = contentType.toLowerCase()
	return RASTER_TYPES.has(lower) || PASSTHROUGH_IMAGE_TYPES.has(lower)
}

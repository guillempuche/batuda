/** biome-ignore-all lint/style/noNonNullAssertion: seed data */
import type { SqlClient } from 'effect/unstable/sql'

/** Align row shapes within a batch — sql.insert requires uniform keys. */
export const normalizeRows = <T extends Record<string, unknown>>(
	rows: T[],
): T[] => {
	const allKeys = new Set<string>()
	for (const row of rows) for (const k of Object.keys(row)) allKeys.add(k)
	return rows.map(
		row =>
			Object.fromEntries(
				[...allKeys].map(k => [k, k in row ? row[k] : null]),
			) as T,
	)
}

/**
 * Build a minimal silent WAV file in-memory. 8 kHz mono 16-bit PCM, ~0.1 s.
 * Good enough for the seed — tiny (~1.6 KB) and a real player opens it without
 * complaint, so the "has audio" UI path is exercisable.
 */
export const silentWav = (durationSec = 0.1, sampleRate = 8000): Buffer => {
	const samples = Math.floor(durationSec * sampleRate)
	const dataSize = samples * 2
	const buf = Buffer.alloc(44 + dataSize)
	buf.write('RIFF', 0)
	buf.writeUInt32LE(36 + dataSize, 4)
	buf.write('WAVE', 8)
	buf.write('fmt ', 12)
	buf.writeUInt32LE(16, 16)
	buf.writeUInt16LE(1, 20)
	buf.writeUInt16LE(1, 22)
	buf.writeUInt32LE(sampleRate, 24)
	buf.writeUInt32LE(sampleRate * 2, 28)
	buf.writeUInt16LE(2, 32)
	buf.writeUInt16LE(16, 34)
	buf.write('data', 36)
	buf.writeUInt32LE(dataSize, 40)
	return buf
}

// 1×1 transparent PNG (67 bytes) — used by attachment demo messages so
// the chip render path has real bytes flowing through MinIO.
export const ONE_PIXEL_PNG = Buffer.from(
	'89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c62000100000500010d0a2db40000000049454e44ae426082',
	'hex',
)

// Minimal valid PDF (~290 bytes). Empty single-page A4 document.
// Used as the M8 quote.pdf attachment so the chip download produces
// bytes a PDF viewer will at least open without erroring.
export const TINY_PDF = Buffer.from(
	[
		'%PDF-1.4',
		'1 0 obj <</Type/Catalog/Pages 2 0 R>> endobj',
		'2 0 obj <</Type/Pages/Kids[3 0 R]/Count 1>> endobj',
		'3 0 obj <</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>> endobj',
		'xref',
		'0 4',
		'0000000000 65535 f ',
		'0000000009 00000 n ',
		'0000000054 00000 n ',
		'0000000104 00000 n ',
		'trailer <</Size 4/Root 1 0 R>>',
		'startxref',
		'160',
		'%%EOF',
	].join('\n'),
	'utf8',
)

// ── Presets ───────────────────────────────────────────────

export const PRESETS = ['minimal', 'full'] as const
export type Preset = (typeof PRESETS)[number]

/** Stamps `organization_id: tallerOrgId` on every row before sql.insert. */
export type StampFn = <T extends Record<string, unknown>>(
	rows: ReadonlyArray<T>,
) => T[]

export type SeedCtx = {
	readonly sql: SqlClient.SqlClient
	readonly preset: Preset
	readonly tallerOrgId: string
	readonly restaurantOrgId: string | null
	readonly stamp: StampFn
}

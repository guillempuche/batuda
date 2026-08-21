/**
 * The reachability of each research vendor, as `doctor` rows. `research eval
 * --dry-run` prints the same probe its own way, so both commands say the same
 * thing about the same vendors.
 *
 * Never `fail`, only `warn`: somebody working on Batuda without research keys is
 * not doing anything wrong, and a red row would say they were.
 */

import { Effect } from 'effect'
import { FetchHttpClient } from 'effect/unstable/http'

import {
	hostOf,
	probeReachability,
	researchProviderEndpoints,
} from '@batuda/research'

import type { CheckResult } from '../commands/doctor'

/**
 * What both commands say when no part of the pipeline goes to a vendor. It sits
 * beside the commands rather than in the research package because it is a
 * finished sentence for a person to read, and it is shared so a reader
 * comparing the two screens can see they ran the same check.
 */
export const NOTHING_TO_REACH =
	'no part of the research pipeline is pointed at a vendor — nothing to reach'

/** What both commands say about a setting somebody wrote and got wrong. */
export const settingWillNotRead = (detail: string): string =>
	`its setting will not read, so nothing was checked — ${detail}`

/**
 * One row per vendor host, probes already run by the time the rows come back.
 * They go out together, so a machine cut off from four vendors waits once
 * rather than four times.
 */
export const researchReachabilityChecks = (): Effect.Effect<CheckResult[]> =>
	Effect.gen(function* () {
		const { endpoints, unreadable } = yield* researchProviderEndpoints()
		// A setting somebody wrote and got wrong is worth an amber row: nothing was
		// checked behind it, and reading that as a pass is how a broken setting
		// survives to waste a pass.
		const broken: CheckResult[] = unreadable.map(({ part, detail }) => ({
			name: `Research ${part}`,
			status: 'warn' as const,
			detail: settingWillNotRead(detail),
		}))
		// Said rather than left out, so a machine with nothing configured reads as
		// one that was looked at. Only when nothing is broken either: a part that
		// would not read may well have been pointed at a vendor, and there is no
		// way from here to say it was not.
		if (endpoints.length === 0 && broken.length === 0) {
			return [
				{
					name: 'Research vendors',
					status: 'ok' as const,
					detail: NOTHING_TO_REACH,
				},
			]
		}
		const results = yield* probeReachability(endpoints)
		return [
			...broken,
			...results.map(result => ({
				name: `Research ${hostOf(result.origin)}`,
				status:
					result.verdict === 'reachable' ? ('ok' as const) : ('warn' as const),
				detail: `${result.detail} Used by: ${result.labels.join(', ')}.`,
			})),
		]
	}).pipe(Effect.provide(FetchHttpClient.layer))

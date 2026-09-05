import { Atom } from 'effect/unstable/reactivity'
import { describe, expect, it } from 'vitest'

import {
	companiesListAtom,
	nextStepsAtom,
	openTasksAtom,
	pipelineAtom,
} from './pipeline-atoms'

describe('pipeline atoms', () => {
	describe('when a route loader hands their values from the server to the browser', () => {
		it('should be serializable, so the handover does not throw and the browser does not refetch', () => {
			// GIVEN the atoms the dashboard and tasks loaders dehydrate
			const handedOver = {
				companiesListAtom,
				openTasksAtom,
				pipelineAtom,
				nextStepsAtom,
			}

			// WHEN each one is checked for a serialization key
			const missing = Object.entries(handedOver)
				.filter(([, atom]) => !Atom.isSerializable(atom))
				.map(([name]) => name)

			// THEN none is missing one — a query without `serializationKey` is a
			// plain atom, the handover throws on it, and the page comes up broken
			// instead of pre-filled
			expect(missing).toEqual([])
		})

		it('should give each atom its own key, so two answers never overwrite each other', () => {
			// GIVEN the atoms the dashboard and tasks loaders dehydrate
			const handedOver = [
				companiesListAtom,
				openTasksAtom,
				pipelineAtom,
				nextStepsAtom,
			]

			// WHEN their serialization keys are collected
			const keys = handedOver
				.filter(Atom.isSerializable)
				.map(atom => atom[Atom.SerializableTypeId].key)

			// THEN no two atoms share one
			expect(new Set(keys).size).toBe(handedOver.length)
		})
	})
})

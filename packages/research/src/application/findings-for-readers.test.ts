import { describe, expect, it } from 'vitest'

import { forReaders, runForReaders } from './findings-for-readers'

describe('forReaders', () => {
	describe('when a field is paired with the page it was read on', () => {
		it('should give the value under the field name and the page beside it', () => {
			// GIVEN a row holding one paired field and one bare one
			const flat = forReaders({
				name: 'Acme',
				website: {
					value: 'https://acme.example',
					source_id: 'src_1',
					quote: 'Acme, Ripollet',
					confidence: 1,
				},
			})

			// THEN the value sits under its own name, so a reader never has to know
			//   which fields are paired this week, and the page is kept under the
			//   same name in the evidence map
			expect(flat).toEqual({
				name: 'Acme',
				website: 'https://acme.example',
				evidence: {
					website: {
						source_id: 'src_1',
						quote: 'Acme, Ripollet',
						confidence: 1,
					},
				},
			})
		})
	})

	describe('when a run was stored before the field was paired', () => {
		it('should hand the row back untouched', () => {
			// GIVEN a row written when every field was bare
			const row = { name: 'Acme', website: 'https://acme.example' }

			// THEN nothing is added. Both shapes are on the wire forever because
			//   nothing migrates a stored run, and an empty evidence map on every
			//   old row would be noise a reader has to step over.
			expect(forReaders(row)).toEqual(row)
			expect(forReaders(row)).not.toHaveProperty('evidence')
		})
	})

	describe('when a value was paired with no page to name', () => {
		it('should still give the value, and claim no evidence for it', () => {
			// GIVEN a field stored as `{ value }` and nothing beside it, which is
			//   what a value that arrived bare is written as — no page was known,
			//   and naming one would turn a missing citation into a false one. Most
			//   stored rows carry a location written exactly that way.
			const flat = forReaders({ location: { value: 'Terrassa, Barcelona' } })

			// THEN the value comes through as text, with no evidence entry standing
			//   in for a page nobody has. Walked past for carrying no provenance,
			//   this reaches a reader as an object — and a screen expecting text
			//   renders an object rather than a place.
			expect(flat).toEqual({ location: 'Terrassa, Barcelona' })
		})
	})

	describe('when an object carries a value beside something else', () => {
		it('should leave it alone', () => {
			// GIVEN a contact channel, written as the kind of channel and its value
			const row = { channel: { kind: 'email', value: 'hola@acme.example' } }

			// THEN it is untouched. Flattened to the value alone it would lose which
			//   kind of channel it is, which is half of what the object says.
			expect(forReaders(row)).toEqual(row)
		})
	})

	describe('when the paired fields sit deep in the answer', () => {
		it('should settle each one against the object holding it', () => {
			// GIVEN a list of rows, each with its own paired field
			const flat = forReaders({
				prospects: [
					{ name: 'A', location: { value: 'Ripollet', source_id: 'src_1' } },
					{ name: 'B', location: { value: 'Rubí', source_id: 'src_2' } },
				],
			})

			// THEN each row carries its own evidence, rather than one map at the top
			//   naming fields that belong to different companies
			expect(flat).toEqual({
				prospects: [
					{
						name: 'A',
						location: 'Ripollet',
						evidence: { location: { source_id: 'src_1' } },
					},
					{
						name: 'B',
						location: 'Rubí',
						evidence: { location: { source_id: 'src_2' } },
					},
				],
			})
		})
	})

	describe('when a paired field holds something other than text', () => {
		it('should keep whatever it held', () => {
			// GIVEN a number and a list, each paired
			const flat = forReaders({
				employee_estimate: { value: 42, source_id: 'src_1' },
				countries: { value: ['ES', 'FR'], confidence: 0.5 },
			}) as Record<string, unknown>

			// THEN the values come through as they were: this settles the SHAPE of a
			//   field, and reading the value would be a second decision nobody asked
			//   for
			expect(flat['employee_estimate']).toBe(42)
			expect(flat['countries']).toEqual(['ES', 'FR'])
		})
	})

	describe('when the answer already carries a field called evidence', () => {
		it('should leave the answer exactly as it is', () => {
			// GIVEN an object with its own `evidence` key beside a paired field
			const row = {
				evidence: 'something a schema stored',
				website: { value: 'https://acme.example', source_id: 'src_1' },
			}

			// THEN the existing value survives and the field stays paired. A reader
			//   then meets the older shape, which is one it could already read —
			//   where overwriting would destroy an answer outright.
			expect(forReaders(row)).toEqual(row)
		})
	})

	describe('when a provenance key is one nobody named', () => {
		it('should not carry it into the evidence map', () => {
			// GIVEN a wrapper holding a key beyond the four that are provenance
			const flat = forReaders({
				website: {
					value: 'https://acme.example',
					source_id: 'src_1',
					scraped_by: 'some-vendor',
				},
			}) as { evidence: Record<string, Record<string, unknown>> }

			// THEN only the named keys travel. An unlisted one would reach a reader
			//   as provenance with nobody having decided it should.
			expect(flat.evidence['website']).toEqual({ source_id: 'src_1' })
		})
	})

	describe('when the answer holds nothing to settle', () => {
		it('should pass every other kind of value straight through', () => {
			// GIVEN the shapes a findings tree can hold besides objects
			// THEN each comes back as it was
			expect(forReaders(null)).toBeNull()
			expect(forReaders(undefined)).toBeUndefined()
			expect(forReaders('text')).toBe('text')
			expect(forReaders(7)).toBe(7)
			expect(forReaders([])).toEqual([])
		})
	})

	describe('when a proposed change carries the record it would write', () => {
		it('should leave that record exactly as it is', () => {
			// GIVEN a proposal holding the columns and values it would write to a
			//   customer's own company record, one of them paired with its page
			const findings = {
				proposed_updates: [
					{
						subject_table: 'companies',
						fields: {
							name: 'Acme',
							industry: { value: 'metalworking', source_id: 'src_1' },
						},
					},
				],
			}

			// THEN nothing on it is settled. Those fields are a picture of a record
			//   rather than a finding, so gathering provenance there adds a column
			//   called "evidence" — and the screen showing somebody what would change
			//   then lists it among the columns, holding a blob.
			expect(forReaders(findings)).toEqual(findings)
		})
	})

	describe('when a stored answer holds a key called __proto__', () => {
		it('should keep it as an ordinary key', () => {
			// GIVEN model-written JSON, which can carry any key at all
			const flat = forReaders(
				JSON.parse('{"name":"Acme","__proto__":{"isAdmin":true}}'),
			) as Record<string, unknown>

			// THEN it stays a key on the object rather than reaching the prototype
			//   setter, where it would vanish from the answer and quietly answer
			//   every later lookup the object could not.
			expect(Object.keys(flat)).toContain('__proto__')
			expect((flat as { isAdmin?: unknown }).isAdmin).toBeUndefined()
		})
	})
})

describe('runForReaders', () => {
	describe('when a run carries findings', () => {
		it('should settle them and leave the rest of the run alone', () => {
			// GIVEN a run with its other columns beside the findings
			const stored = {
				id: 'r_1',
				status: 'succeeded',
				findings: {
					prospects: [
						{
							name: 'A',
							website: { value: 'https://a.example', source_id: 's' },
						},
					],
				},
			}
			const run = runForReaders(stored)

			// THEN only the findings change
			expect(run.id).toBe('r_1')
			expect(run.status).toBe('succeeded')
			expect(run.findings).toEqual({
				prospects: [
					{
						name: 'A',
						website: 'https://a.example',
						evidence: { website: { source_id: 's' } },
					},
				],
			})
		})
	})

	describe('when a run has no findings yet', () => {
		it('should hand it back as it is', () => {
			// GIVEN a run still working, and one whose findings key is absent
			// THEN neither is rebuilt, so a null stays null rather than becoming an
			//   empty object a reader would have to tell apart from a real answer
			const working = { id: 'r_1', findings: null }
			const absent = { id: 'r_1' }
			expect(runForReaders(working).findings).toBeNull()
			expect(runForReaders(absent)).toEqual({ id: 'r_1' })
		})
	})
})

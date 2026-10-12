import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import {
	CompanyCountry,
	CompanyEmail,
	CompanyInstagram,
	CompanyPhone,
	CompanySlug,
	CompanyTag,
} from './companies'

// The pattern a field's schema shows a client, wherever it sits in the
// generated document.
const advertisedPatterns = (schema: Schema.Top): ReadonlyArray<string> =>
	JSON.stringify(Schema.toJsonSchemaDocument(schema)).match(
		/"pattern":"((?:[^"\\]|\\.)*)"/g,
	) ?? []

describe('the shapes a company field shows a client', () => {
	describe('when a client reads the schema of a field with a fixed shape', () => {
		it.each([
			['slug', CompanySlug],
			['tag', CompanyTag],
			['country', CompanyCountry],
			['email', CompanyEmail],
			['phone', CompanyPhone],
			['instagram', CompanyInstagram],
		] as const)(
			'should show the %s shape it is checked against',
			(_name, field) => {
				// GIVEN a field the server refuses when it does not match a pattern
				// WHEN its schema is generated for a client — an assistant's tool list
				// or the API docs
				// THEN the pattern is in it, so a caller can get the value right the
				// first time instead of learning the shape from a refusal
				expect(advertisedPatterns(field).length).toBeGreaterThan(0)
			},
		)
	})
})

import pg from 'pg'
import { describe, expect, it } from 'vitest'

import { buildBetterAuthConfig } from '@batuda/auth'

import { betterAuthSchemaConfig } from './migrate.js'

// Better Auth owns its own tables and builds their shape from the config it is
// handed. Batuda hands it two: one here, which the migrator uses to create the
// columns, and one the running server builds, which is how the server knows
// those columns exist.
//
// Nothing makes the two agree. Add a field to only one and the failure is
// silent and deferred — a column nothing reads, or a server asking for a column
// that was never created, which surfaces on boot in production rather than
// here. This is the check that makes them agree.

// The builder needs a pool to hand Better Auth a dialect. Nothing in this file
// connects; only the declared shape is read.
const configForComparison = () =>
	buildBetterAuthConfig({
		env: {
			secret: 'test-secret',
			baseURL: 'https://api.batuda.localhost',
			useSecureCookies: false,
			trustedOrigins: ['https://batuda.localhost'],
			rateLimit: 'strict',
		},
		pool: new pg.Pool({ connectionString: 'postgresql://unused/unused' }),
		plugins: [],
	})

describe('Better Auth schema config', () => {
	describe('when compared with the config the running server builds', () => {
		it('should declare the same extra fields on the user table', () => {
			// GIVEN the config the migrator uses to create columns
			const migrator = betterAuthSchemaConfig.user.additionalFields

			// AND the config the running server uses to read them
			const runtime = configForComparison().user.additionalFields

			// WHEN the two are compared
			// THEN they name the same fields — a field on one side only is either
			// a column nothing reads or a read of a column that does not exist
			expect(Object.keys(migrator).sort()).toEqual(Object.keys(runtime).sort())
		})

		it('should agree on the type and nullability of each field', () => {
			// GIVEN both configs
			const migrator: Record<string, { type: unknown; required?: boolean }> =
				betterAuthSchemaConfig.user.additionalFields
			const runtime: Record<string, { type: unknown; required?: boolean }> =
				configForComparison().user.additionalFields

			// WHEN each shared field is compared
			for (const name of Object.keys(migrator)) {
				const created = migrator[name]
				const expected = runtime[name]
				// THEN the column the migrator creates matches the one the server
				// expects. A field created nullable but read as required fails at
				// runtime on the first row that lacks it.
				expect(created?.type, `${name} type`).toBe(expected?.type)
				expect(created?.required ?? false, `${name} required`).toBe(
					expected?.required ?? false,
				)
			}
		})
	})

	describe('when a plugin that brings its own tables is added', () => {
		it('should list it here too, or the migrator never creates them', () => {
			// GIVEN the plugins this config carries
			const ids = betterAuthSchemaConfig.plugins.map(plugin => plugin.id).sort()

			// WHEN compared with the set the migrator is known to cover
			// THEN they match. The server assembles its own plugin list at
			// runtime, so nothing can compare the two automatically — this pins
			// the migrator's side, so adding a plugin to the server without
			// adding it here is a deliberate act rather than an oversight.
			expect(ids).toEqual([
				'admin',
				'api-key',
				'bearer',
				'jwt',
				'oauth-provider',
				'open-api',
				'organization',
			])
		})
	})
})

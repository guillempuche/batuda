import { Config, Effect, Layer, ServiceMap } from 'effect'

export class EnvVars extends ServiceMap.Service<EnvVars>()('EnvVars', {
	make: Effect.gen(function* () {
		const DATABASE_URL = yield* Config.redacted('DATABASE_URL')
		const PORT = yield* Config.int('PORT').pipe(Config.withDefault(3010))
		const NODE_ENV = yield* Config.string('NODE_ENV').pipe(
			Config.withDefault('development'),
		)
		const MIN_LOG_LEVEL = yield* Config.string('MIN_LOG_LEVEL').pipe(
			Config.withDefault('Info'),
		)

		const BETTER_AUTH_SECRET = yield* Config.redacted('BETTER_AUTH_SECRET')
		const BETTER_AUTH_BASE_URL = yield* Config.string(
			'BETTER_AUTH_BASE_URL',
		).pipe(Config.withDefault(''))
		const BETTER_AUTH_INSECURE_COOKIES = yield* Config.boolean(
			'BETTER_AUTH_INSECURE_COOKIES',
		).pipe(Config.withDefault(false))
		const ALLOWED_ORIGINS = yield* Config.string('ALLOWED_ORIGINS').pipe(
			Config.withDefault(''),
			Config.map(s => (s ? s.split(',').map(o => o.trim()) : [])),
		)

		const AGENTMAIL_API_KEY = yield* Config.redacted('AGENTMAIL_API_KEY')
		const AGENTMAIL_WEBHOOK_SECRET = yield* Config.option(
			Config.redacted('AGENTMAIL_WEBHOOK_SECRET'),
		)

		return {
			DATABASE_URL,
			PORT,
			NODE_ENV,
			MIN_LOG_LEVEL,
			BETTER_AUTH_SECRET,
			BETTER_AUTH_BASE_URL,
			BETTER_AUTH_INSECURE_COOKIES,
			ALLOWED_ORIGINS,
			AGENTMAIL_API_KEY,
			AGENTMAIL_WEBHOOK_SECRET,
		} as const
	}),
}) {
	static readonly layer = Layer.effect(this, this.make)
}

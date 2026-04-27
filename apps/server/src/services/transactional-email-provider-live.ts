import { Config, Effect, Layer, Schema } from 'effect'

import { LocalTransactionalProviderLive } from './local-transactional-provider.js'
import { ResendTransactionalProviderLive } from './resend-transactional-provider.js'

// Boot-time selection via `EMAIL_PROVIDER_TRANSACTIONAL`. Capability-named
// (`feedback_env_var_naming`); adding a provider is a new case, not a rename.
// No `auto`/NODE_ENV fallback (`feedback_explicit_env_vars`): boot fails on
// unset / unknown values.
export const TransactionalEmailProviderLive = Layer.unwrap(
	Effect.gen(function* () {
		const provider = yield* Config.schema(
			Schema.Literals(['local', 'resend']),
			'EMAIL_PROVIDER_TRANSACTIONAL',
		)
		yield* Effect.logInfo(`transactional email provider: ${provider}`)
		switch (provider) {
			case 'local':
				return LocalTransactionalProviderLive
			case 'resend':
				return ResendTransactionalProviderLive
		}
	}),
)

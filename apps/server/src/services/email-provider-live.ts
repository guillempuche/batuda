import { Config, Effect, Layer, Schema } from 'effect'

import { AgentMailProviderLive } from './agentmail-provider'
import { LocalInboxProviderLive } from './local-inbox-provider'

export const EmailProviderLive = Layer.unwrap(
	Effect.gen(function* () {
		const provider = yield* Config.schema(
			Schema.Literals(['local-inbox', 'agentmail']),
			'EMAIL_PROVIDER',
		)
		yield* Effect.logInfo(`email provider: ${provider}`)
		return provider === 'agentmail'
			? AgentMailProviderLive
			: LocalInboxProviderLive
	}),
)

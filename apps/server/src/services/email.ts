import { Config, Effect, Layer, ServiceMap } from 'effect'

export class EmailService extends ServiceMap.Service<EmailService>()(
	'EmailService',
	{
		make: Effect.gen(function* () {
			const apiKey = yield* Config.string('RESEND_API_KEY').pipe(
				Config.withDefault(''),
			)
			const fromAddress = yield* Config.string('EMAIL_FROM').pipe(
				Config.withDefault('noreply@engranatge.com'),
			)

			return {
				send: (to: string, subject: string, html: string) =>
					Effect.gen(function* () {
						if (!apiKey) {
							yield* Effect.logWarning('RESEND_API_KEY not set, skipping email')
							return { id: 'skipped' }
						}
						const { Resend } = yield* Effect.promise(() => import('resend'))
						const resend = new Resend(apiKey)
						const result = yield* Effect.tryPromise({
							try: () =>
								resend.emails.send({
									from: fromAddress,
									to,
									subject,
									html,
								}),
							catch: (e: unknown) =>
								new Error(`Email send failed: ${String(e)}`),
						})
						return result
					}),
			}
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make)
}

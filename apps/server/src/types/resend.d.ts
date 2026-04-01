// Stub — will be replaced by Postmark integration
declare module 'resend' {
	export class Resend {
		constructor(apiKey: string)
		emails: {
			send(options: {
				from: string
				to: string
				subject: string
				html: string
			}): Promise<{ id: string }>
		}
	}
}

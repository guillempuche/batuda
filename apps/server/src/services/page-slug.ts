import { randomInt } from 'node:crypto'

const tokenAlphabet = '0123456789abcdefghjkmnpqrstvwxyz'
const tokenLength = 6

const nextToken = (): string => {
	let token = ''
	for (let i = 0; i < tokenLength; i++) {
		token += tokenAlphabet[randomInt(tokenAlphabet.length)]
	}
	return token
}

export const buildPageSlug = (companySlug: string): string =>
	`${companySlug}-${nextToken()}`

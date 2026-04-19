import { Body, Font, Head, Html, Preview } from '@react-email/components'
import type { ReactNode } from 'react'

import { brandFontFaces, brandTheme } from '../theme'

// Outer wrapper. Deliberately minimal — no container div, no max-width
// ceiling, no header bar. The body sits directly inside <body> so the
// result reads as a typed message, not a transactional template.

export interface EmailBodyProps {
	readonly preview?: string | undefined
	readonly children: ReactNode
}

export const EmailBody = ({ preview, children }: EmailBodyProps) => {
	return (
		<Html lang='en'>
			<Head>
				{brandFontFaces.map(face => (
					<Font
						key={`${face.family}-${face.weight}`}
						fontFamily={face.family}
						fallbackFontFamily={['Arial', 'sans-serif']}
						webFont={{ url: face.url, format: face.format as 'woff2' }}
						fontWeight={face.weight}
						fontStyle={face.style}
					/>
				))}
			</Head>
			{preview ? <Preview>{preview}</Preview> : null}
			<Body style={brandTheme.body}>{children}</Body>
		</Html>
	)
}

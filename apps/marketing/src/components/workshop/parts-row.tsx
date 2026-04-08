import { useInView } from 'motion/react'
import { AnimateNumber } from 'motion-plus/react'
import { useRef } from 'react'
import styled from 'styled-components'

import { htmlLang } from '#/i18n'
import { useLang } from '#/i18n/lang-provider'

const Row = styled.div.withConfig({ displayName: 'PartsRow' })`
	display: flex;
	justify-content: space-between;
	align-items: baseline;
	padding: var(--space-md) 0;
	border-bottom: 1px solid var(--color-outline-variant);
	gap: var(--space-md);

	&:last-child {
		border-bottom: none;
	}
`

const Info = styled.div`
	display: flex;
	flex-direction: column;
	gap: var(--space-3xs);
`

const Name = styled.span`
	font-size: var(--typescale-body-large-size);
	font-weight: var(--font-weight-medium);
	color: var(--color-on-surface);
`

const Description = styled.span`
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface-variant);
`

const PriceGroup = styled.div`
	display: flex;
	flex-direction: column;
	align-items: flex-end;
	flex-shrink: 0;
`

const Price = styled.span`
	font-size: var(--typescale-title-medium-size);
	font-weight: var(--typescale-title-medium-weight);
	color: var(--color-on-surface);
`

const Unit = styled.span`
	font-size: var(--typescale-label-small-size);
	color: var(--color-on-surface-variant);
`

/** Extract the numeric value from a price string like "500 €" or "2.000 €" */
function parsePrice(price: string): { value: number; suffix: string } {
	const match = price.match(/^([\d.]+)\s*(.*)$/)
	if (!match) return { value: 0, suffix: price }
	const [, digits = '', tail = ''] = match
	// Remove thousands separator dots (European format: 2.000 = 2000)
	const num = Number(digits.replace(/\./g, ''))
	return { value: num, suffix: ` ${tail}` }
}

export function PartsRow({
	name,
	description,
	price,
	unit,
}: {
	name: string
	description?: string
	price: string
	unit?: string
}) {
	const ref = useRef<HTMLDivElement>(null)
	const isInView = useInView(ref, { once: true, amount: 0.5 })
	const { value, suffix } = parsePrice(price)
	const lang = useLang()

	return (
		<Row ref={ref}>
			<Info>
				<Name>{name}</Name>
				{description && <Description>{description}</Description>}
			</Info>
			<PriceGroup>
				<Price>
					<AnimateNumber
						suffix={suffix}
						locales={htmlLang[lang]}
						format={{ useGrouping: true }}
						transition={{
							y: { type: 'spring', duration: 1.2, bounce: 0 },
							opacity: { duration: 0.8 },
						}}
					>
						{isInView ? value : 0}
					</AnimateNumber>
				</Price>
				{unit && <Unit>{unit}</Unit>}
			</PriceGroup>
		</Row>
	)
}

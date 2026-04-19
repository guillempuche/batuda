import { Heading, Hr, Img, Link, Text } from '@react-email/components'
import type { CSSProperties, ReactNode } from 'react'
import { Fragment } from 'react'

import { resolveImageSrc, type StagingIndex } from '../render'
import type {
	EmailBlock,
	HeadingBlock,
	ImageBlock,
	ListBlock,
	ParagraphBlock,
	QuoteBlock,
	Span,
} from '../schema'
import { brandTheme } from '../theme'
import { EmailBody } from './email-body'
import { SignOff } from './sign-off'

// Top-level component consumed by render.ts. Walks the block tree and
// emits themed, inline-styled React Email primitives. Every node that
// reaches the wire has its brand styles inlined — no stylesheet
// dependency. The editor canvas renders with the same primitives so
// WYSIWYG parity is literal, not approximate.

export interface AgentEmailProps {
	readonly blocks: ReadonlyArray<EmailBlock>
	readonly stagingIndex: StagingIndex
	readonly preview?: string | undefined
	readonly signOff?:
		| {
				readonly author?: string | undefined
				readonly brand?: string | undefined
				readonly city?: string | undefined
		  }
		| undefined
}

export const AgentEmail = ({
	blocks,
	stagingIndex,
	preview,
	signOff,
}: AgentEmailProps) => {
	return (
		<EmailBody preview={preview}>
			{blocks.map((block, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: static tree, no reorder
				<Fragment key={i}>{renderBlock(block, stagingIndex)}</Fragment>
			))}
			{signOff ? (
				<SignOff
					author={signOff.author}
					brand={signOff.brand}
					city={signOff.city}
				/>
			) : null}
		</EmailBody>
	)
}

const renderBlock = (block: EmailBlock, index: StagingIndex): ReactNode => {
	switch (block.type) {
		case 'paragraph':
			return renderParagraph(block)
		case 'heading':
			return renderHeading(block)
		case 'list':
			return renderList(block)
		case 'divider':
			return <Hr style={brandTheme.divider} />
		case 'image':
			return renderImage(block, index)
		case 'quote':
			return renderQuote(block, index)
	}
}

const renderParagraph = (block: ParagraphBlock): ReactNode => (
	<Text style={brandTheme.paragraph}>{renderSpans(block.spans)}</Text>
)

const renderHeading = (block: HeadingBlock): ReactNode => {
	const level = `h${block.level}` as 'h1' | 'h2' | 'h3'
	const style: CSSProperties = {
		...brandTheme.heading,
		...brandTheme.heading[block.level],
	}
	return (
		<Heading as={level} style={style}>
			{renderSpans(block.spans)}
		</Heading>
	)
}

const renderList = (block: ListBlock): ReactNode => {
	const Tag = block.ordered ? 'ol' : 'ul'
	return (
		<Tag style={brandTheme.list}>
			{block.items.map((item, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: static tree, no reorder
				<li key={i} style={brandTheme.listItem}>
					{renderSpans(item)}
				</li>
			))}
		</Tag>
	)
}

const renderImage = (block: ImageBlock, index: StagingIndex): ReactNode => {
	const src = resolveImageSrc(block, index)
	const extra: CSSProperties = {}
	if (block.width !== undefined) extra.width = block.width
	if (block.height !== undefined) extra.height = block.height
	return (
		<Img src={src} alt={block.alt} style={{ ...brandTheme.image, ...extra }} />
	)
}

const renderQuote = (block: QuoteBlock, index: StagingIndex): ReactNode => (
	<blockquote style={brandTheme.quote}>
		{block.children.map((c, i) => (
			// biome-ignore lint/suspicious/noArrayIndexKey: static tree, no reorder
			<Fragment key={i}>{renderBlock(c, index)}</Fragment>
		))}
	</blockquote>
)

const renderSpans = (spans: ReadonlyArray<Span>): ReactNode =>
	spans.map((span, i) => {
		// biome-ignore lint/suspicious/noArrayIndexKey: static span list, no reorder
		if (span.kind === 'break') return <br key={i} />
		if (span.kind === 'link') {
			const style: CSSProperties = { ...brandTheme.link }
			if (span.bold) style.fontWeight = brandTheme.fontWeight.bold
			if (span.italic) style.fontStyle = 'italic'
			return (
				// biome-ignore lint/suspicious/noArrayIndexKey: static span list, no reorder
				<Link key={i} href={span.href} style={style}>
					{span.text}
				</Link>
			)
		}
		const style: CSSProperties = {}
		if (span.bold) style.fontWeight = brandTheme.fontWeight.bold
		if (span.italic) style.fontStyle = 'italic'
		if (span.strike) style.textDecoration = 'line-through'
		if (span.code) {
			style.fontFamily =
				"'SFMono-Regular', Menlo, Monaco, Consolas, 'Liberation Mono', monospace"
			style.backgroundColor = '#F0EBE1'
			style.padding = '1px 4px'
			style.borderRadius = '2px'
		}
		return (
			// biome-ignore lint/suspicious/noArrayIndexKey: static span list, no reorder
			<span key={i} style={style}>
				{span.value}
			</span>
		)
	})

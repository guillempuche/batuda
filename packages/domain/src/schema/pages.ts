import { Schema } from 'effect'
import { Model } from 'effect/unstable/schema'

export const PageId = Schema.String.pipe(Schema.brand('PageId'))

export class Page extends Model.Class<Page>('Page')({
	id: Model.Generated(PageId),
	companyId: Schema.NullOr(Schema.String),
	// nullable — for generic pages not tied to a prospect

	slug: Schema.String,
	lang: Schema.String,
	// values: ca | es | en

	title: Schema.String,
	status: Schema.String,
	// values: draft | published | archived
	template: Schema.NullOr(Schema.String),
	// values: product-pitch | case-study | intro | landing | custom

	content: Schema.Unknown,
	// Tiptap JSON document with custom block nodes (hero, cta, value-props, etc.)
	meta: Schema.NullOr(Schema.Unknown),
	// SEO: { og_title, og_description, og_image }

	publishedAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
	expiresAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
	viewCount: Schema.Number,

	createdAt: Model.DateTimeInsertFromDate,
	updatedAt: Model.DateTimeUpdateFromDate,
}) {}

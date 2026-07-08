import { describe, expect, it } from 'vitest'

import { cleanScrapedMarkdown } from './clean-scraped-markdown'

describe('cleanScrapedMarkdown', () => {
	describe('when the markdown is page-builder scaffolding around real text', () => {
		it('should strip the shortcodes and keep the readable prose', () => {
			// GIVEN a Fusion/Avada page whose body text is wrapped in builder shortcodes
			const raw = [
				'[fusion_builder_container type="flex" hundred_percent="no"]',
				'[fusion_builder_row][fusion_builder_column type="1_1"][fusion_text]',
				'',
				'Green Worldwide Shipping is a licensed freight forwarder headquartered in Atlanta, Georgia, offering air freight, ocean freight, and customs brokerage across the United States.',
				'',
				'[/fusion_text][/fusion_builder_column][/fusion_builder_row][/fusion_builder_container]',
			].join('\n')

			// WHEN it is cleaned
			const cleaned = cleanScrapedMarkdown(raw)

			// THEN the prose survives and every shortcode is gone
			expect(cleaned).toContain(
				'Green Worldwide Shipping is a licensed freight forwarder',
			)
			expect(cleaned).not.toContain('[fusion')
			expect(cleaned).not.toContain('fusion_builder')
		})

		it('should strip Divi and WPBakery shortcodes too', () => {
			// GIVEN a page mixing Divi (et_pb) and WPBakery (vc) shortcodes
			const raw =
				'[et_pb_section][et_pb_row][et_pb_column type="4_4"][et_pb_text]Divi body copy about logistics services and freight solutions for many clients.[/et_pb_text][/et_pb_column][/et_pb_row][/et_pb_section] [vc_row][vc_column]More content about ocean and air shipping options.[/vc_column][/vc_row]'

			// WHEN it is cleaned
			const cleaned = cleanScrapedMarkdown(raw)

			// THEN both builders' tags are gone and their text remains
			expect(cleaned).toContain('Divi body copy about logistics services')
			expect(cleaned).toContain('More content about ocean and air shipping')
			expect(cleaned).not.toContain('[et_pb')
			expect(cleaned).not.toContain('[vc_')
		})

		it('should keep a page whose only readable content is the company name', () => {
			// GIVEN a builder page stripped down to just the company name
			// WHEN it is cleaned
			// THEN the name survives — shortness alone never marks a clean page
			//   low-signal, and that name is exactly the grounding cue
			expect(
				cleanScrapedMarkdown('[fusion_text]Acme Logistics[/fusion_text]'),
			).toBe('Acme Logistics')
		})
	})

	describe('when the markdown is nothing but scaffolding', () => {
		it('should return empty so the source is skipped', () => {
			// GIVEN a builder skeleton carrying no readable text
			const raw = [
				'[fusion_builder_container][fusion_builder_row]',
				'[fusion_builder_column type="1_1"]',
				'[fusion_separator style_type="none" sep_color="#ffffff"][/fusion_separator]',
				'[/fusion_builder_column][/fusion_builder_row][/fusion_builder_container]',
			].join('\n')

			// WHEN it is cleaned
			// THEN nothing readable is left, so it is treated as empty
			expect(cleanScrapedMarkdown(raw)).toBe('')
		})
	})

	describe('when the markdown is a long page of almost no readable text', () => {
		it('should return empty as low-signal even without a known builder', () => {
			// GIVEN a long page dominated by symbols (an unrecognized builder's soup)
			const raw = '<> == || ++ ** ## $$ %% [1] [2] {3} (4) :: ;; '.repeat(12)

			// WHEN it is cleaned
			// THEN its letter content is too thin to extract, so it is skipped
			expect(cleanScrapedMarkdown(raw)).toBe('')
		})
	})

	describe('when the markdown is ordinary content', () => {
		it('should preserve markdown links, images, and references', () => {
			// GIVEN clean markdown with a link, a mailto, an image, and a reference
			const raw = [
				'# Acme Logistics',
				'',
				'We move freight worldwide. Read our [shipping guide](https://acme.example/guide) or contact [sales](mailto:sales@acme.example).',
				'',
				'![Acme logo](https://acme.example/logo.png)',
				'',
				'See footnote [1].',
			].join('\n')

			// WHEN it is cleaned
			const cleaned = cleanScrapedMarkdown(raw)

			// THEN every markdown construct is left untouched
			expect(cleaned).toContain('[shipping guide](https://acme.example/guide)')
			expect(cleaned).toContain('[sales](mailto:sales@acme.example)')
			expect(cleaned).toContain('![Acme logo](https://acme.example/logo.png)')
			expect(cleaned).toContain('[1]')
		})

		it('should keep a bare reference whose label matches a builder prefix', () => {
			// GIVEN references labelled exactly like short builder prefixes (cs, av)
			const raw = 'Details in [cs]: https://example.com/spec and note [av].'

			// WHEN it is cleaned
			// THEN they survive — only real `prefix_word` shortcodes are stripped
			const cleaned = cleanScrapedMarkdown(raw)
			expect(cleaned).toContain('[cs]:')
			expect(cleaned).toContain('[av]')
		})

		it('should pass clean prose through unchanged', () => {
			// GIVEN a plain paragraph with no builder markup
			const raw =
				'Acme Logistics S.L. is a freight forwarder based in Barcelona, Spain. It operates road and ocean freight across Europe.'

			// WHEN it is cleaned
			// THEN it comes back byte-for-byte
			expect(cleanScrapedMarkdown(raw)).toBe(raw)
		})

		it('should keep a genuinely short but clean page', () => {
			// GIVEN a short clean page with fewer than the low-signal letter floor
			const raw = 'Bilbao freight office. Call +34 944 000 000.'

			// WHEN it is cleaned
			// THEN it is kept — shortness alone never skips a page without markup
			expect(cleanScrapedMarkdown(raw)).toBe(raw)
		})
	})

	describe('when the markdown is empty or whitespace', () => {
		it('should return empty', () => {
			// GIVEN blank inputs
			// THEN cleaning yields an empty string
			expect(cleanScrapedMarkdown('')).toBe('')
			expect(cleanScrapedMarkdown('   \n\t  ')).toBe('')
		})
	})
})

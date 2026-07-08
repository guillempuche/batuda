import { describe, expect, it } from 'vitest'

import {
	type MatchableGroup,
	navGroupActive,
	navItemMatches,
} from './nav-match'

describe('navItemMatches', () => {
	describe('when the item is exact (the Pipeline root)', () => {
		const root = { path: '/', exact: true }

		it('should match only the root pathname', () => {
			// GIVEN the exact root item
			// WHEN the current pathname is exactly '/'
			// THEN it matches
			expect(navItemMatches('/', root)).toBe(true)
		})

		it('should not match a nested pathname', () => {
			// GIVEN the exact root item
			// WHEN the pathname is any deeper route
			// THEN it does not match (root would otherwise light up everywhere)
			expect(navItemMatches('/companies', root)).toBe(false)
		})
	})

	describe('when the item is not exact', () => {
		const companies = { path: '/companies' }

		it('should match its own pathname', () => {
			// GIVEN a section item
			// WHEN the pathname equals its path
			// THEN it matches
			expect(navItemMatches('/companies', companies)).toBe(true)
		})

		it('should match a nested detail pathname', () => {
			// GIVEN a section item
			// WHEN the pathname is a child route
			// THEN it stays lit on the detail page
			expect(navItemMatches('/companies/acme', companies)).toBe(true)
		})

		it('should not match a sibling that merely shares the path prefix', () => {
			// GIVEN the '/companies' item
			// WHEN the pathname is '/companiesX' (shared prefix, different section)
			// THEN it does not match — only a real segment boundary counts
			expect(navItemMatches('/companiesX', companies)).toBe(false)
		})

		it('should not match an unrelated pathname', () => {
			// GIVEN the '/companies' item
			// WHEN the pathname is a different section
			// THEN it does not match
			expect(navItemMatches('/tasks', companies)).toBe(false)
		})
	})
})

describe('navGroupActive', () => {
	const records: MatchableGroup = {
		items: [{ path: '/companies' }, { path: '/research' }, { path: '/pages' }],
	}
	const pipeline: MatchableGroup = { items: [{ path: '/', exact: true }] }

	describe('when the current route matches one of the group members', () => {
		it('should report the multi-member group as active', () => {
			// GIVEN the Records group
			// WHEN the route is under one member (Research)
			// THEN the belt slot is active
			expect(navGroupActive('/research/abc', records)).toBe(true)
		})

		it('should report a single-member group as active on its route', () => {
			// GIVEN the Pipeline group with an exact root member
			// WHEN the route is exactly '/'
			// THEN it is active
			expect(navGroupActive('/', pipeline)).toBe(true)
		})
	})

	describe('when the current route matches no member', () => {
		it('should report the group as inactive', () => {
			// GIVEN the Records group
			// WHEN the route belongs to another group's section
			// THEN it is inactive
			expect(navGroupActive('/emails', records)).toBe(false)
		})

		it('should keep an exact single-member group inactive off its route', () => {
			// GIVEN the Pipeline group (exact root)
			// WHEN the route is a nested page
			// THEN the root slot does not light up
			expect(navGroupActive('/companies', pipeline)).toBe(false)
		})
	})
})

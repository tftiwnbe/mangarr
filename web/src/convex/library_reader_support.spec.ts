import { describe, expect, it } from 'vitest';

import type { Id } from './_generated/dataModel';
import { buildTitleRouteSegments, findTitleByAliasRouteSegment } from './library_reader_support';

describe('library title route resolution', () => {
	it('prefers stored routeBase when building canonical route segments', () => {
		const segments = buildTitleRouteSegments([
			{
				_id: 'title_1' as Id<'libraryTitles'>,
				title: 'Питомец злодейки',
				routeBase: 'the-pet-of-the-villainess'
			}
		]);

		expect(segments.get('title_1')).toBe('the-pet-of-the-villainess');
	});

	it('resolves legacy route slugs from linked variant titles', () => {
		const titles = [
			{
				_id: 'title_1' as Id<'libraryTitles'>,
				title: 'Питомец злодейки',
				routeBase: 'pitomets-zlodeyki'
			}
		];
		const variantsByTitleId = new Map<string, readonly string[]>([
			['title_1', ['Питомец злодейки', 'The Pet of the Villainess']]
		]);

		expect(
			findTitleByAliasRouteSegment(titles, 'the-pet-of-the-villainess', variantsByTitleId)?._id
		).toBe('title_1');
	});

	it('requires the collision suffix when multiple titles share the same legacy alias', () => {
		const titles = [
			{
				_id: 'kx7940yec9pg831mjdaw91bpys8474sm' as Id<'libraryTitles'>,
				title: 'Питомец злодейки',
				routeBase: 'pitomets-zlodeyki'
			},
			{
				_id: 'other_title_abcdef987654' as Id<'libraryTitles'>,
				title: 'Different title',
				routeBase: 'different-title'
			}
		];
		const variantsByTitleId = new Map<string, readonly string[]>([
			['kx7940yec9pg831mjdaw91bpys8474sm', ['The Pet of the Villainess']],
			['other_title_abcdef987654', ['The Pet of the Villainess']]
		]);

		expect(
			findTitleByAliasRouteSegment(titles, 'the-pet-of-the-villainess', variantsByTitleId)
		).toBeNull();
		expect(
			findTitleByAliasRouteSegment(titles, 'the-pet-of-the-villainess~8474sm', variantsByTitleId)
				?._id
		).toBe('kx7940yec9pg831mjdaw91bpys8474sm');
	});
});

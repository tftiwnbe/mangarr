import { tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import Harness from './use-paginated-query.test-harness.svelte';

describe('usePaginatedQuery', () => {
	it('subscribes, exposes page updates, loads more, and unsubscribes', async () => {
		let publish: ((result: unknown) => void) | undefined;
		let reject: ((error: Error) => void) | undefined;
		const unsubscribe = vi.fn();
		const loadMore = vi.fn(() => true);
		const client = {
			onPaginatedUpdate_experimental: vi.fn(
				(
					_query: unknown,
					_args: unknown,
					_options: unknown,
					onUpdate: (result: unknown) => void,
					onError: (error: Error) => void
				) => {
					publish = onUpdate;
					reject = onError;
					return unsubscribe;
				}
			)
		};

		const view = render(Harness, { client });
		await vi.waitFor(() => expect(client.onPaginatedUpdate_experimental).toHaveBeenCalledOnce());
		expect(client.onPaginatedUpdate_experimental).toHaveBeenCalledWith(
			expect.anything(),
			{},
			{ initialNumItems: 24 },
			expect.any(Function),
			expect.any(Function)
		);

		publish?.({ results: [{ id: 'one' }, { id: 'two' }], status: 'CanLoadMore', loadMore });
		await tick();
		expect(view.container.querySelector('[data-testid="status"]')?.textContent).toBe('CanLoadMore');
		expect(view.container.querySelector('[data-testid="count"]')?.textContent).toBe('2');

		view.container.querySelector('button')?.click();
		expect(loadMore).toHaveBeenCalledWith(12);

		reject?.(new Error('subscription failed'));
		await tick();
		expect(view.container.querySelector('[data-testid="error"]')?.textContent).toBe(
			'subscription failed'
		);

		view.unmount();
		expect(unsubscribe).toHaveBeenCalledOnce();
	});
});

import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

const { goto } = vi.hoisted(() => ({
	goto: vi.fn()
}));

vi.mock('$app/navigation', () => ({
	goto
}));

import Page from './+page.svelte';

describe('/+page.svelte', () => {
	it('redirects to the library while showing a loading spinner', async () => {
		const { container } = render(Page);

		expect(container.querySelector('.animate-spin')).not.toBeNull();
		expect(goto).toHaveBeenCalledWith('/library', { replaceState: true });
	});
});

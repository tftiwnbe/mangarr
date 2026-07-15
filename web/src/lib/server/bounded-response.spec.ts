import { describe, expect, it } from 'vitest';

import { readResponseBodyWithinLimit } from './bounded-response';

describe('readResponseBodyWithinLimit', () => {
	it('reads a response up to the byte limit', async () => {
		const result = await readResponseBodyWithinLimit(new Response('icon'), 4);

		expect(new TextDecoder().decode(result ?? undefined)).toBe('icon');
	});

	it('rejects an oversized declared content length', async () => {
		const response = new Response('large', {
			headers: { 'content-length': '5000' }
		});

		await expect(readResponseBodyWithinLimit(response, 10)).resolves.toBeNull();
	});

	it('rejects an oversized chunked response without a content length', async () => {
		const response = new Response(
			new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(new Uint8Array(6));
					controller.enqueue(new Uint8Array(6));
					controller.close();
				}
			})
		);

		await expect(readResponseBodyWithinLimit(response, 10)).resolves.toBeNull();
	});

	it('rejects invalid byte limits', async () => {
		await expect(readResponseBodyWithinLimit(new Response('icon'), -1)).rejects.toThrow(RangeError);
	});
});

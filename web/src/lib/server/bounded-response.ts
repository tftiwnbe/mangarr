export async function readResponseBodyWithinLimit(
	response: Response,
	maxBytes: number
): Promise<Uint8Array | null> {
	if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
		throw new RangeError('maxBytes must be a non-negative safe integer');
	}

	const declaredLength = response.headers.get('content-length');
	if (declaredLength) {
		const parsedLength = Number(declaredLength);
		if (Number.isFinite(parsedLength) && parsedLength > maxBytes) {
			await response.body?.cancel();
			return null;
		}
	}

	if (!response.body) {
		return new Uint8Array();
	}

	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let totalBytes = 0;

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) {
				break;
			}

			totalBytes += value.byteLength;
			if (totalBytes > maxBytes) {
				await reader.cancel();
				return null;
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}

	const body = new Uint8Array(totalBytes);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return body;
}

export function directSourceTitleUrlCandidates(input: string): string[] {
	const trimmed = input.trim();
	if (!trimmed) {
		return [];
	}

	const candidates: string[] = [];
	const add = (value: string | null | undefined) => {
		const normalized = normalizeCandidate(value);
		if (normalized && !candidates.includes(normalized)) {
			candidates.push(normalized);
		}
	};

	if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
		try {
			const parsed = new URL(trimmed);
			add(`${parsed.pathname}${parsed.search}${parsed.hash}`);
			return candidates;
		} catch {
			return [];
		}
	}

	if (trimmed.startsWith('/')) {
		add(trimmed);
		return candidates;
	}

	if (trimmed.includes('/') && !trimmed.includes('://')) {
		add(trimmed);
		return candidates;
	}

	return [];
}

export function looksLikeDirectSourceTitleInput(input: string): boolean {
	return directSourceTitleUrlCandidates(input).length > 0;
}

function normalizeCandidate(value: string | null | undefined): string | null {
	const trimmed = value?.trim();
	if (!trimmed) {
		return null;
	}
	return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

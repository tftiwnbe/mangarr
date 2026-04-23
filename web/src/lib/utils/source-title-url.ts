type SourceUrlContext = {
	name?: string | null;
	extensionName?: string | null;
	extensionPkg?: string | null;
};

const SLUG_RE = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/i;

export function directSourceTitleUrlCandidates(
	input: string,
	source?: SourceUrlContext | null
): string[] {
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
			add(sourceSpecificTitleUrl(lastPathSegment(parsed.pathname), source));
			return candidates;
		} catch {
			return [];
		}
	}

	if (trimmed.startsWith('/')) {
		add(trimmed);
		add(sourceSpecificTitleUrl(lastPathSegment(trimmed), source));
		return candidates;
	}

	if (SLUG_RE.test(trimmed)) {
		add(sourceSpecificTitleUrl(trimmed, source));
		add(`/${trimmed}`);
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

function lastPathSegment(value: string): string | null {
	const path = value.split(/[?#]/)[0] ?? '';
	return path
		.split('/')
		.map((segment) => segment.trim())
		.filter(Boolean)
		.at(-1) ?? null;
}

function sourceSpecificTitleUrl(
	slug: string | null | undefined,
	source?: SourceUrlContext | null
): string | null {
	const normalizedSlug = slug?.trim().replace(/^\/+|\/+$/g, '');
	if (!normalizedSlug || !SLUG_RE.test(normalizedSlug)) {
		return null;
	}

	const sourceKey = [
		source?.name,
		source?.extensionName,
		source?.extensionPkg
	]
		.filter(Boolean)
		.join(' ')
		.toLowerCase();

	if (sourceKey.includes('inkstory')) {
		return `/content/${normalizedSlug}`;
	}

	return `/${normalizedSlug}`;
}

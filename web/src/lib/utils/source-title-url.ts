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

const NON_TITLE_PATH_SEGMENTS = new Set([
	'book',
	'comic',
	'content',
	'detail',
	'details',
	'manga',
	'series',
	'title',
	'titles',
	'work'
]);

export function sourceTitleUrlSearchQueries(input: string | null | undefined): string[] {
	const raw = input?.trim();
	if (!raw) {
		return [];
	}

	const path = extractSourcePath(raw);
	const segments = path
		.split('/')
		.map((part) => safeDecode(part).trim())
		.filter(Boolean);
	const candidates = new Set<string>();

	for (const segment of segments) {
		if (NON_TITLE_PATH_SEGMENTS.has(segment.toLowerCase())) continue;
		const slug = slugFromPathSegment(segment);
		if (!slug) continue;
		candidates.add(slug);
		const words = slug.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
		if (words && words !== slug) {
			candidates.add(words);
		}
	}

	return [...candidates].filter((candidate) => candidate.length >= 4).slice(0, 4);
}

function normalizeCandidate(value: string | null | undefined): string | null {
	const trimmed = value?.trim();
	if (!trimmed) {
		return null;
	}
	return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function extractSourcePath(input: string): string {
	try {
		const parsed = new URL(input);
		return `${parsed.pathname}${parsed.search}${parsed.hash}`;
	} catch {
		return input;
	}
}

function safeDecode(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

function slugFromPathSegment(segment: string): string | null {
	const withoutHash = segment.split('#', 1)[0] ?? segment;
	const withoutQuery = withoutHash.split('?', 1)[0] ?? withoutHash;
	const cleaned = withoutQuery
		.replace(/^\d{2,}--+/, '')
		.replace(/--+\d{2,}$/, '')
		.replace(/^[a-f0-9]{8}-[a-f0-9-]{27,}$/i, '')
		.trim()
		.replace(/^[-_]+|[-_]+$/g, '');

	if (!cleaned || /^\d+$/.test(cleaned)) {
		return null;
	}
	if (/^[a-f0-9]{12,}$/i.test(cleaned)) {
		return null;
	}

	return cleaned;
}

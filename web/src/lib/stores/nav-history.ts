import { goto } from '$app/navigation';

const STORAGE_KEY = 'mangarr:nav-history';
const MAX_SIZE = 30;

// Set to true before calling goto() for a back navigation so the layout's
// afterNavigate hook knows not to push the "from" URL back onto the stack.
let _skipNext = false;

function load(): string[] {
	if (typeof window === 'undefined') return [];
	try {
		const raw = sessionStorage.getItem(STORAGE_KEY);
		return raw ? (JSON.parse(raw) as string[]) : [];
	} catch {
		return [];
	}
}

function save(stack: string[]): void {
	if (typeof window === 'undefined') return;
	try {
		sessionStorage.setItem(STORAGE_KEY, JSON.stringify(stack));
	} catch {
		// ignore — sessionStorage unavailable
	}
}

function matchesSkippedPrefix(url: string, skipPrefixes: string[]): boolean {
	return skipPrefixes.some((prefix) => url.startsWith(prefix));
}

function discardCurrentUrl(stack: string[], currentUrl: string): string[] {
	let next = stack;
	while (next.length > 0 && next[next.length - 1] === currentUrl) {
		next = next.slice(0, -1);
	}
	return next;
}

/** Push the current page URL before navigating away (called from afterNavigate). */
export function pushNavHistory(url: string): void {
	if (_skipNext) {
		_skipNext = false;
		return;
	}
	const stack = load();
	if (stack[stack.length - 1] === url) return;
	save([...stack, url].slice(-MAX_SIZE));
}

/** Return the previous URL without removing it. */
export function peekNavHistory(skipPrefixes: string[] = []): string | null {
	const currentUrl =
		typeof window === 'undefined' ? '' : window.location.pathname + window.location.search;
	const stack = discardCurrentUrl(load(), currentUrl);
	for (let index = stack.length - 1; index >= 0; index -= 1) {
		const candidate = stack[index];
		if (!matchesSkippedPrefix(candidate, skipPrefixes)) {
			return candidate;
		}
	}
	return null;
}

/**
 * Navigate to the previous page in our history stack, or to `fallback` if
 * the stack is empty.
 *
 * Stale entries that match the current URL are silently discarded — this
 * happens when the user navigates with the browser's native back button,
 * which bypasses our stack.
 */
export async function navigateBack(
	fallback = '/library',
	options?: { skipPrefixes?: string[] }
): Promise<void> {
	const currentUrl = window.location.pathname + window.location.search;
	const skipPrefixes = options?.skipPrefixes ?? [];
	let stack = discardCurrentUrl(load(), currentUrl);
	while (
		stack.length > 0 &&
		matchesSkippedPrefix(stack[stack.length - 1] ?? '', skipPrefixes)
	) {
		stack = stack.slice(0, -1);
	}

	if (stack.length === 0) {
		save([]);
		await goto(fallback);
		return;
	}

	const prev = stack[stack.length - 1];
	save(stack.slice(0, -1));
	_skipNext = true;
	await goto(prev);
}

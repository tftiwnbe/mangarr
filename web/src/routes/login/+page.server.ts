import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (locals.auth.user) {
		throw redirect(303, getSafeRedirect(url.searchParams.get('redirect')));
	}

	if (locals.auth.setupOpen) {
		throw redirect(303, '/setup');
	}
};

function getSafeRedirect(candidate: string | null) {
	if (candidate && candidate.startsWith('/') && !candidate.startsWith('//')) {
		return candidate;
	}

	return '/library';
}

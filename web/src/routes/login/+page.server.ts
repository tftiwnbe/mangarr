import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.auth.user) {
		return {};
	}

	const candidate = url.searchParams.get('redirect') ?? '/library';
	const target = candidate.startsWith('/') && !candidate.startsWith('//') ? candidate : '/library';
	throw redirect(302, target);
};

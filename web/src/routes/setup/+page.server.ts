import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.auth.setupOpen) {
		throw redirect(303, locals.auth.user ? '/library' : '/login');
	}
};

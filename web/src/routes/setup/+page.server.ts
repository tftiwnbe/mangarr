import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.auth.user) {
		throw redirect(303, '/login');
	}

	if (!locals.auth.setupOpen) {
		throw redirect(303, '/library');
	}
};

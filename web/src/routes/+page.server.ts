import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (locals.auth.user) {
		throw redirect(303, '/library');
	}

	throw redirect(303, locals.auth.setupOpen ? '/setup' : '/login');
};

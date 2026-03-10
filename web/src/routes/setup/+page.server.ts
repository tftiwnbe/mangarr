import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

import { registerFirstUser } from '$lib/server/auth';

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.auth.setupOpen) {
    throw redirect(303, locals.auth.user ? '/' : '/login');
  }

  if (locals.auth.user) {
    throw redirect(303, '/');
  }
};

export const actions: Actions = {
	default: async (event) => {
		const formData = await event.request.formData();
		const result = await registerFirstUser(event, formData);
		if (!result.ok) {
			return fail(400, {
				error: result.message,
				field: result.field,
				values: {
					username: String(formData.get('username') ?? '')
				}
			});
		}

    throw redirect(303, '/');
  }
};

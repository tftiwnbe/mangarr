import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

import { login } from '$lib/server/auth';

export const load: PageServerLoad = async ({ locals }) => {
  if (locals.auth.user) {
    throw redirect(303, '/');
  }

  if (locals.auth.setupOpen) {
    throw redirect(303, '/setup');
  }
};

export const actions: Actions = {
	default: async (event) => {
		const formData = await event.request.formData();
		const result = await login(event, formData);
		if (!result.ok) {
      return fail(result.message.includes('Too many failed') ? 429 : 400, {
        error: result.message,
        field: result.field,
        values: {
          username: String(formData.get('username') ?? ''),
          rememberMe: formData.get('rememberMe') === 'on'
        }
      });
    }

    throw redirect(303, '/');
  }
};

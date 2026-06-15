import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

import { env as privateEnv } from '$env/dynamic/private';

export const GET: RequestHandler = async () => {
	const publicKey = (privateEnv.MANGARR_WEB_PUSH_VAPID_PUBLIC_KEY || '').trim();
	const privateKey = (privateEnv.MANGARR_WEB_PUSH_VAPID_PRIVATE_KEY || '').trim();
	const subject = (privateEnv.MANGARR_WEB_PUSH_SUBJECT || '').trim();

	return json({
		backgroundPushConfigured: Boolean(publicKey && privateKey && subject),
		vapidPublicKey: publicKey || null,
		subject: subject || null
	});
};

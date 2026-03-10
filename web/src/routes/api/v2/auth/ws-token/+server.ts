import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async () => {
	throw error(501, 'Worker event stream is not wired yet');
};

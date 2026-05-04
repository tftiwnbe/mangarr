import { expect, test } from '@playwright/test';

import { assertAuthenticatedSession, authenticateCleanStack } from './helpers';

test('clean stack can create or reuse the first admin and establish a session', async ({
	page
}) => {
	await authenticateCleanStack(page, '/library');
	await expect(page).toHaveURL(/\/(library|setup)$/);
	await assertAuthenticatedSession(page);
});

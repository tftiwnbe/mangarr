import { defineConfig } from '@playwright/test';

const useWebServer = process.env.PW_USE_WEBSERVER === '1';
const previewBaseUrl = 'http://127.0.0.1:4173';
const baseURL =
	process.env.PLAYWRIGHT_BASE_URL ?? (useWebServer ? previewBaseUrl : 'http://127.0.0.1:3737');

export default defineConfig({
	testDir: 'e2e',
	workers: 1,
	use: {
		baseURL,
		trace: 'retain-on-failure'
	},
	webServer: useWebServer
		? {
				command: 'npm run build && npm run preview',
				port: 4173,
				reuseExistingServer: true
			}
		: undefined
});

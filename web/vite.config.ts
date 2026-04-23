import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';

function packageChunkName(id: string): string {
	const lastNodeModules = id.lastIndexOf('/node_modules/');
	if (lastNodeModules === -1) {
		return 'vendor';
	}
	const packagePath = id.slice(lastNodeModules + '/node_modules/'.length);
	const parts = packagePath.split('/');
	const packageName = parts[0]?.startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
	if (!packageName) {
		return 'vendor';
	}
	return `vendor-${packageName.replace(/^@/, '').replace(/[^a-zA-Z0-9_-]+/g, '-')}`;
}

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	server: {
		proxy: {
			'/convex': {
				target: process.env.CONVEX_URL || 'http://127.0.0.1:3210',
				changeOrigin: true,
				rewrite: (path) => path.replace(/^\/convex/, ''),
				ws: true
			}
		}
	},
	build: {
		rollupOptions: {
			output: {
				manualChunks(id) {
					if (!id.includes('node_modules')) {
						return;
					}
					if (id.includes('/svelte/') || id.includes('/@sveltejs/kit/')) {
						return 'framework';
					}
					if (id.includes('/svelte-i18n/')) {
						return 'i18n';
					}
					if (id.includes('/convex/') || id.includes('/convex-svelte/')) {
						return 'convex';
					}
					if (
						id.includes('/bits-ui/') ||
						id.includes('/runed/') ||
						id.includes('/svelte-toolbelt/')
					) {
						return 'ui-kit';
					}
					if (id.includes('/phosphor-svelte/')) {
						return 'icons';
					}
					if (id.includes('/jose/')) {
						return 'security';
					}
					return packageChunkName(id);
				}
			}
		}
	},
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'client',
					browser: {
						enabled: true,
						provider: playwright(),
						instances: [{ browser: 'chromium', headless: true }]
					},
					include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
					exclude: ['src/lib/server/**']
				}
			},

			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});

import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(root, '../server/app/static');

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),

	kit: {
		paths: { relative: false },
		adapter: adapter({
			pages: outDir,
			assets: outDir,
			fallback: 'index.html',
			precompress: true
		}),
		prerender: {
			entries: ['*'],
			handleHttpError: 'warn'
		}
	}
};

export default config;

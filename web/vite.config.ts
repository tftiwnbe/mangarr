import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { defineConfig, type ProxyOptions, type UserConfig } from 'vite';

const upstream = {
	target: process.env.WEB_FASTAPI_BACKEND ?? 'http://localhost:3737/',
	changeOrigin: true,
	secure: false,
	ws: true
} satisfies ProxyOptions;

const proxy: Record<string, string | ProxyOptions> = {
	'/api': upstream,
	'/custom.css': upstream,
	'/socket.io': { ...upstream, ws: true }
};

export default defineConfig({
	build: { target: 'es2022' },
	resolve: {
		alias: { '@': path.resolve(__dirname, './src') }
	},
	server: { proxy, allowedHosts: true },
	preview: { proxy },
	plugins: [tailwindcss(), sveltekit()],
	optimizeDeps: {
		entries: ['src/**/*.{svelte,ts,html}']
	}
} as UserConfig);

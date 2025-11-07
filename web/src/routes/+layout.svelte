<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { resolve } from '$app/paths';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<header class="bg-slate-900 px-6 py-4 text-white">
	<nav class="flex gap-4">
		<a class="hover:underline" href={resolve('/')}>Home</a>
		<a class="hover:underline" href={resolve('/about')}>About</a>
	</nav>
</header>

<main class="px-6 py-8">
	{@render children()}
</main>

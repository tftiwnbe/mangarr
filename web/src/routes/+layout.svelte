<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';
	import { setupConvexClient } from '$lib/convex/client';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();

	setupConvexClient();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<div class="shell">
	<header class="topbar">
		<a class="brand" href="/">Mangarr</a>

		<nav>
			{#if data.auth.user}
				<span class="identity">
					{data.auth.user.username}
					{#if data.auth.user.isAdmin}
						<em>admin</em>
					{/if}
				</span>
				<form method="POST" action="/logout">
					<button type="submit">Logout</button>
				</form>
			{:else if data.auth.setupOpen}
				<a href="/setup">Setup</a>
			{:else}
				<a href="/login">Login</a>
			{/if}
		</nav>
	</header>

	<main>
		{@render children()}
	</main>
</div>

<style>
	.shell {
		min-height: 100vh;
	}

	.topbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 1rem 1.5rem 0;
	}

	.brand {
		color: inherit;
		font-size: 1rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-decoration: none;
		text-transform: uppercase;
	}

	nav {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	nav a,
	nav button,
	.identity {
		padding: 0.6rem 0.9rem;
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.04);
		color: inherit;
		font: inherit;
		text-decoration: none;
	}

	nav button {
		cursor: pointer;
	}

	.identity {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
	}

	.identity em {
		font-size: 0.72rem;
		font-style: normal;
		letter-spacing: 0.12em;
		opacity: 0.72;
		text-transform: uppercase;
	}

	main {
		min-height: calc(100vh - 4.5rem);
	}

	@media (max-width: 640px) {
		.topbar {
			flex-direction: column;
			align-items: stretch;
		}

		nav {
			flex-wrap: wrap;
		}
	}
</style>

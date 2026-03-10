<script lang="ts">
	import { getConvexUrl } from '$lib/convex/client';

	const convexConfigured = Boolean(getConvexUrl());
</script>

<svelte:head>
	<title>Mangarr v2</title>
</svelte:head>

<script module lang="ts">
	const runtimeCards = [
		{
			title: 'Web',
			description: 'Fresh SvelteKit shell for the v2 app and browser auth entrypoints.'
		},
		{
			title: 'Convex',
			description: 'Durable app state under src/convex with a minimal schema and bootstrap query.'
		},
		{
			title: 'Worker',
			description: 'Fastify service foundation for bridge supervision and binary proxy routes.'
		}
	];
</script>

<div class="page">
	<section class="hero">
		<p class="eyebrow">v2.0.0-alpha foundation</p>
		<h1>Mangarr is now running on a clean SvelteKit shell.</h1>
		<p class="lede">
			This branch starts from the new architecture: `web/` for the app, `src/convex/` for
			durable state, and `worker/` for host-side effects.
		</p>
	</section>

	<section class="status">
		<div class:ready={convexConfigured} class="status-card">
			<span>Convex URL</span>
			<strong>{convexConfigured ? 'Configured' : 'Not configured yet'}</strong>
		</div>
		<div class="status-card">
			<span>Archive reference</span>
			<strong>`web-ref/` kept local-only in this branch</strong>
		</div>
	</section>

	<section class="grid" aria-label="Runtime components">
		{#each runtimeCards as card}
			<article class="card">
				<h2>{card.title}</h2>
				<p>{card.description}</p>
			</article>
		{/each}
	</section>
</div>

<style>
	:global(body) {
		margin: 0;
		background:
			radial-gradient(circle at top, rgba(219, 168, 63, 0.18), transparent 30%),
			linear-gradient(180deg, #0f1720 0%, #0b1118 100%);
		color: #f2eadf;
		font-family:
			'Iowan Old Style', 'Palatino Linotype', 'Book Antiqua', Palatino, Georgia, serif;
	}

	.page {
		min-height: 100vh;
		padding: 4rem 1.5rem 3rem;
	}

	.hero,
	.status,
	.grid {
		margin: 0 auto;
		max-width: 70rem;
	}

	.hero {
		margin-bottom: 2rem;
	}

	.eyebrow {
		margin: 0 0 0.75rem;
		color: #e4b85f;
		font-size: 0.8rem;
		letter-spacing: 0.18em;
		text-transform: uppercase;
	}

	h1 {
		margin: 0;
		max-width: 12ch;
		font-size: clamp(3rem, 8vw, 6rem);
		line-height: 0.95;
	}

	.lede {
		margin: 1.25rem 0 0;
		max-width: 40rem;
		color: rgba(242, 234, 223, 0.78);
		font-size: 1.05rem;
		line-height: 1.7;
	}

	.status {
		display: grid;
		gap: 1rem;
		margin-bottom: 2rem;
	}

	.status-card,
	.card {
		border: 1px solid rgba(242, 234, 223, 0.12);
		border-radius: 1.5rem;
		background: rgba(14, 20, 27, 0.82);
		box-shadow: 0 1.5rem 3rem rgba(0, 0, 0, 0.2);
	}

	.status-card {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		padding: 1rem 1.25rem;
	}

	.status-card span {
		color: rgba(242, 234, 223, 0.65);
	}

	.status-card strong {
		font-size: 0.95rem;
		text-align: right;
	}

	.status-card.ready {
		border-color: rgba(89, 204, 156, 0.45);
	}

	.grid {
		display: grid;
		gap: 1rem;
		grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
	}

	.card {
		padding: 1.5rem;
	}

	.card h2 {
		margin: 0 0 0.75rem;
		font-size: 1.35rem;
	}

	.card p {
		margin: 0;
		color: rgba(242, 234, 223, 0.72);
		line-height: 1.6;
	}

	@media (max-width: 640px) {
		.page {
			padding-top: 3rem;
		}

		.status-card {
			flex-direction: column;
		}

		.status-card strong {
			text-align: left;
		}
	}
</style>

<script lang="ts">
	import { _ } from '$lib/i18n';
</script>

<svelte:head>
	<title>{$_('nav.downloads')} | {$_('app.name')}</title>
</svelte:head>

<div class="border border-[var(--line)] bg-[var(--surface)] p-6">
	<h1 class="text-display text-xl text-[var(--text)]">{$_('nav.downloads').toLowerCase()}</h1>
	<p class="mt-3 text-sm text-[var(--text-ghost)]">
		Downloads are not wired to the bridge runtime yet. Queue execution, file artifacts, and
		reconcile flows will return as that backend coverage is implemented.
	</p>
</div>

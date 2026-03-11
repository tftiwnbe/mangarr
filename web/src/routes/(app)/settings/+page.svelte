<script lang="ts">
	import { _ } from '$lib/i18n';
</script>

<svelte:head>
	<title>{$_('nav.settings')} | {$_('app.name')}</title>
</svelte:head>

<div class="border border-[var(--line)] bg-[var(--surface)] p-6">
	<h1 class="text-display text-xl text-[var(--text)]">{$_('nav.settings').toLowerCase()}</h1>
	<p class="mt-3 text-sm text-[var(--text-ghost)]">
		Settings is still being wired to the new bridge-backed runtime. Auth and extension setup are
		available now; the remaining controls will come back as each backend flow is reconnected.
	</p>
</div>

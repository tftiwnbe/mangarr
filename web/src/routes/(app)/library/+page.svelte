<script lang="ts">
	import { useQuery } from 'convex-svelte';

	import { convexApi } from '$lib/convex/api';
	import { _ } from '$lib/i18n';

	const library = useQuery(convexApi.library.listMine, () => ({}));
	const commands = useQuery(convexApi.commands.listMine, () => ({ limit: 20 }));
	type CommandItem = {
		id: string;
		commandType: string;
		status: string;
	};

	const recentImports = $derived.by(
		() =>
			((commands.data ?? []) as CommandItem[]).filter(
				(item) => item.commandType === 'library.import' && item.status === 'succeeded'
			)
	);
</script>

<svelte:head>
	<title>{$_('nav.library')} | {$_('app.name')}</title>
</svelte:head>

<div class="flex flex-col gap-6">
	<div class="flex items-center gap-3">
		<h1 class="text-display flex-1 text-xl text-[var(--text)]">{$_('nav.library').toLowerCase()}</h1>
	</div>

	<div class="border border-[var(--line)] bg-[var(--surface)] p-4">
		<h2 class="mb-3 text-sm tracking-wider text-[var(--text)] uppercase">Your Titles</h2>
		{#if library.isLoading}
			<p class="text-sm text-[var(--text-ghost)]">Loading library…</p>
		{:else if (library.data?.length ?? 0) === 0}
			<p class="text-sm text-[var(--text-ghost)]">
				No titles imported yet. Install extensions, search in Explore, then import a title.
			</p>
		{:else}
			<div class="flex flex-col gap-3">
				{#each library.data ?? [] as title (title._id)}
					<div class="border-b border-[var(--line)] pb-3">
						<p class="text-sm text-[var(--text)]">{title.title}</p>
						<p class="mt-1 text-xs text-[var(--text-ghost)]">
							{title.sourcePkg} · {title.sourceLang} · {new Date(title.updatedAt).toLocaleString()}
						</p>
					</div>
				{/each}
			</div>
		{/if}
	</div>

	<div class="border border-[var(--line)] bg-[var(--surface)] p-4">
		<h2 class="mb-3 text-sm tracking-wider text-[var(--text)] uppercase">Recent Imports</h2>
		{#if commands.isLoading}
			<p class="text-sm text-[var(--text-ghost)]">Loading command history…</p>
		{:else if recentImports.length === 0}
			<p class="text-sm text-[var(--text-ghost)]">No completed imports yet.</p>
		{:else}
			<div class="flex flex-col gap-2">
				{#each recentImports as cmd (cmd.id)}
					<div class="flex items-center justify-between border-b border-[var(--line)] pb-2">
						<span class="text-xs text-[var(--text-muted)]">{cmd.commandType}</span>
						<span class="text-xs text-[var(--text-ghost)]">{cmd.status}</span>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>

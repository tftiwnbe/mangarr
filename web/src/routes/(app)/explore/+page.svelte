<script lang="ts">
	import { useConvexClient, useQuery } from 'convex-svelte';
	import { MagnifyingGlassIcon, SpinnerIcon } from 'phosphor-svelte';

	import { convexApi } from '$lib/convex/api';
	import { Button } from '$lib/elements/button';
	import { Input } from '$lib/elements/input';
	import { _ } from '$lib/i18n';

	type SearchItem = {
		canonicalKey: string;
		title: string;
		description: string;
		lang: string;
		extensionPkg: string;
		coverRef?: string | null;
	};

	const client = useConvexClient();
	const commands = useQuery(convexApi.commands.listMine, () => ({ limit: 50 }));

	let query = $state('');
	let busySearch = $state(false);
	let busyImportKey = $state<string | null>(null);
	let error = $state<string | null>(null);

	const latestSearchResult = $derived.by(() => {
		const list = commands.data ?? [];
		for (const item of list) {
			if (item.commandType !== 'explore.search') continue;
			if (item.status !== 'succeeded') continue;
			const payload = item.result as { items?: SearchItem[] } | null;
			return payload?.items ?? [];
		}
		return [] as SearchItem[];
	});

	async function runSearch(event: SubmitEvent) {
		event.preventDefault();
		const value = query.trim();
		if (!value) return;
		busySearch = true;
		error = null;
		try {
			await client.mutation(convexApi.commands.enqueue, {
				commandType: 'explore.search',
				payload: { query: value, limit: 40 }
			});
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Unable to queue search';
		} finally {
			busySearch = false;
		}
	}

	async function importTitle(canonicalKey: string) {
		busyImportKey = canonicalKey;
		error = null;
		try {
			await client.mutation(convexApi.commands.enqueue, {
				commandType: 'library.import',
				payload: { canonicalKey }
			});
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Unable to queue import';
		} finally {
			busyImportKey = null;
		}
	}
</script>

<svelte:head>
	<title>{$_('nav.explore')} | {$_('app.name')}</title>
</svelte:head>

<div class="flex flex-col gap-6">
	<div class="flex items-center gap-3">
		<h1 class="text-display flex-1 text-xl text-[var(--text)]">{$_('nav.explore').toLowerCase()}</h1>
	</div>

	<form class="flex items-end gap-3" onsubmit={runSearch}>
		<div class="relative flex-1">
			<div class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[var(--text-ghost)]">
				<MagnifyingGlassIcon size={14} />
			</div>
			<Input type="search" label="Search titles" bind:value={query} placeholder="Find manga by title..." class="pl-9" />
		</div>
		<Button type="submit" size="sm" disabled={busySearch || !query.trim()}>
			{#if busySearch}
				<SpinnerIcon size={12} class="animate-spin" />
			{:else}
				Search
			{/if}
		</Button>
	</form>

	{#if error}
		<p class="text-sm text-[var(--error)]">{error}</p>
	{/if}

	<div class="border border-[var(--line)] bg-[var(--surface)] p-4">
		<h2 class="mb-3 text-sm tracking-wider text-[var(--text)] uppercase">Search Results</h2>
		{#if commands.isLoading}
			<p class="text-sm text-[var(--text-ghost)]">Loading commands…</p>
		{:else if latestSearchResult.length === 0}
			<p class="text-sm text-[var(--text-ghost)]">
				Run a search after installing extensions to populate explore results.
			</p>
		{:else}
			<div class="flex flex-col gap-3">
				{#each latestSearchResult as item (item.canonicalKey)}
					<div class="flex items-center justify-between gap-3 border-b border-[var(--line)] pb-3">
						<div class="min-w-0 flex-1">
							<p class="line-clamp-1 text-sm text-[var(--text)]">{item.title}</p>
							<p class="mt-1 line-clamp-2 text-xs text-[var(--text-ghost)]">{item.description}</p>
							<p class="mt-1 text-[10px] text-[var(--text-muted)]">{item.extensionPkg} · {item.lang}</p>
						</div>
						<Button
							size="sm"
							onclick={() => importTitle(item.canonicalKey)}
							disabled={busyImportKey === item.canonicalKey}
						>
							{busyImportKey === item.canonicalKey ? 'Queuing…' : 'Import'}
						</Button>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>

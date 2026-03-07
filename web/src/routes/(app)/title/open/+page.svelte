<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';

	import { importLibraryTitle } from '$lib/api/library';
	import { Button } from '$lib/elements/button';
	import { Icon } from '$lib/elements/icon';
	import { _ } from '$lib/i18n';
	import { buildTitlePath } from '$lib/utils/routes';

	let loading = $state(true);
	let error = $state<string | null>(null);
	let sourceId = $state('');
	let titleUrl = $state('');
	let titleName = $state('');
	let thumbnailUrl = $state('');

	async function openTitle(): Promise<void> {
		if (!sourceId || !titleUrl) {
			await goto('/explore', { replaceState: true });
			return;
		}

		loading = true;
		error = null;
		try {
			const imported = await importLibraryTitle({
				source_id: sourceId,
				title_url: titleUrl
			});
			await goto(buildTitlePath(imported.library_title_id, titleName || titleUrl), {
				replaceState: true
			});
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Unable to open title';
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		sourceId = page.url.searchParams.get('source_id')?.trim() ?? '';
		titleUrl = page.url.searchParams.get('title_url')?.trim() ?? '';
		titleName = page.url.searchParams.get('title')?.trim() ?? '';
		thumbnailUrl = page.url.searchParams.get('thumbnail_url')?.trim() ?? '';
		void openTitle();
	});
</script>

<svelte:head>
	<title>{titleName || $_('common.loading')} | {$_('app.name')}</title>
</svelte:head>

<div class="flex flex-col">
	<div class="mb-6 hidden items-center gap-2 md:flex">
		<Button variant="ghost" size="icon-sm" onclick={() => goto('/explore')}>
			<Icon name="chevron-left" size={18} />
		</Button>
		<span class="text-xs text-[var(--text-ghost)]">{$_('nav.explore')}</span>
	</div>

	{#if loading}
		<div class="md:grid md:grid-cols-[260px_1fr] md:gap-8">
			<div class="hidden animate-pulse bg-[var(--void-3)] md:block md:aspect-[2/3]">
				{#if thumbnailUrl}
					<img
						src={thumbnailUrl}
						alt={titleName || 'cover'}
						class="h-full w-full object-cover opacity-35"
					/>
				{/if}
			</div>
			<div class="relative -mt-24 flex flex-col gap-3 md:mt-0">
				<div class="h-7 w-3/4 animate-pulse bg-[var(--void-4)]"></div>
				<div class="h-4 w-1/3 animate-pulse bg-[var(--void-4)]"></div>
				<div class="mt-6 h-3 w-full animate-pulse bg-[var(--void-3)]"></div>
				<div class="h-3 w-5/6 animate-pulse bg-[var(--void-3)]"></div>
				<div class="h-3 w-4/6 animate-pulse bg-[var(--void-3)]"></div>
			</div>
		</div>
	{:else if error}
		<div class="flex flex-col gap-3">
			<p class="text-sm text-[var(--error)]">{error}</p>
			<div class="flex items-center gap-2">
				<Button variant="outline" size="sm" onclick={() => void openTitle()}>
					{$_('common.retry')}
				</Button>
				<Button variant="ghost" size="sm" onclick={() => goto('/explore')}>
					{$_('nav.explore')}
				</Button>
			</div>
		</div>
	{/if}
</div>

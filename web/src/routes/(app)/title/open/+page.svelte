<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { useConvexClient } from 'convex-svelte';

	import type { Id } from '$convex/_generated/dataModel';
	import { convexApi } from '$lib/convex/api';
	import { Button } from '$lib/elements/button';
	import { CaretLeftIcon } from 'phosphor-svelte';
	import { _ } from '$lib/i18n';
	import { buildTitlePath } from '$lib/utils/routes';

	const client = useConvexClient();

	let loading = $state(true);
	let error = $state<string | null>(null);
	let titleName = $state('');
	let thumbnailUrl = $state('');

	async function openTitle(): Promise<void> {
		const sourceId = page.url.searchParams.get('source_id')?.trim() ?? '';
		const sourcePkg = page.url.searchParams.get('source_pkg')?.trim() ?? '';
		const sourceLang = page.url.searchParams.get('source_lang')?.trim() ?? '';
		const titleUrl = page.url.searchParams.get('title_url')?.trim() ?? '';
		const canonicalKey = page.url.searchParams.get('canonical_key')?.trim() ?? '';

		if (!sourceId || !sourcePkg || !sourceLang || !titleUrl || !canonicalKey) {
			await goto('/explore', { replaceState: true });
			return;
		}

		loading = true;
		error = null;
		try {
			const existing = await client.query(convexApi.library.findMineBySource, {
				canonicalKey,
				sourceId,
				titleUrl
			});
			if (existing?._id) {
				await goto(buildTitlePath(String(existing._id), existing.title || titleName || titleUrl), {
					replaceState: true
				});
				return;
			}

			const { commandId } = await client.mutation(convexApi.commands.enqueue, {
				commandType: 'library.import',
				payload: {
					canonicalKey,
					sourceId,
					sourcePkg,
					sourceLang,
					titleUrl
				}
			});

			for (let attempt = 0; attempt < 60; attempt += 1) {
				const imported = await client.query(convexApi.library.findMineBySource, {
					canonicalKey,
					sourceId,
					titleUrl
				});
				if (imported?._id) {
					await goto(buildTitlePath(String(imported._id), imported.title || titleName || titleUrl), {
						replaceState: true
					});
					return;
				}

				const command = await client.query(convexApi.commands.getMineById, {
					commandId: commandId as Id<'commands'>
				});
				if (!command) {
					throw new Error('Import command not found');
				}
				if (command.status === 'succeeded') {
					const titleId = String(command.result?.titleId ?? imported?._id ?? '');
					if (titleId) {
						await goto(buildTitlePath(titleId, titleName || titleUrl), { replaceState: true });
						return;
					}
					throw new Error('Import completed without a title id');
				}
				if (command.status === 'failed' || command.status === 'cancelled' || command.status === 'dead_letter') {
					throw new Error(command.lastErrorMessage ?? 'Unable to open title');
				}
				await new Promise((resolve) => setTimeout(resolve, 300));
			}

			throw new Error('Timed out while opening title');
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Unable to open title';
		} finally {
			loading = false;
		}
	}

	onMount(() => {
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
			<CaretLeftIcon size={18} />
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

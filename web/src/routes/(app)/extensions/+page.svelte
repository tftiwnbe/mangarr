<script lang="ts">
	import { useConvexClient, useQuery } from 'convex-svelte';
	import { SpinnerIcon, CloudArrowDownIcon, LinkIcon, PuzzlePieceIcon } from 'phosphor-svelte';

	import { convexApi } from '$lib/convex/api';
	import { Button } from '$lib/elements/button';
	import { Input } from '$lib/elements/input';
	import { _ } from '$lib/i18n';

	const client = useConvexClient();

	let repoUrl = $state('');
	let extensionPkg = $state('mangarr.demo.source');
	let extensionName = $state('Demo Source');
	let extensionLang = $state('en');
	let busy = $state(false);
	let error = $state<string | null>(null);
	type CommandItem = {
		id: string;
		commandType: string;
		status: string;
	};

	const repository = useQuery(convexApi.extensions.getRepository, () => ({}));
	const installed = useQuery(convexApi.extensions.listInstalled, () => ({}));
	const commands = useQuery(convexApi.commands.listMine, () => ({ limit: 20 }));

	$effect(() => {
		if (!repoUrl && repository.data?.url) {
			repoUrl = repository.data.url;
		}
	});

	async function enqueueCommand(commandType: string, payload: Record<string, unknown>) {
		busy = true;
		error = null;
		try {
			await client.mutation(convexApi.commands.enqueue, {
				commandType,
				payload
			});
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Failed to queue command';
		} finally {
			busy = false;
		}
	}

	async function syncRepo(event: SubmitEvent) {
		event.preventDefault();
		const url = repoUrl.trim();
		if (!url) return;
		await enqueueCommand('extensions.repo.sync', { url });
	}

	async function installExtension(event: SubmitEvent) {
		event.preventDefault();
		const pkg = extensionPkg.trim();
		if (!pkg) return;
		await enqueueCommand('extensions.install', {
			pkg,
			name: extensionName.trim() || pkg,
			lang: extensionLang.trim() || 'en',
			version: '1.0.0'
		});
	}

	const recentCommands = $derived.by(
		() =>
			((commands.data ?? []) as CommandItem[]).filter((item) =>
				item.commandType.startsWith('extensions.')
			)
	);
</script>

<svelte:head>
	<title>{$_('nav.extensions')} | {$_('app.name')}</title>
</svelte:head>

<div class="flex flex-col gap-6">
	<div class="flex items-center gap-3">
		<h1 class="text-display flex-1 text-xl text-[var(--text)]">{$_('nav.extensions').toLowerCase()}</h1>
	</div>

	<div class="grid gap-4 md:grid-cols-2">
		<div class="border border-[var(--line)] bg-[var(--surface)] p-4">
			<div class="mb-4 flex items-center gap-2 text-[var(--text)]">
				<LinkIcon size={16} />
				<h2 class="text-sm tracking-wider uppercase">Repository</h2>
			</div>
			<form class="flex flex-col gap-3" onsubmit={syncRepo}>
				<Input type="url" label="Repository URL" bind:value={repoUrl} placeholder="https://example.org/index.json" />
				<Button type="submit" size="sm" disabled={busy || !repoUrl.trim()}>
					{busy ? 'Queuing…' : 'Sync repository'}
				</Button>
			</form>
			{#if repository.isLoading}
				<p class="mt-3 text-xs text-[var(--text-ghost)]">Loading repository state…</p>
			{:else if repository.data?.configured}
				<p class="mt-3 text-xs text-[var(--text-ghost)]">Configured: {repository.data.url}</p>
			{:else}
				<p class="mt-3 text-xs text-[var(--text-ghost)]">No repository configured yet.</p>
			{/if}
		</div>

		<div class="border border-[var(--line)] bg-[var(--surface)] p-4">
			<div class="mb-4 flex items-center gap-2 text-[var(--text)]">
				<CloudArrowDownIcon size={16} />
				<h2 class="text-sm tracking-wider uppercase">Install Extension</h2>
			</div>
			<form class="flex flex-col gap-3" onsubmit={installExtension}>
				<Input type="text" label="Package" bind:value={extensionPkg} placeholder="mangarr.demo.source" />
				<Input type="text" label="Name" bind:value={extensionName} placeholder="Demo Source" />
				<Input type="text" label="Language" bind:value={extensionLang} placeholder="en" />
				<Button type="submit" size="sm" disabled={busy || !extensionPkg.trim()}>
					{busy ? 'Queuing…' : 'Install'}
				</Button>
			</form>
		</div>
	</div>

	{#if error}
		<p class="text-sm text-[var(--error)]">{error}</p>
	{/if}

	<div class="border border-[var(--line)] bg-[var(--surface)] p-4">
		<div class="mb-3 flex items-center gap-2 text-[var(--text)]">
			<PuzzlePieceIcon size={16} />
			<h2 class="text-sm tracking-wider uppercase">Installed</h2>
		</div>
		{#if installed.isLoading}
			<div class="flex items-center gap-2 text-[var(--text-ghost)]">
				<SpinnerIcon size={14} class="animate-spin" />
				<span>Loading extensions…</span>
			</div>
		{:else if (installed.data?.length ?? 0) === 0}
			<p class="text-sm text-[var(--text-ghost)]">No extensions installed yet.</p>
		{:else}
			<div class="flex flex-col gap-2">
				{#each installed.data ?? [] as ext (ext._id)}
					<div class="flex items-center justify-between border-b border-[var(--line)] pb-2">
						<div>
							<p class="text-sm text-[var(--text)]">{ext.name}</p>
							<p class="text-xs text-[var(--text-ghost)]">{ext.pkg} · {ext.lang} · v{ext.version}</p>
						</div>
						<span class="text-xs text-[var(--text-muted)] uppercase">{ext.status}</span>
					</div>
				{/each}
			</div>
		{/if}
	</div>

	<div class="border border-[var(--line)] bg-[var(--surface)] p-4">
		<h2 class="mb-3 text-sm tracking-wider text-[var(--text)] uppercase">Recent Extension Commands</h2>
		{#if commands.isLoading}
			<p class="text-sm text-[var(--text-ghost)]">Loading command history…</p>
		{:else if recentCommands.length === 0}
			<p class="text-sm text-[var(--text-ghost)]">No extension commands yet.</p>
		{:else}
			<div class="flex flex-col gap-2">
				{#each recentCommands as cmd (cmd.id)}
					<div class="flex items-center justify-between border-b border-[var(--line)] pb-2">
						<span class="text-xs text-[var(--text-muted)]">{cmd.commandType}</span>
						<span class="text-xs uppercase {cmd.status === 'failed' || cmd.status === 'dead_letter'
							? 'text-[var(--error)]'
							: 'text-[var(--text-ghost)]'}">{cmd.status}</span>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>

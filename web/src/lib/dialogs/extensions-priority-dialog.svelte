<script lang="ts">
	import { Button } from '$elements/button/index';
	import * as Dialog from '$elements/dialog/index';
	import { ScrollArea } from '$elements/scroll-area/index';
	import { Spinner } from '$elements/spinner';
	import type { components } from '$lib/api/v2';
	import ExtensionPriority from '$lib/components/extension/extension-priority.svelte';
	import { ArrowUpDown } from '@lucide/svelte/icons';
	import type { ComponentProps } from 'svelte';

	type ExtensionResource = components['schemas']['ExtensionResource'];

	interface Props extends ComponentProps<typeof Dialog.Root> {
		installedExtensions: ExtensionResource[];
		updateExtensionsPriority: (extensions_by_priority: string[]) => Promise<boolean>;
	}

	let { installedExtensions = $bindable([]), updateExtensionsPriority }: Props = $props();

	let saving = $state(false);
	let isDialogOpen = $state(false);
	let extensions: ExtensionResource[] = $state([]);

	function changePriority(priority: number, direction: 'up' | 'down') {
		const index = priority - 1;
		if (index < 0 || index >= extensions.length) return;
		const newIndex = direction === 'up' ? index - 1 : index + 1;
		if (newIndex < 0 || newIndex >= extensions.length) return;
		[extensions[index], extensions[newIndex]] = [extensions[newIndex], extensions[index]];
		extensions[index].priority = index + 1;
		extensions[newIndex].priority = newIndex + 1;
	}

	async function handleSave() {
		saving = true;
		try {
			const extensions_by_priority = extensions.map((ext) => ext.pkg);
			const success = await updateExtensionsPriority(extensions_by_priority);
			if (success) {
				installedExtensions = extensions;
				isDialogOpen = false;
			}
		} finally {
			saving = false;
		}
	}
	$effect(() => {
		if (isDialogOpen) {
			extensions = [...installedExtensions];
		}
	});
</script>

<Dialog.Root bind:open={isDialogOpen}>
	<Dialog.Trigger>
		<div
			class="flex h-8 items-center gap-1.5 rounded-md px-3 hover:bg-accent hover:text-accent-foreground has-[>svg]:px-2.5 dark:hover:bg-accent/50"
		>
			<ArrowUpDown class="h-4 w-4" />
			<span class="hidden text-sm md:inline">Priority</span>
		</div>
	</Dialog.Trigger>
	<Dialog.Content
		class="flex h-full max-w-full flex-col gap-3 rounded-none border-none sm:h-auto sm:max-h-[85vh] sm:max-w-2xl sm:gap-4 sm:rounded-lg"
	>
		<Dialog.Header class="flex-shrink-0">
			<Dialog.Title>Extensions Priority</Dialog.Title>
			<Dialog.Description>
				Reorder extension for their priority. Extensions at the top will be used first.
			</Dialog.Description>
		</Dialog.Header>

		<ScrollArea class="overflow-y-auto">
			{#each extensions, i (i)}
				<ExtensionPriority
					bind:extension={extensions[i]}
					{changePriority}
					isFirst={i === 0}
					isLast={i === extensions.length - 1}
				/>
			{/each}
		</ScrollArea>

		<Dialog.Footer>
			<Button
				variant="outline"
				onclick={() => {
					isDialogOpen = false;
				}}
				disabled={saving}
			>
				Cancel
			</Button>
			<Button onclick={handleSave} disabled={saving}>
				{#if saving}
					<Spinner />
				{/if}
				Save Changes
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

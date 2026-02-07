<script lang="ts">
	import { Button } from '$elements/button/index';
	import * as Dialog from '$elements/dialog/index';
	import * as Item from '$elements/item/index';
	import type { components } from '$lib/api/v2';
	import { ArrowUp, ArrowDown } from '@lucide/svelte/icons';
	import type { ComponentProps } from 'svelte';
	import { Separator } from '$elements/item/index';

	type ExtensionResource = components['schemas']['ExtensionResource'];
	interface Props extends ComponentProps<typeof Dialog.Root> {
		extension: ExtensionResource;
		changePriority: (priority: number, direction: 'up' | 'down') => void;
		isFirst: boolean;
		isLast: boolean;
	}
	let {
		extension = $bindable(),
		changePriority,
		isFirst = false,
		isLast = false
	}: Props = $props();
</script>

<Item.Root variant="default" class="mx-6 transition-colors hover:bg-accent/50">
	<p>{extension.priority}</p>
	<Separator orientation="vertical" decorative={true} />
	<Item.Media variant="image" class="flex-shrink-0">
		<img src={extension.icon} alt={extension.name} width="96" height="96" />
	</Item.Media>
	<Item.Content class="min-w-0 flex-1">
		<Item.Title class="line-clamp-1 text-sm sm:text-base">
			{extension.name}
		</Item.Title>
	</Item.Content>
	<Item.Actions>
		<Button
			size="icon-lg"
			variant="ghost"
			disabled={isFirst}
			onclick={() => changePriority(extension.priority, 'up')}
			aria-label="Move up"
		>
			<ArrowUp />
		</Button>
		<Button
			size="icon-lg"
			variant="ghost"
			disabled={isLast}
			onclick={() => changePriority(extension.priority, 'down')}
			aria-label="Move down"
		>
			<ArrowDown />
		</Button>
	</Item.Actions>
</Item.Root>

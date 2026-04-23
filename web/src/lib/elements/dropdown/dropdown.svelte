<script lang="ts">
	import { DropdownMenu } from 'bits-ui';
	import type { Snippet } from 'svelte';

	interface Props {
		trigger: Snippet;
		children: Snippet;
		triggerClass?: string;
		align?: 'start' | 'center' | 'end';
		sideOffset?: number;
		disabled?: boolean;
		open?: boolean;
	}

	let {
		trigger,
		children,
		triggerClass = '',
		align = 'start',
		sideOffset = 4,
		disabled = false,
		open = $bindable(false)
	}: Props = $props();
</script>

<DropdownMenu.Root bind:open>
	<DropdownMenu.Trigger class={triggerClass}>
		{@render trigger()}
	</DropdownMenu.Trigger>

	<DropdownMenu.Portal>
		<DropdownMenu.Content
			{align}
			{sideOffset}
			class="z-50 min-w-[160px] bg-[var(--void-3)] py-1 shadow-lg outline-none"
		>
			{@render children()}
		</DropdownMenu.Content>
	</DropdownMenu.Portal>
</DropdownMenu.Root>

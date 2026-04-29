<script lang="ts">
	import { DropdownMenu } from 'bits-ui';
	import type { Snippet } from 'svelte';

	interface Props {
		children: Snippet;
		icon?: Snippet;
		variant?: 'default' | 'danger';
		disabled?: boolean;
		onSelect?: () => void;
	}

	let { children, icon, variant = 'default', disabled = false, onSelect }: Props = $props();
</script>

<DropdownMenu.Item
	{disabled}
	{onSelect}
	class="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs transition-colors outline-none
		disabled:pointer-events-none disabled:opacity-40
		{variant === 'danger'
		? 'text-[var(--text-ghost)] data-[highlighted]:bg-[var(--error-soft)] data-[highlighted]:text-[var(--error)]'
		: 'text-[var(--text-ghost)] data-[highlighted]:bg-[var(--void-4)] data-[highlighted]:text-[var(--text)]'}"
>
	{#if icon}
		<span class="shrink-0">{@render icon()}</span>
	{/if}
	{@render children()}
</DropdownMenu.Item>

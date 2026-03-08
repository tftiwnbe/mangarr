<script lang="ts">
	export interface TabItem {
		value: string;
		label: string;
		count?: number;
	}

	interface Props {
		tabs: TabItem[];
		value: string;
		class?: string;
		onValueChange?: (value: string) => void;
	}

	let { tabs, value, class: className = '', onValueChange }: Props = $props();
</script>

<div class="flex gap-6 border-b border-[var(--void-3)] {className}">
	{#each tabs as tab (tab.value)}
		<button
			type="button"
			class="relative pb-2.5 text-xs font-medium tracking-wide transition-colors focus-visible:outline-none
				{value === tab.value ? 'text-[var(--text)]' : 'text-[var(--text-ghost)] hover:text-[var(--text-soft)]'}"
			onclick={() => onValueChange?.(tab.value)}
		>
			{tab.label}
			{#if tab.count !== undefined && tab.count > 0}
				<span class="ml-1.5 tabular-nums text-[10px] opacity-60">{tab.count}</span>
			{/if}
			{#if value === tab.value}
				<div class="absolute inset-x-0 -bottom-px h-px bg-[var(--text)]"></div>
			{/if}
		</button>
	{/each}
</div>

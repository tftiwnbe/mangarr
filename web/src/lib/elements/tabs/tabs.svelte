<script lang="ts">
	import type { TabItem } from './types';

	interface Props {
		tabs: TabItem[];
		value: string;
		class?: string;
		onValueChange?: (value: string) => void;
	}

	let { tabs, value, class: className = '', onValueChange }: Props = $props();
</script>

<div class="flex gap-6 {className}">
	{#each tabs as tab (tab.value)}
		{@const isActive = value === tab.value}

		<button
			type="button"
			class="relative pb-2 text-xs font-medium tracking-wide transition-colors focus-visible:outline-none
				{isActive ? 'text-[var(--text)]' : 'text-[var(--text-ghost)] hover:text-[var(--text-muted)]'}"
			onclick={() => onValueChange?.(tab.value)}
		>
			<span class="flex items-center gap-1.5">
				{tab.label}

				{#if tab.count !== undefined && tab.count > 0}
					<span
						class="text-[10px] tabular-nums
						{isActive ? 'text-[var(--text-muted)]' : 'text-[var(--void-7)]'}"
					>
						{tab.count}
					</span>
				{/if}
			</span>

			{#if isActive}
				<span class="absolute inset-x-0 bottom-0 h-px bg-[var(--text-muted)]"></span>
			{/if}
		</button>
	{/each}
</div>

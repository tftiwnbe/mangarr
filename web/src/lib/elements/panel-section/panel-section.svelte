<script lang="ts">
	import type { Snippet } from 'svelte';

	type Props = {
		label: string;
		index?: string;
		count?: number;
		hint?: string;
		divider?: boolean;
		children?: Snippet;
		actions?: Snippet;
	};

	let {
		label,
		index,
		count,
		hint,
		divider = true,
		children,
		actions
	}: Props = $props();
</script>

<section
	class="flex flex-col gap-3 py-5 first:pt-4 {divider ? 'border-b border-[var(--void-3)]' : ''}"
>
	<header class="flex items-baseline justify-between gap-3">
		<div class="flex items-baseline gap-2">
			<span
				class="h-1 w-1 shrink-0 translate-y-[-1px] bg-[var(--cosmic)] shadow-[0_0_4px_var(--cosmic-glow)]"
			></span>
			<span
				class="font-mono text-[10px] tracking-[0.22em] text-[var(--text-ghost)] uppercase"
			>
				{label}
			</span>
			{#if count !== undefined && count > 0}
				<span
					class="border border-[var(--cosmic-halo)] bg-[var(--cosmic-soft)] px-1.5 py-px font-mono text-[9px] tracking-[0.16em] text-[var(--cosmic)] tabular-nums"
				>
					{count}
				</span>
			{/if}
			{#if hint}
				<span class="font-mono text-[9px] tracking-[0.18em] text-[var(--text-dim,#3a3a48)] uppercase">
					{hint}
				</span>
			{/if}
		</div>
		<div class="flex items-center gap-2">
			{#if actions}
				{@render actions()}
			{/if}
			{#if index}
				<span
					class="font-mono text-[9px] tracking-[0.2em] text-[var(--void-6)] tabular-nums uppercase"
				>
					{index}
				</span>
			{/if}
		</div>
	</header>
	{#if children}
		{@render children()}
	{/if}
</section>

<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';
	import { MagnifyingGlassIcon, XIcon } from 'phosphor-svelte';

	type Props = Omit<HTMLInputAttributes, 'class' | 'type' | 'value' | 'size'> & {
		value?: string;
		inputSize?: 'sm' | 'md';
		class?: string;
		onClear?: () => void;
	};

	let {
		value = $bindable(''),
		inputSize = 'md',
		class: className = '',
		onClear,
		...restProps
	}: Props = $props();

	const heights = { sm: 'h-9', md: 'h-11' };
	const iconSizes = { sm: 13, md: 15 };
</script>

<div class="relative {className}">
	<div
		class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[var(--text-ghost)]"
	>
		<MagnifyingGlassIcon size={iconSizes[inputSize]} />
	</div>

	<input
		type="text"
		bind:value
		class="{heights[inputSize]} w-full border border-[var(--void-4)] bg-[var(--void-2)]
			pr-9 pl-9 text-sm text-[var(--text)] transition-colors
			placeholder:text-[var(--text-ghost)]
			hover:border-[var(--void-5)]
			focus:border-[var(--void-6)] focus:outline-none
			disabled:pointer-events-none disabled:opacity-40"
		inputmode="search"
		enterkeyhint="search"
		role="searchbox"
		{...restProps}
	/>

	{#if value}
		<button
			type="button"
			class="absolute top-1/2 right-3 -translate-y-1/2 text-[var(--text-ghost)] transition-colors hover:text-[var(--text-muted)]"
			onclick={() => {
				value = '';
				onClear?.();
			}}
			aria-label="Clear search"
		>
			<XIcon size={14} />
		</button>
	{/if}
</div>

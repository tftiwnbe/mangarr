<script lang="ts" module>
	import { cn, type WithElementRef } from '$lib/utils.js';
	import type { HTMLAttributes } from 'svelte/elements';

	export type SearchInputProps = WithElementRef<HTMLAttributes<HTMLDivElement>> & {
		placeholder?: string;
		value: string;
		onClear?: () => void;
		onKeydown?: (e: KeyboardEvent) => void;
		onFocus?: () => void;
		onBlur?: () => void;
		autofocus?: boolean;
		showClearButton?: boolean;
	};
</script>

<script lang="ts">
	import { Input } from '$elements/input/index.js';
	import SearchIcon from '@lucide/svelte/icons/search';
	import XIcon from '@lucide/svelte/icons/x';

	let {
		class: className,
		placeholder = 'Search...',
		value = $bindable(),
		onClear = () => {},
		onKeydown = () => {},
		onFocus = () => {},
		onBlur = () => {},
		autofocus = false,
		showClearButton = true,
		ref = $bindable(null),
		...restProps
	}: SearchInputProps = $props();

	function handleClear() {
		value = '';
		onClear();
	}
</script>

<div bind:this={ref} class={cn('relative w-full', className)} {...restProps}>
	<SearchIcon
		class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
	/>
	<Input
		bind:value
		type="search"
		{placeholder}
		{autofocus}
		onfocus={onFocus}
		onblur={onBlur}
		onkeydown={onKeydown}
		class="h-11 px-10 md:h-9"
	/>
	{#if showClearButton && value}
		<button
			onclick={handleClear}
			onmousedown={(e) => e.preventDefault()}
			class="absolute top-1/2 right-3 -translate-y-1/2 rounded-sm p-1 text-muted-foreground transition-colors hover:text-foreground"
			type="button"
			aria-label="Clear search"
		>
			<XIcon class="size-4" />
		</button>
	{/if}
</div>

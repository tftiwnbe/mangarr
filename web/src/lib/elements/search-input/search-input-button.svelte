<script lang="ts" module>
	import { cn, type WithElementRef } from '$lib/utils.js';
	import type { HTMLAttributes } from 'svelte/elements';
	import type { ButtonVariant, ButtonSize } from '$elements/button/index.js';

	export type SearchButtonProps = WithElementRef<HTMLAttributes<HTMLDivElement>> & {
		placeholder?: string;
		onSearch?: (value: string) => void;
		value: string;
		buttonVariant?: ButtonVariant;
		buttonSize?: ButtonSize;
	};
</script>

<script lang="ts">
	import { blur } from 'svelte/transition';
	import { Button } from '$elements/button/index.js';
	import SearchIcon from '@lucide/svelte/icons/search';
	import SearchInput from './search-input.svelte';

	let {
		class: className,
		placeholder = 'Search...',
		onSearch = () => {},
		value = $bindable(),
		buttonVariant = 'outline',
		buttonSize = 'sm',
		ref = $bindable(null),
		...restProps
	}: SearchButtonProps = $props();

	let isExpanded = $state(false);
	let isFocused = $state(false);

	function handleExpand() {
		isExpanded = true;
	}

	function handleClose() {
		isExpanded = false;
		isFocused = false;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			handleClose();
		} else if (e.key === 'Enter') {
			onSearch(value);
			handleClose();
		}
	}
</script>

<div bind:this={ref} class={cn('relative', className)} {...restProps}>
	<!-- Mobile: Inline expansion to full screen width -->
	<div class="md:hidden">
		{#if !isExpanded}
			<Button size={buttonSize} variant={buttonVariant} onclick={handleExpand}>
				<SearchIcon />
			</Button>
		{:else}
			<div transition:blur class="fixed top-0 right-0 left-0 z-50 px-4 pt-2">
				<SearchInput
					bind:value
					{placeholder}
					onKeydown={handleKeydown}
					onBlur={handleClose}
					autofocus={true}
				/>
			</div>
		{/if}
	</div>

	<!-- Desktop: Expanding input -->
	<div class="hidden md:block">
		<div
			class="relative transition-all duration-200 ease-in-out"
			class:w-100={isFocused}
			class:w-60={!isFocused}
		>
			<SearchInput
				bind:value
				{placeholder}
				onFocus={() => (isFocused = true)}
				onBlur={() => (isFocused = false)}
				onKeydown={handleKeydown}
				class="transition-all duration-200 ease-in-out"
			/>
		</div>
	</div>
</div>

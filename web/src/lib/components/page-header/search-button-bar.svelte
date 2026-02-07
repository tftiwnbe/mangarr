<script lang="ts" module>
	import { cn, type WithElementRef } from '$lib/utils.js';
	import type { HTMLAttributes } from 'svelte/elements';

	export type SearchButtonProps = WithElementRef<HTMLAttributes<HTMLDivElement>> & {
		placeholder?: string;
		onSearch?: (value: string) => void;
		value: string;
	};
</script>

<script lang="ts">
	import { blur } from 'svelte/transition';
	import { Button } from '$elements/button/index.js';
	import { Input } from '$elements/input/index.js';
	import SearchIcon from '@lucide/svelte/icons/search';
	import XIcon from '@lucide/svelte/icons/x';

	let {
		class: className,
		placeholder = 'Search...',
		onSearch = () => {},
		value = $bindable(),
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
		ref?.blur();
	}

	function handleClear() {
		value = '';
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
			<Button variant="outline" size="icon-sm" onclick={handleExpand}>
				<SearchIcon />
			</Button>
		{:else}
			<div transition:blur class="fixed top-0 right-0 left-0 z-50 px-4 pt-4">
				<div class="relative w-full">
					<SearchIcon
						class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
					/>
					<Input
						bind:value
						type="search"
						{placeholder}
						onkeydown={handleKeydown}
						onblur={handleClose}
						class="px-10"
						autofocus
					/>
					{#if value}
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
			<SearchIcon
				class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
			/>
			<Input
				bind:value
				type="search"
				{placeholder}
				onfocus={() => (isFocused = true)}
				onblur={() => (isFocused = false)}
				onkeydown={handleKeydown}
				class="h-9 pr-10 pl-10 transition-all duration-200 ease-in-out"
			/>
			{#if value}
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
	</div>
</div>

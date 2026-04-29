<script lang="ts">
	import type { Component, Snippet } from 'svelte';
	import { Button } from '$lib/elements/button';

	interface Props {
		icon?: Component<{ size?: number; class?: string }>;
		title: string;
		description?: string;
		actionLabel?: string;
		actionHref?: string;
		onAction?: () => void;
		class?: string;
		children?: Snippet;
	}

	let {
		icon: Icon,
		title,
		description,
		actionLabel,
		actionHref,
		onAction,
		class: className = '',
		children
	}: Props = $props();
</script>

<div class="flex flex-col items-center justify-center py-16 text-center {className}">
	{#if Icon}
		<!-- Instrument crosshair frame around the icon -->
		<div class="relative flex h-16 w-16 items-center justify-center">
			<!-- Corner brackets -->
			<span class="absolute top-0 left-0 h-3 w-3 border-t border-l border-[var(--void-5)]"></span>
			<span class="absolute top-0 right-0 h-3 w-3 border-t border-r border-[var(--void-5)]"></span>
			<span class="absolute bottom-0 left-0 h-3 w-3 border-b border-l border-[var(--void-5)]"
			></span>
			<span class="absolute right-0 bottom-0 h-3 w-3 border-r border-b border-[var(--void-5)]"
			></span>
			<Icon size={26} class="animate-float text-[var(--void-6)]" />
		</div>

		<!-- HUD "no data" label -->
		<span class="mt-4 text-[10px] tracking-[0.24em] text-[var(--void-6)] uppercase"> no data </span>
	{/if}

	<h3 class="text-display mt-2 text-sm text-[var(--text)]">{title}</h3>

	{#if description}
		<p class="mt-2 max-w-[260px] text-xs leading-relaxed text-[var(--text-ghost)]">
			{description}
		</p>
	{/if}

	{#if children}
		<div class="mt-5">
			{@render children()}
		</div>
	{:else if actionLabel && (onAction || actionHref)}
		<div class="mt-5">
			<Button variant="outline" size="sm" href={actionHref} onclick={onAction}>
				{actionLabel}
			</Button>
		</div>
	{/if}
</div>

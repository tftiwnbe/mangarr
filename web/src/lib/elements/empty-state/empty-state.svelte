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
		<Icon size={40} class="text-[var(--void-5)]" />
		<div class="mt-5"></div>
	{/if}

	<h3 class="text-display text-sm text-[var(--text)]">{title}</h3>

	{#if description}
		<p class="mt-2 max-w-[280px] text-xs leading-relaxed text-[var(--text-ghost)]">
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

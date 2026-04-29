<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';

	type Variant = 'solid' | 'default' | 'ghost' | 'outline';
	type Size = 'sm' | 'md' | 'lg' | 'icon-sm' | 'icon';

	interface Props extends HTMLButtonAttributes {
		variant?: Variant;
		size?: Size;
		loading?: boolean;
		children: Snippet;
		class?: string;
		href?: string;
	}

	let {
		variant = 'solid',
		size = 'md',
		loading = false,
		disabled = false,
		children,
		class: className = '',
		href,
		...restProps
	}: Props = $props();

	const baseStyles = `
		relative inline-flex items-center justify-center gap-2
		font-medium transition-all
		disabled:pointer-events-none disabled:opacity-40
		focus-visible:outline-none
	`;

	const glowStyle = `
		hover:shadow-[0_0_12px_rgba(255,255,255,0.15),0_0_24px_rgba(180,180,200,0.1)]
		active:shadow-[0_0_16px_rgba(255,255,255,0.2),0_0_32px_rgba(180,180,200,0.15)]
	`;

	const solidStyle = `
		bg-[var(--void-5)] text-[var(--text)]
		border border-[var(--void-6)]
		hover:bg-[var(--void-6)] hover:border-[var(--void-7)]
		active:bg-[var(--void-4)]
		focus-visible:border-[var(--void-7)]
		${glowStyle}
	`;

	const variants: Record<Variant, string> = {
		solid: solidStyle,
		default: solidStyle,
		ghost: `
			text-[var(--text-soft)]
			hover:text-[var(--text)] hover:bg-[var(--void-3)]
			active:bg-[var(--void-4)]
		`,
		outline: `
			text-[var(--text-soft)]
			border border-[var(--line)]
			hover:text-[var(--text)] hover:border-[var(--void-6)] hover:bg-[var(--void-2)]
			active:bg-[var(--void-3)]
		`
	};

	const sizes: Record<Size, string> = {
		sm: 'h-8 px-3 text-xs',
		md: 'h-10 px-4 text-sm',
		lg: 'h-12 px-6 text-base',
		'icon-sm': 'h-8 w-8 p-0',
		icon: 'h-10 w-10 p-0'
	};

	// Icon-only buttons: hide children and show spinner alone when loading
	const isIconSize = $derived(size === 'icon' || size === 'icon-sm');

	// Spinner size matches button size
	const spinnerClass = $derived(
		size === 'sm' || size === 'icon-sm' ? 'h-3 w-3' : size === 'lg' ? 'h-5 w-5' : 'h-4 w-4'
	);
</script>

{#snippet spinner()}
	<svg
		class="{spinnerClass} animate-spin"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="2"
	>
		<circle cx="12" cy="12" r="10" stroke-opacity="0.2" />
		<path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round" />
	</svg>
{/snippet}

{#if href}
	<a
		{href}
		class="{baseStyles} {variants[variant]} {sizes[size]} {className}"
		class:pointer-events-none={disabled || loading}
		class:opacity-40={disabled || loading}
	>
		{#if loading}
			{@render spinner()}
		{/if}
		{#if !loading || !isIconSize}
			{@render children()}
		{/if}
	</a>
{:else}
	<button
		class="{baseStyles} {variants[variant]} {sizes[size]} {className}"
		disabled={disabled || loading}
		{...restProps}
	>
		{#if loading}
			{@render spinner()}
		{/if}
		{#if !loading || !isIconSize}
			{@render children()}
		{/if}
	</button>
{/if}

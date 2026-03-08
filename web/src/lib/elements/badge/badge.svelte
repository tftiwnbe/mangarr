<script lang="ts">
	import type { Snippet } from 'svelte';

	type Variant = 'default' | 'success' | 'error' | 'warning' | 'muted';

	interface Props {
		variant?: Variant;
		class?: string;
		children: Snippet;
	}

	let { variant = 'default', class: className = '', children }: Props = $props();

	const variantClass: Record<Variant, string> = {
		default: 'border-[var(--void-5)] bg-[var(--void-3)] text-[var(--text-soft)]',
		success: 'border-[var(--success)]/20 bg-[var(--success-soft)] text-[var(--success)]',
		error: 'border-[var(--error)]/20 bg-[var(--error-soft)] text-[var(--error)]',
		warning: 'border-amber-500/20 bg-amber-500/10 text-amber-400',
		muted: 'border-transparent bg-transparent text-[var(--text-ghost)]'
	};
</script>

<span
	class="inline-flex items-center border px-1.5 py-0.5 font-mono text-[10px] leading-none tracking-widest uppercase {variantClass[
		variant
	]} {className}"
>
	{@render children()}
</span>

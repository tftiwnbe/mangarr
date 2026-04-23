<script lang="ts">
	import type { Snippet } from 'svelte';
	import { XIcon } from 'phosphor-svelte';

	type Variant = 'error' | 'success' | 'info' | 'warning';

	interface Props {
		variant?: Variant;
		title?: string;
		dismissible?: boolean;
		onDismiss?: () => void;
		class?: string;
		children: Snippet;
	}

	let {
		variant = 'info',
		title,
		dismissible = false,
		onDismiss,
		class: className = '',
		children
	}: Props = $props();

	const configs: Record<
		Variant,
		{ dot: string; label: string; border: string; bg: string; pulse: boolean }
	> = {
		error: {
			dot: 'bg-[var(--error)] shadow-[0_0_6px_var(--error)]',
			label: 'alert',
			border: 'border-l-[var(--error)]',
			bg: 'bg-[var(--error-soft)]',
			pulse: true
		},
		success: {
			dot: 'bg-[var(--success)] shadow-[0_0_6px_var(--success)]',
			label: 'ok',
			border: 'border-l-[var(--success)]',
			bg: 'bg-[var(--success-soft)]',
			pulse: false
		},
		info: {
			dot: 'bg-[var(--cosmic)] shadow-[0_0_6px_var(--cosmic-glow)]',
			label: 'info',
			border: 'border-l-[var(--void-6)]',
			bg: 'bg-[var(--cosmic-soft)]',
			pulse: false
		},
		warning: {
			dot: 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.6)]',
			label: 'warn',
			border: 'border-l-amber-500',
			bg: 'bg-amber-500/5',
			pulse: false
		}
	};

	const config = $derived(configs[variant]);
</script>

<div
	class="border-l-[3px] px-4 py-3 {config.border} {config.bg} {className}"
	role={variant === 'error' ? 'alert' : 'status'}
>
	<!-- HUD header row -->
	<div class="mb-2 flex items-center gap-2">
		<span
			class="h-1 w-1 shrink-0 rounded-full {config.dot} {config.pulse ? 'animate-pulse' : ''}"
		></span>
		<span class="text-[10px] tracking-[0.24em] text-[var(--text-ghost)] uppercase">
			{title ?? config.label}
		</span>
		{#if dismissible}
			<button
				type="button"
				class="ml-auto shrink-0 text-[var(--text-ghost)] transition-colors hover:text-[var(--text-muted)]"
				onclick={onDismiss}
				aria-label="Dismiss"
			>
				<XIcon size={12} />
			</button>
		{/if}
	</div>

	<!-- Message body -->
	<div class="pl-3 text-xs leading-relaxed text-[var(--text-muted)]">
		{@render children()}
	</div>
</div>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import { CheckCircleIcon, InfoIcon, WarningCircleIcon, XCircleIcon, XIcon } from 'phosphor-svelte';

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

	const configs: Record<Variant, { borderColor: string; iconColor: string; bg: string; Icon: typeof InfoIcon }> = {
		error:   { borderColor: 'border-l-[var(--error)]',   iconColor: 'text-[var(--error)]',      bg: 'bg-[var(--error-soft)]',    Icon: XCircleIcon },
		success: { borderColor: 'border-l-[var(--success)]', iconColor: 'text-[var(--success)]',    bg: 'bg-[var(--success-soft)]',  Icon: CheckCircleIcon },
		info:    { borderColor: 'border-l-[var(--void-7)]',  iconColor: 'text-[var(--text-ghost)]', bg: '',                          Icon: InfoIcon },
		warning: { borderColor: 'border-l-amber-500',         iconColor: 'text-amber-400',           bg: 'bg-amber-500/5',            Icon: WarningCircleIcon },
	};

	const config = $derived(configs[variant]);
</script>

<div
	class="flex gap-3 border-l-[3px] px-4 py-3 {config.borderColor} {config.bg} {className}"
	role={variant === 'error' ? 'alert' : 'status'}
>
	<div class="mt-px shrink-0 {config.iconColor}">
		<config.Icon size={15} weight="fill" />
	</div>

	<div class="flex min-w-0 flex-1 flex-col gap-1">
		{#if title}
			<p class="text-label">{title}</p>
		{/if}
		<div class="text-xs leading-relaxed text-[var(--text-muted)]">
			{@render children()}
		</div>
	</div>

	{#if dismissible}
		<button
			type="button"
			class="shrink-0 self-start text-[var(--text-ghost)] transition-colors hover:text-[var(--text-muted)]"
			onclick={onDismiss}
			aria-label="Dismiss"
		>
			<XIcon size={14} />
		</button>
	{/if}
</div>

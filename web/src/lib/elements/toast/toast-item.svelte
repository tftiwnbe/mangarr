<script lang="ts">
	import { CheckCircleIcon, InfoIcon, WarningCircleIcon, XCircleIcon } from 'phosphor-svelte';
	import { fly } from 'svelte/transition';
	import { toast, type ToastVariant } from './toast.store.svelte';

	interface Props {
		id: string;
		variant: ToastVariant;
		title?: string;
		message: string;
		duration: number;
	}

	let { id, variant, title, message, duration }: Props = $props();

	const configs: Record<
		ToastVariant,
		{ borderColor: string; iconColor: string; drainColor: string; label: string; Icon: typeof InfoIcon }
	> = {
		success: {
			borderColor: 'border-l-[var(--success)]',
			iconColor: 'text-[var(--success)]',
			drainColor: 'bg-[var(--success)]',
			label: 'success',
			Icon: CheckCircleIcon
		},
		error: {
			borderColor: 'border-l-[var(--error)]',
			iconColor: 'text-[var(--error)]',
			drainColor: 'bg-[var(--error)]',
			label: 'error',
			Icon: XCircleIcon
		},
		info: {
			borderColor: 'border-l-[var(--void-7)]',
			iconColor: 'text-[var(--text-ghost)]',
			drainColor: 'bg-[var(--void-7)]',
			label: 'info',
			Icon: InfoIcon
		},
		warning: {
			borderColor: 'border-l-amber-500',
			iconColor: 'text-amber-400',
			drainColor: 'bg-amber-500',
			label: 'warning',
			Icon: WarningCircleIcon
		}
	};

	const config = $derived(configs[variant]);
</script>

<div
	class="pointer-events-auto relative overflow-hidden border-l-[3px] bg-[var(--void-2)] shadow-xl
		{config.borderColor}"
	in:fly={{ x: -16, duration: 200, opacity: 0 }}
	out:fly={{ x: -16, duration: 150, opacity: 0 }}
	role="status"
	aria-live="polite"
>
	<button
		type="button"
		class="flex w-full items-start gap-3 px-4 py-3 text-left"
		onclick={() => toast.dismiss(id)}
	>
		<div class="mt-px shrink-0 {config.iconColor}">
			<config.Icon size={15} weight="fill" />
		</div>

		<div class="min-w-0 flex-1">
			{#if title}
				<p class="text-label mb-0.5">{title}</p>
			{:else}
				<p class="text-label mb-0.5">{config.label}</p>
			{/if}
			<p class="text-xs leading-relaxed text-[var(--text-muted)]">{message}</p>
		</div>
	</button>

	<!-- Drain bar — animates from full width to 0 over `duration` ms -->
	<div class="absolute bottom-0 left-0 h-[2px] w-full overflow-hidden">
		<div
			class="h-full origin-left {config.drainColor}"
			style="animation: toast-drain {duration}ms linear forwards;"
		></div>
	</div>
</div>

<style>
	@keyframes toast-drain {
		from {
			transform: scaleX(1);
		}
		to {
			transform: scaleX(0);
		}
	}
</style>

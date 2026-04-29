<script lang="ts">
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
		{ dot: string; label: string; border: string; pulse: boolean }
	> = {
		success: {
			dot: 'bg-[var(--success)] shadow-[0_0_6px_var(--success)]',
			label: 'ok',
			border: 'border-l-[var(--success)]',
			pulse: false
		},
		error: {
			dot: 'bg-[var(--error)] shadow-[0_0_6px_var(--error)]',
			label: 'alert',
			border: 'border-l-[var(--error)]',
			pulse: true
		},
		info: {
			dot: 'bg-[var(--cosmic)] shadow-[0_0_6px_var(--cosmic-glow)]',
			label: 'info',
			border: 'border-l-[var(--void-6)]',
			pulse: false
		},
		warning: {
			dot: 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.6)]',
			label: 'warn',
			border: 'border-l-amber-500',
			pulse: false
		}
	};

	const config = $derived(configs[variant]);
</script>

<div
	class="pointer-events-auto relative overflow-hidden border-l-[3px] bg-[var(--void-2)]
		shadow-[0_0_0_1px_var(--void-4),0_8px_32px_-8px_rgba(0,0,0,0.6)] {config.border}"
	in:fly={{ x: -16, duration: 220, opacity: 0 }}
	out:fly={{ x: -16, duration: 140, opacity: 0 }}
	role="status"
	aria-live="polite"
>
	<button
		type="button"
		class="flex w-full items-start gap-3 px-4 py-3 text-left"
		onclick={() => toast.dismiss(id)}
	>
		<!-- HUD label row -->
		<div class="flex min-w-0 flex-1 flex-col gap-1.5">
			<div class="flex items-center gap-2">
				<span
					class="h-1 w-1 shrink-0 rounded-full {config.dot} {config.pulse ? 'animate-pulse' : ''}"
				></span>
				<span class="text-[10px] tracking-[0.24em] text-[var(--text-ghost)] uppercase">
					{title ?? config.label}
				</span>
			</div>
			<p class="pl-3 text-xs leading-relaxed text-[var(--text-muted)]">{message}</p>
		</div>
	</button>

	<!-- Cosmic drain bar — always indigo, the system's signal color -->
	<div class="absolute bottom-0 left-0 h-[2px] w-full bg-[var(--void-4)]">
		<div
			class="h-full origin-left bg-[var(--cosmic)] shadow-[0_0_8px_var(--cosmic-glow)]"
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

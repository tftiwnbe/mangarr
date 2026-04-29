<script lang="ts">
	import type { Snippet } from 'svelte';
	import { XIcon } from 'phosphor-svelte';

	import { popPanelOverlay, pushPanelOverlay } from '$lib/stores/ui';

	interface Props {
		open: boolean;
		title?: string;
		badge?: string | number;
		onclose: () => void;
		children?: Snippet;
		header?: Snippet;
		footer?: Snippet;
	}

	let {
		open = false,
		title = '',
		badge,
		onclose,
		children,
		header,
		footer
	}: Props = $props();

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && open) {
			onclose();
		}
	}

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) {
			onclose();
		}
	}

	$effect(() => {
		if (!open) return;
		pushPanelOverlay();
		return () => popPanelOverlay();
	});
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
	<!-- Backdrop -->
	<div
		class="animate-fade-in fixed inset-0 z-[60] bg-[var(--void-0)]/85 backdrop-blur-sm"
		onclick={handleBackdropClick}
		role="presentation"
	>
		<!-- Panel -->
		<div
			class="animate-slide-in-right absolute top-0 right-0 flex h-full w-full flex-col
				border-l border-[var(--void-4)] bg-[var(--void-1)] sm:max-w-md"
			style="padding-top: env(safe-area-inset-top); padding-bottom: env(safe-area-inset-bottom); padding-right: env(safe-area-inset-right);"
			role="dialog"
			aria-modal="true"
			aria-labelledby="slide-panel-title"
		>
			<!-- HUD header -->
			<div class="shrink-0 border-b border-[var(--void-3)]">
				<div class="flex h-11 items-center justify-between px-4">
					<div class="flex items-center gap-2">
						<span
							class="h-1 w-1 shrink-0 bg-[var(--cosmic)] shadow-[0_0_4px_var(--cosmic-glow)]"
						></span>
						<h2
							id="slide-panel-title"
							class="font-mono text-[10px] tracking-[0.24em] text-[var(--text-ghost)] uppercase"
						>
							{title}
						</h2>
						{#if badge !== undefined && badge !== '' && badge !== 0}
							<span
								class="border border-[var(--cosmic-halo)] bg-[var(--cosmic-soft)] px-1.5 py-px font-mono text-[9px] tracking-[0.16em] text-[var(--cosmic)] tabular-nums"
							>
								{badge}
							</span>
						{/if}
					</div>
					<button
						type="button"
						class="flex h-7 w-7 items-center justify-center text-[var(--text-ghost)] transition-colors hover:text-[var(--text)]"
						onclick={onclose}
						aria-label="Close panel"
					>
						<XIcon size={14} />
					</button>
				</div>
				{#if header}
					<div class="border-t border-[var(--void-3)] px-4 py-2">
						{@render header()}
					</div>
				{/if}
			</div>

			<!-- Scrollable content -->
			<div class="no-scrollbar min-h-0 flex-1 overflow-y-auto px-4 pb-4">
				{#if children}
					{@render children()}
				{/if}
			</div>

			<!-- Sticky footer (optional) -->
			{#if footer}
				<div class="shrink-0 border-t border-[var(--void-3)] bg-[var(--void-1)] px-4 py-3">
					{@render footer()}
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	@keyframes fade-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	@keyframes slide-in-right {
		from {
			transform: translateX(100%);
		}
		to {
			transform: translateX(0);
		}
	}

	.animate-fade-in {
		animation: fade-in 0.12s ease-out;
	}

	.animate-slide-in-right {
		animation: slide-in-right 0.2s cubic-bezier(0.16, 1, 0.3, 1);
	}
</style>

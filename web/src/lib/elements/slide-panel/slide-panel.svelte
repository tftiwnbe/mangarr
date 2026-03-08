<script lang="ts">
	import { Icon } from '$lib/elements/icon';

	interface Props {
		open: boolean;
		title?: string;
		onclose: () => void;
		children?: import('svelte').Snippet;
	}

	let { open = false, title = '', onclose, children }: Props = $props();

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
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
	<!-- Backdrop -->
	<div
		class="animate-fade-in fixed inset-0 z-50 bg-[var(--void-0)]/85 backdrop-blur-sm"
		onclick={handleBackdropClick}
		role="presentation"
	>
		<!-- Panel -->
		<div
			class="animate-slide-in-right absolute top-0 right-0 h-full w-full max-w-sm bg-[var(--void-0)]"
			role="dialog"
			aria-modal="true"
			aria-labelledby="slide-panel-title"
		>
			<!-- Header -->
			<div class="flex h-11 items-center justify-between px-4">
				<h2
					id="slide-panel-title"
					class="text-xs tracking-wider text-[var(--text-muted)] uppercase"
				>
					{title}
				</h2>
				<button
					type="button"
					class="flex h-8 w-8 items-center justify-center text-[var(--text-ghost)] transition-colors hover:text-[var(--text)]"
					onclick={onclose}
					aria-label="Close panel"
				>
					<Icon name="x" size={16} />
				</button>
			</div>

			<!-- Content -->
			<div class="no-scrollbar h-[calc(100%-44px)] overflow-y-auto px-4 pb-4">
				{#if children}
					{@render children()}
				{/if}
			</div>
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
		animation: slide-in-right 0.18s cubic-bezier(0.16, 1, 0.3, 1);
	}
</style>

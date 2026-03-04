<script lang="ts">
	import { Dialog } from 'bits-ui';
	import { Button } from '$lib/elements/button';

	type Variant = 'default' | 'danger';

	interface Props {
		open?: boolean;
		title: string;
		description?: string;
		confirmLabel?: string;
		cancelLabel?: string;
		variant?: Variant;
		loading?: boolean;
		onConfirm: () => void;
		onCancel: () => void;
	}

	let {
		open = $bindable(false),
		title,
		description,
		confirmLabel = 'confirm',
		cancelLabel = 'cancel',
		variant = 'default',
		loading = false,
		onConfirm,
		onCancel
	}: Props = $props();
</script>

<Dialog.Root bind:open onOpenChange={(v) => { if (!v) onCancel(); }}>
	<Dialog.Portal>
		<Dialog.Overlay
			class="fixed inset-0 z-50 bg-[var(--void-0)]/80 backdrop-blur-sm animate-fade-in"
		/>
		<Dialog.Content
			class="fixed left-1/2 top-1/2 z-50 w-full max-w-xs -translate-x-1/2 -translate-y-1/2
				bg-[var(--void-1)] border border-[var(--void-3)] shadow-2xl
				animate-scale-in focus:outline-none"
		>
			<!-- Header -->
			<div class="px-5 pt-5 pb-4">
				<Dialog.Title class="text-sm font-medium text-[var(--text)]">
					{title}
				</Dialog.Title>
				{#if description}
					<Dialog.Description class="mt-1.5 text-xs text-[var(--text-ghost)] leading-relaxed">
						{description}
					</Dialog.Description>
				{/if}
			</div>

			<!-- Divider -->
			<div class="h-px bg-[var(--void-3)]"></div>

			<!-- Actions -->
			<div class="flex items-center justify-end gap-2 px-4 py-3">
				<Button
					variant="ghost"
					size="sm"
					onclick={onCancel}
					disabled={loading}
				>
					{cancelLabel}
				</Button>
				<Button
					variant="solid"
					size="sm"
					class={variant === 'danger'
						? 'bg-[var(--error)]/80 border-[var(--error)] hover:bg-[var(--error)] text-white'
						: ''}
					onclick={onConfirm}
					{loading}
					disabled={loading}
				>
					{confirmLabel}
				</Button>
			</div>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>

<style>
	@keyframes scale-in {
		from {
			opacity: 0;
			transform: translate(-50%, -48%) scale(0.97);
		}
		to {
			opacity: 1;
			transform: translate(-50%, -50%) scale(1);
		}
	}

	@keyframes fade-in {
		from { opacity: 0; }
		to { opacity: 1; }
	}

	:global(.animate-scale-in) {
		animation: scale-in 0.12s cubic-bezier(0.16, 1, 0.3, 1);
	}

	:global(.animate-fade-in) {
		animation: fade-in 0.1s ease-out;
	}
</style>

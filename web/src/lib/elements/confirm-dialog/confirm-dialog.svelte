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

<Dialog.Root
	bind:open
	onOpenChange={(v) => {
		if (!v) onCancel();
	}}
>
	<Dialog.Portal>
		<Dialog.Overlay
			class="animate-fade-in fixed inset-0 z-[70] bg-[var(--void-0)]/85 backdrop-blur-sm"
		/>
		<Dialog.Content
			class="animate-scale-in fixed top-1/2 left-1/2 z-[70] w-full max-w-xs -translate-x-1/2
				-translate-y-1/2 border border-[var(--void-4)] bg-[var(--void-1)]
				shadow-[0_0_0_1px_var(--void-5),0_24px_64px_-16px_rgba(0,0,0,0.8)] focus:outline-none"
		>
			<!-- HUD header bar -->
			<div class="flex items-center gap-2 border-b border-[var(--void-3)] px-4 py-3">
				<span
					class="h-1 w-1 shrink-0 rounded-full {variant === 'danger'
						? 'animate-pulse bg-[var(--error)] shadow-[0_0_6px_var(--error)]'
						: 'bg-[var(--void-6)]'}"
				></span>
				<Dialog.Title class="text-[10px] tracking-[0.24em] text-[var(--text-ghost)] uppercase">
					{title}
				</Dialog.Title>
			</div>

			<!-- Content -->
			{#if description}
				<div class="px-5 py-4">
					<Dialog.Description class="text-xs leading-relaxed text-[var(--text-muted)]">
						{description}
					</Dialog.Description>
				</div>
			{:else}
				<div class="py-2"></div>
			{/if}

			<!-- Actions -->
			<div class="flex items-center justify-end gap-2 border-t border-[var(--void-3)] px-4 py-3">
				<Button variant="ghost" size="sm" onclick={onCancel} disabled={loading}>
					{cancelLabel}
				</Button>
				<Button
					variant="solid"
					size="sm"
					class={variant === 'danger'
						? 'border-[var(--error)]/60 bg-[var(--error)]/15 text-[var(--error)] hover:bg-[var(--error)]/25'
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
			scale: 0.97;
		}
		to {
			opacity: 1;
			scale: 1;
		}
	}

	@keyframes fade-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	:global(.animate-scale-in) {
		animation: scale-in 0.14s cubic-bezier(0.16, 1, 0.3, 1);
	}

	:global(.animate-fade-in) {
		animation: fade-in 0.1s ease-out;
	}
</style>

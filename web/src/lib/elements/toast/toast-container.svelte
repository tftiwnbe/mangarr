<script lang="ts">
	import { toastStore } from './toast.store.svelte';
	import ToastItem from './toast-item.svelte';
</script>

<!-- Bottom-left on desktop, full-width bottom strip on mobile -->
<div
	class="pointer-events-none fixed bottom-4 left-4 z-[200] flex flex-col-reverse gap-2 max-sm:right-0
		max-sm:bottom-0 max-sm:left-0 max-sm:w-full max-sm:gap-px sm:w-80"
	aria-live="polite"
	aria-label="Notifications"
>
	{#each toastStore.items as entry (entry.id)}
		<ToastItem
			id={entry.id}
			variant={entry.variant}
			title={entry.title}
			message={entry.message}
			duration={entry.duration}
		/>
	{/each}
</div>

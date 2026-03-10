<script lang="ts">
	import { Switch } from 'bits-ui';
	import { SpinnerIcon } from 'phosphor-svelte';

	type Variant = 'default' | 'success';

	interface Props {
		checked?: boolean;
		disabled?: boolean;
		loading?: boolean;
		variant?: Variant;
		class?: string;
		onCheckedChange?: (checked: boolean) => void;
	}

	let {
		checked = false,
		disabled = false,
		loading = false,
		variant = 'default',
		class: className = '',
		onCheckedChange
	}: Props = $props();

	const trackClass = $derived(
		checked
			? variant === 'success'
				? 'justify-end bg-[var(--success)]/20'
				: 'justify-end bg-[var(--void-5)]'
			: variant === 'success'
				? 'justify-start bg-[var(--void-5)]'
				: 'justify-start bg-[var(--void-4)]'
	);

	const thumbBg = $derived(
		variant === 'success'
			? checked
				? 'bg-[var(--success)]'
				: 'bg-[var(--void-6)]'
			: checked
				? 'bg-[var(--text)]'
				: 'bg-[var(--void-6)]'
	);
</script>

<Switch.Root
	{checked}
	{disabled}
	{onCheckedChange}
	class="flex h-5 w-9 shrink-0 items-center px-0.5 transition-colors
		focus-visible:outline-none disabled:pointer-events-none disabled:opacity-30
		{trackClass} {className}"
>
	<Switch.Thumb class="flex h-4 w-4 items-center justify-center transition-colors {thumbBg}">
		{#if loading}
			<SpinnerIcon size={10} weight="bold" class="animate-spin text-[var(--text-ghost)]" />
		{/if}
	</Switch.Thumb>
</Switch.Root>

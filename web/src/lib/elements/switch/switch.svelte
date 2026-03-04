<script lang="ts">
	import { Switch } from 'bits-ui';
	import { Icon } from '$lib/elements/icon';

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
		disabled:opacity-30 disabled:pointer-events-none focus-visible:outline-none
		{trackClass} {className}"
>
	<Switch.Thumb class="h-4 w-4 flex items-center justify-center transition-colors {thumbBg}">
		{#if loading}
			<Icon name="loader" size={10} class="animate-spin text-[var(--text-ghost)]" />
		{/if}
	</Switch.Thumb>
</Switch.Root>

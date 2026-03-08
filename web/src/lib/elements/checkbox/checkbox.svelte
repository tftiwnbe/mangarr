<script lang="ts">
	import { Checkbox } from 'bits-ui';

	interface Props {
		checked?: boolean;
		indeterminate?: boolean;
		disabled?: boolean;
		class?: string;
		label?: string;
		onCheckedChange?: (checked: boolean) => void;
	}

	let {
		checked = $bindable(false),
		indeterminate = false,
		disabled = false,
		class: className = '',
		label,
		onCheckedChange
	}: Props = $props();

	const id = `checkbox-${Math.random().toString(36).slice(2, 9)}`;
</script>

<label
	for={id}
	class="group flex cursor-pointer select-none items-center gap-3 {disabled ? 'cursor-not-allowed opacity-40' : ''} {className}"
>
	<Checkbox.Root
		{id}
		bind:checked
		{indeterminate}
		{disabled}
		{onCheckedChange}
		class="relative flex h-4 w-4 shrink-0 items-center justify-center border border-[var(--line)] bg-[var(--void-2)]
			transition-all
			data-[state=checked]:border-[var(--void-6)] data-[state=checked]:bg-[var(--void-5)]
			data-[state=indeterminate]:border-[var(--void-5)] data-[state=indeterminate]:bg-[var(--void-4)]
			focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-line)]
			group-hover:border-[var(--void-5)]"
	>
		{#snippet child({ props })}
			<span {...props}></span>
		{/snippet}
	</Checkbox.Root>

	{#if label}
		<span class="text-sm text-[var(--text-soft)] transition-colors group-hover:text-[var(--text)]">
			{label}
		</span>
	{/if}
</label>

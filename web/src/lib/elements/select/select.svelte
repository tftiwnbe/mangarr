<script lang="ts">
	import { Select } from 'bits-ui';
	import { CaretDownIcon } from 'phosphor-svelte';

	export interface SelectOption {
		value: string;
		label: string;
	}

	interface Props {
		value?: string;
		options: SelectOption[];
		placeholder?: string;
		disabled?: boolean;
		class?: string;
		onValueChange?: (value: string) => void;
	}

	let {
		value = $bindable(''),
		options,
		placeholder = '',
		disabled = false,
		class: className = '',
		onValueChange
	}: Props = $props();

	const selectedLabel = $derived(options.find((o) => o.value === value)?.label ?? '');
</script>

<Select.Root type="single" bind:value {disabled} {onValueChange}>
	<Select.Trigger
		class="relative flex h-11 w-full items-center border border-[var(--void-4)]
			bg-[var(--void-2)] pr-8 pl-3
			text-left text-sm transition-colors
			hover:border-[var(--void-5)] focus:border-[var(--void-6)] focus:outline-none
			disabled:pointer-events-none disabled:opacity-40
			{className}"
	>
		{#if value && selectedLabel}
			<span class="line-clamp-1 text-[var(--text)]">{selectedLabel}</span>
		{:else}
			<span class="text-[var(--text-ghost)]">{placeholder}</span>
		{/if}
		<div
			class="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[var(--text-ghost)]"
		>
			<CaretDownIcon size={12} weight="bold" />
		</div>
	</Select.Trigger>

	<Select.Content
		class="z-50 w-[var(--bits-select-anchor-width)] border border-[var(--line)] bg-[var(--void-1)] shadow-xl outline-none"
		sideOffset={2}
	>
		<Select.Viewport class="no-scrollbar max-h-56 overflow-y-auto">
			{#each options as option (option.value)}
				<Select.Item
					value={option.value}
					label={option.label}
					class="flex h-9 cursor-pointer items-center px-3 text-sm text-[var(--text-soft)] transition-colors
						outline-none
						data-[highlighted]:bg-[var(--void-3)] data-[highlighted]:text-[var(--text)]
						data-[selected]:bg-[var(--void-3)] data-[selected]:text-[var(--text)]"
				>
					{option.label}
				</Select.Item>
			{/each}
		</Select.Viewport>
	</Select.Content>
</Select.Root>

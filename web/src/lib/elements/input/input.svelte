<script lang="ts">
	import type { HTMLInputAttributes, HTMLInputTypeAttribute } from 'svelte/elements';
	type Props = Omit<HTMLInputAttributes, 'class'> & {
		ref?: HTMLInputElement | null;
		value?: string;
		files?: FileList;
		type?: HTMLInputTypeAttribute;
		label?: string;
		error?: string;
		hint?: string;
		class?: string;
		'data-slot'?: string;
	};

	let {
		ref = $bindable<HTMLInputElement | null>(null),
		value = $bindable(''),
		type,
		files = $bindable<FileList | undefined>(undefined),
		label,
		error,
		hint,
		id,
		class: className = '',
		'data-slot': dataSlot = 'input',
		...restProps
	}: Props = $props();

	const inputId = $derived(id ?? `input-${Math.random().toString(36).slice(2, 9)}`);

	const inputClass = $derived(`peer h-12 w-full border border-[var(--line)]
		bg-[var(--void-2)] px-4
		text-sm text-[var(--text)]
		transition-all duration-150
		placeholder:text-[var(--text-ghost)]
		hover:border-[var(--void-5)]
		focus:border-[var(--void-6)] focus:bg-[var(--void-3)] focus:outline-none
		disabled:pointer-events-none disabled:opacity-40
		${error ? 'border-[var(--error)]' : ''} ${className}`);
</script>

<div class="flex flex-col gap-1.5">
	{#if label}
		<label for={inputId} class="text-label">{label}</label>
	{/if}

	<div class="group relative">
		{#if type === 'file'}
			<input
				bind:this={ref}
				data-slot={dataSlot}
				id={inputId}
				type="file"
				bind:files
				bind:value
				class={inputClass}
				{...restProps}
			/>
		{:else}
			<input
				bind:this={ref}
				data-slot={dataSlot}
				id={inputId}
				{type}
				bind:value
				class={inputClass}
				{...restProps}
			/>
		{/if}

		<!-- Subtle glow on focus -->
		<div
			class="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-200 peer-focus:opacity-100"
			style="box-shadow: 0 0 20px rgba(113, 113, 122, 0.08)"
		></div>
	</div>

	{#if error}
		<p class="text-xs text-[var(--error)]">{error}</p>
	{:else if hint}
		<p class="text-xs text-[var(--text-ghost)]">{hint}</p>
	{/if}
</div>

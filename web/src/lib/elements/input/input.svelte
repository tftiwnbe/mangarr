<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';

	interface Props extends Omit<HTMLInputAttributes, 'class'> {
		value?: string;
		label?: string;
		error?: string;
		hint?: string;
		class?: string;
	}

	let {
		value = $bindable(''),
		label,
		error,
		hint,
		id,
		class: className = '',
		...restProps
	}: Props = $props();

	const inputId = id ?? `input-${Math.random().toString(36).slice(2, 9)}`;
</script>

<div class="flex flex-col gap-1.5">
	{#if label}
		<label for={inputId} class="text-label">
			{label}
		</label>
	{/if}

	<div class="group relative">
		<input
			{...restProps}
			id={inputId}
			bind:value
			class="
				peer w-full h-12 px-4
				bg-[var(--void-2)]
				border border-[var(--line)]
				text-[var(--text)] text-sm
				placeholder:text-[var(--text-ghost)]
				transition-all duration-150
				hover:border-[var(--void-5)]
				focus:border-[var(--void-6)] focus:bg-[var(--void-3)]
				focus:outline-none
				disabled:opacity-40 disabled:pointer-events-none
				{error ? 'border-[var(--error)]' : ''}
				{className}
			"
		/>

		<!-- Subtle glow on focus -->
		<div
			class="
				absolute inset-0 pointer-events-none
				opacity-0 peer-focus:opacity-100
				transition-opacity duration-200
			"
			style="box-shadow: 0 0 20px rgba(113, 113, 122, 0.08)"
		></div>
	</div>

	{#if error}
		<p class="text-xs text-[var(--error)]">{error}</p>
	{:else if hint}
		<p class="text-xs text-[var(--text-ghost)]">{hint}</p>
	{/if}
</div>

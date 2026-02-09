<script lang="ts">
	import { Button } from '$lib/elements/button/index.js';
	import * as Select from '$lib/elements/select/index.js';
	import { cn } from '$lib/utils';

	import SunIcon from '@lucide/svelte/icons/sun';
	import MoonIcon from '@lucide/svelte/icons/moon';
	import MonitorIcon from '@lucide/svelte/icons/monitor';

	type Theme = 'light' | 'dark' | 'system';

	let theme = $state<Theme>('dark');
	let accentColor = $state('purple');
	let gridSize = $state('medium');

	const themes: { value: Theme; label: string; icon: typeof SunIcon }[] = [
		{ value: 'light', label: 'Light', icon: SunIcon },
		{ value: 'dark', label: 'Dark', icon: MoonIcon },
		{ value: 'system', label: 'System', icon: MonitorIcon }
	];

	const accentColors = [
		{ value: 'purple', color: 'bg-purple-500' },
		{ value: 'blue', color: 'bg-blue-500' },
		{ value: 'green', color: 'bg-green-500' },
		{ value: 'orange', color: 'bg-orange-500' },
		{ value: 'pink', color: 'bg-pink-500' },
		{ value: 'red', color: 'bg-red-500' }
	];
</script>

<div class="flex flex-col gap-8">
	<section class="flex flex-col gap-4">
		<div>
			<h2 class="text-lg font-medium">Theme</h2>
			<p class="text-sm text-muted-foreground">Select your preferred theme</p>
		</div>

		<div class="grid grid-cols-3 gap-3">
			{#each themes as t (t.value)}
				<button
					onclick={() => (theme = t.value)}
					class={cn(
						'flex flex-col items-center gap-2 rounded-lg border p-4 transition-colors',
						theme === t.value
							? 'border-primary bg-primary/5'
							: 'border-border hover:border-primary/50'
					)}
				>
					<t.icon class="size-6" />
					<span class="text-sm font-medium">{t.label}</span>
				</button>
			{/each}
		</div>
	</section>

	<section class="flex flex-col gap-4">
		<div>
			<h2 class="text-lg font-medium">Accent Color</h2>
			<p class="text-sm text-muted-foreground">Choose your accent color</p>
		</div>

		<div class="flex flex-wrap gap-3">
				{#each accentColors as color (color.value)}
					<button
						onclick={() => (accentColor = color.value)}
						class={cn(
							'size-10 rounded-full transition-transform',
						color.color,
						accentColor === color.value
							? 'ring-2 ring-offset-2 ring-offset-background ring-primary scale-110'
							: 'hover:scale-105'
						)}
						aria-label={color.value}
					></button>
				{/each}
			</div>
		</section>

	<section class="flex flex-col gap-4">
		<div>
			<h2 class="text-lg font-medium">Display</h2>
			<p class="text-sm text-muted-foreground">Customize the display settings</p>
		</div>

		<div class="flex flex-col gap-4 rounded-lg border p-4">
			<div class="flex items-center justify-between">
				<div>
					<p class="font-medium">Grid Size</p>
					<p class="text-sm text-muted-foreground">Size of title cards in grids</p>
				</div>
				<Select.Root type="single" bind:value={gridSize}>
					<Select.Trigger class="w-32">
						{gridSize.charAt(0).toUpperCase() + gridSize.slice(1)}
					</Select.Trigger>
					<Select.Content>
						<Select.Item value="small">Small</Select.Item>
						<Select.Item value="medium">Medium</Select.Item>
						<Select.Item value="large">Large</Select.Item>
					</Select.Content>
				</Select.Root>
			</div>
		</div>
	</section>

	<div class="flex justify-end">
		<Button>Save Changes</Button>
	</div>
</div>

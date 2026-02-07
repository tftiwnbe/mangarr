<script lang="ts">
	import { Button } from '$elements/button/index';
	import { Checkbox } from '$elements/checkbox/index';
	import * as Dialog from '$elements/dialog/index';
	import * as Field from '$elements/field/index';
	import { Input } from '$elements/input/index';
	import { ScrollArea } from '$elements/scroll-area/index';
	import * as Select from '$elements/select/index';
	import { Spinner } from '$elements/spinner';
	import { Switch } from '$elements/switch/index';
	import type { components } from '$lib/api/v2';
	import type { ComponentProps } from 'svelte';

	type SourcePreference = components['schemas']['SourcePreference'];

	interface Props extends ComponentProps<typeof Dialog.Root> {
		isSourcePreferencesOpen: boolean;
		preferencesSourceId: string | null;
		fetchSourcePreferences: (
			source_id: string
		) => Promise<{ name: string; lang: string; preferences: SourcePreference[] }>;
		updateSourcePreferences: (
			source_id: string,
			preferences: SourcePreference[]
		) => Promise<boolean>;
	}

	let {
		preferencesSourceId: source_id = $bindable(null),
		isSourcePreferencesOpen = false,
		fetchSourcePreferences,
		updateSourcePreferences
	}: Props = $props();

	let source_name: string = $state('');
	let source_lang: string = $state('');
	let preferences: SourcePreference[] = $state([]);
	let saving = $state(false);
	let error: string | null = $state(null);

	function updatePreference(key: string, value: unknown) {
		const pref = preferences.find((p) => p.key === key);
		if (pref) {
			pref.current_value = value;
		}
	}

	function toggleMultiSelect(key: string, value: string) {
		const pref = preferences.find((p) => p.key === key);
		if (pref && Array.isArray(pref.current_value)) {
			const index = pref.current_value.indexOf(value);
			if (index > -1) {
				pref.current_value = pref.current_value.filter((v) => v !== value);
			} else {
				pref.current_value = [...pref.current_value, value];
			}
		}
	}

	function isMultiSelectChecked(key: string, value: string): boolean {
		const pref = preferences.find((p) => p.key === key);
		return pref && Array.isArray(pref.current_value) ? pref.current_value.includes(value) : false;
	}

	async function handleSave() {
		saving = true;
		if (source_id) {
			try {
				await updateSourcePreferences(source_id, preferences);
			} finally {
				saving = false;
			}
		}
	}

	function resetAllPreferences() {
		preferences.forEach((pref) => {
			pref.current_value = JSON.parse(JSON.stringify(pref.default_value));
		});
	}

	async function handleOpenChange() {
		if (!source_id) return;
		try {
			error = null;
			const response = await fetchSourcePreferences(source_id);
			source_name = response.name;
			source_lang = response.lang.toUpperCase();
			preferences = response.preferences;
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
			preferences = [];
		}
	}
	$effect(() => {
		if (isSourcePreferencesOpen) {
			handleOpenChange();
		} else {
			source_id = null;
		}
	});
</script>

<Dialog.Root bind:open={isSourcePreferencesOpen}>
	<Dialog.Content
		class="flex h-full max-w-full flex-col rounded-none border-none sm:h-auto sm:max-h-[85vh] sm:max-w-2xl sm:rounded-lg lg:max-w-4xl"
	>
		<Dialog.Header>
			<Dialog.Title>Preferences</Dialog.Title>
			<Dialog.Description>{source_name} - {source_lang}</Dialog.Description>
		</Dialog.Header>

		<div class="-mx-6 space-y-6 overflow-y-auto md:mx-0">
			<ScrollArea class="space-y-6 px-1 py-4">
				<Field.Group class="px-9">
					{#each preferences as pref, i (pref.key)}
						{#if pref.visible}
							{#if pref.type === 'toggle'}
								<Field.Field orientation="horizontal">
									<Field.Content>
										<Field.Label for={pref.key}>{pref.title}</Field.Label>
										{#if pref.summary}
											<Field.Description>{pref.summary}</Field.Description>
										{/if}
									</Field.Content>
									<Switch
										id={pref.key}
										checked={pref.current_value == true}
										onCheckedChange={(value) => updatePreference(pref.key, value)}
										disabled={!pref.enabled}
									/>
								</Field.Field>
							{/if}
							{#if pref.type === 'list' && pref.entries && pref.entry_values}
								<Field.Field>
									<Field.Label for={pref.key}>{pref.title}</Field.Label>
									<Select.Root type="single" bind:value={pref.current_value}>
										<Select.Trigger class="overflow-hidden">
											{pref.entries[pref.entry_values.indexOf(pref.current_value)]}
										</Select.Trigger>

										<Select.Content class="max-h-[40vh]">
											{#each pref.entries as entry, i (entry)}
												<Select.Item
													id={`${pref.key}-${pref.entry_values[i]}`}
													value={pref.entry_values[i]}
													label={entry}
												>
													{entry}
												</Select.Item>
											{/each}
										</Select.Content>
									</Select.Root>
									{#if pref.summary}
										<Field.Description>{pref.summary}</Field.Description>
									{/if}
								</Field.Field>
							{/if}
							{#if pref.type === 'text'}
								<Field.Field>
									<Field.Label for={pref.key}>{pref.title}</Field.Label>
									<Input
										value={pref.current_value || ''}
										oninput={(e) => updatePreference(pref.key, e.currentTarget.value)}
										disabled={!pref.enabled}
										placeholder={pref.default_value || ''}
									/>
									{#if pref.summary}
										<Field.Description>{pref.summary}</Field.Description>
									{/if}
								</Field.Field>
							{/if}
							{#if pref.type === 'multi_select' && pref.entries && pref.entry_values}
								<Field.Set>
									<Field.Legend variant="label">{pref.title}</Field.Legend>
									{#if pref.summary}
										<Field.Description>{pref.summary}</Field.Description>
									{/if}
									<Field.Group class="gap-3">
										{#each pref.entries as entry, i (i)}
											<Field.Field orientation="horizontal">
												<Checkbox
													id={`${pref.key}-${pref.entry_values[i]}`}
													checked={isMultiSelectChecked(pref.key, pref.entry_values[i])}
													onCheckedChange={() => toggleMultiSelect(pref.key, pref.entry_values[i])}
													disabled={!pref.enabled}
												/>
												<Field.Label
													for={`${pref.key}-${pref.entry_values[i]}`}
													class="font-normal"
												>
													{entry}
												</Field.Label>
											</Field.Field>
										{/each}
									</Field.Group>
								</Field.Set>
							{/if}
						{/if}
						{#if i < preferences.length - 1}
							<Field.Separator />
						{/if}
					{/each}
				</Field.Group>
			</ScrollArea>
		</div>

		<Dialog.Footer>
			<Button
				variant="outline"
				onclick={resetAllPreferences}
				disabled={saving}
				class="text-destructive">Reset to default</Button
			>
			<Button
				variant="outline"
				onclick={() => {
					isSourcePreferencesOpen = false;
				}}
				disabled={saving}
			>
				Cancel
			</Button>
			<Button onclick={handleSave} disabled={saving}>
				{#if saving}
					<Spinner />
				{/if}
				Save Changes
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

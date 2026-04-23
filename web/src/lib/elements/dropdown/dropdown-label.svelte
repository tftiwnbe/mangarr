<script lang="ts">
	import { DropdownMenu } from 'bits-ui';
	import type { Snippet } from 'svelte';

	interface Props {
		children: Snippet;
	}

	let { children }: Props = $props();
</script>

<DropdownMenu.GroupHeading
	class="px-3 py-1 text-[10px] tracking-widest text-[var(--void-6)] uppercase"
>
	{@render children()}
</DropdownMenu.GroupHeading>

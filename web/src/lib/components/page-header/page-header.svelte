<script lang="ts">
	import { cn } from '$lib/utils.js';
	import * as Breadcrumb from '$lib/elements/breadcrumb/index.js';
	import * as Sidebar from '$lib/elements/sidebar/index.js';
	import { Separator } from '$lib/elements/separator/index.js';
	import type { Snippet } from 'svelte';

	interface BreadcrumbItem {
		label: string;
		href?: string;
	}

	interface Props {
		title: string;
		description?: string;
		breadcrumbs?: BreadcrumbItem[];
		actions?: Snippet;
		class?: string;
	}

	let { title, description, breadcrumbs = [], actions, class: className }: Props = $props();
</script>

<header
	class={cn(
		'sticky top-0 z-40 flex shrink-0 flex-col gap-2 bg-background pb-4',
		className
	)}
>
	<!-- Top bar with sidebar trigger and breadcrumbs -->
	<div class="flex h-14 items-center gap-2 px-4">
		<Sidebar.Trigger class="-ml-1" />
		<Separator orientation="vertical" class="mr-2 !h-4" />
		<Breadcrumb.Root>
			<Breadcrumb.List>
				{#each breadcrumbs as crumb, i (crumb.label)}
					<Breadcrumb.Item>
						{#if crumb.href && i < breadcrumbs.length - 1}
							<Breadcrumb.Link href={crumb.href}>{crumb.label}</Breadcrumb.Link>
						{:else}
							<Breadcrumb.Page>{crumb.label}</Breadcrumb.Page>
						{/if}
					</Breadcrumb.Item>
					{#if i < breadcrumbs.length - 1}
						<Breadcrumb.Separator />
					{/if}
				{/each}
			</Breadcrumb.List>
		</Breadcrumb.Root>
	</div>

	<!-- Title section -->
	<div class="flex items-center justify-between gap-4 px-4">
		<div class="min-w-0 flex-1">
			<h1 class="truncate text-2xl font-semibold tracking-tight">{title}</h1>
			{#if description}
				<p class="text-sm text-muted-foreground">{description}</p>
			{/if}
		</div>
		{#if actions}
			<div class="flex shrink-0 items-center gap-2">
				{@render actions()}
			</div>
		{/if}
	</div>
</header>

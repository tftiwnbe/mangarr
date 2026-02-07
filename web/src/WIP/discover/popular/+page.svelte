<script lang="ts">
	import { SearchButton } from '$lib/elements/search-button';
	import * as Breadcrumb from '$elements/breadcrumb/index.js';
	import * as InputGroup from '$elements/input-group/index.js';
	import { Separator } from '$elements/separator/index.js';
	import { SidebarTrigger } from '$lib/elements/sidebar';
	import SearchIcon from '@lucide/svelte/icons/search';
</script>

<header class="flex h-16 shrink-0 items-center gap-2">
	<div class="flex items-center gap-2 px-4">
		<!-- <SidebarTrigger class="-ml-1" /> -->
		<!-- <Separator orientation="vertical" class="mr-2 data-[orientation=vertical]:h-4" /> -->
		<Breadcrumb.Root>
			<Breadcrumb.List>
				<!-- <Breadcrumb.Item class="hidden md:block"> -->
				<!-- 	<Breadcrumb.Link href="/discover">Discover</Breadcrumb.Link> -->
				<!-- </Breadcrumb.Item> -->
				<!-- <Breadcrumb.Separator class="hidden md:block" /> -->
				<Breadcrumb.Item>
					<Breadcrumb.Page>Popular Titles</Breadcrumb.Page>
				</Breadcrumb.Item>
			</Breadcrumb.List>
		</Breadcrumb.Root>
	</div>
	<div class="flex gap-2">
		<SearchButton
			enableBlur={false}
			placeholder="Search manga..."
			onSearch={(value) => console.log('Searching:', value)}
		/>
	</div>
	<!-- <div class="flex gap-2"> -->
	<!-- 	<InputGroup.Root> -->
	<!-- 		<InputGroup.Input placeholder="Search..." /> -->
	<!-- 		<InputGroup.Addon> -->
	<!-- 			<SearchIcon /> -->
	<!-- 		</InputGroup.Addon> -->
	<!-- 		<InputGroup.Addon align="inline-end">12 results</InputGroup.Addon> -->
	<!-- 	</InputGroup.Root> -->
	<!-- </div> -->
</header>

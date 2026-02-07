<script lang="ts">
	import AppSidebar from '$lib/components/app-sidebar/app-sidebar.svelte';
	import * as Sidebar from '$lib/elements/sidebar/index.js';

	let { children } = $props();
</script>

<Sidebar.Provider>
	<AppSidebar />
	<Sidebar.Inset>
		{@render children()}
	</Sidebar.Inset>
</Sidebar.Provider>

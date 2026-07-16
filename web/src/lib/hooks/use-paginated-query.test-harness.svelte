<script lang="ts">
	import type { ConvexClient } from 'convex/browser';
	import { setConvexClientContext } from 'convex-svelte';

	import { convexApi } from '$lib/convex/api';
	import { usePaginatedQuery } from './use-paginated-query.svelte';

	let { client }: { client: unknown } = $props();

	// The harness intentionally fixes its client for the component lifetime.
	// svelte-ignore state_referenced_locally
	setConvexClientContext(client as ConvexClient);
	const query = usePaginatedQuery(convexApi.library.listMinePage, () => ({}), {
		initialNumItems: 24
	});
</script>

<p data-testid="status">{query.status}</p>
<p data-testid="count">{query.data.length}</p>
<p data-testid="error">{query.error?.message ?? ''}</p>
<button type="button" onclick={() => query.loadMore(12)}>Load more</button>

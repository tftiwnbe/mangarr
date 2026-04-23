<script lang="ts">
	interface Props {
		class?: string;
		width?: string;
		height?: string;
		rounded?: boolean;
	}

	let { class: className = '', width, height, rounded = false }: Props = $props();
</script>

<div
	class="animate-pulse bg-[var(--void-3)] {rounded ? 'rounded-full' : ''} {className}"
	style={[width && `width:${width}`, height && `height:${height}`].filter(Boolean).join(';')}
	role="status"
	aria-busy="true"
	aria-label="Loading"
></div>
